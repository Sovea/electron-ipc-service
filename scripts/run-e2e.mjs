import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertMinimumElectronDependency,
  createSetupDiagnostic,
  createStageTracker,
  preflightElectron,
  resolveElectronVersion,
} from './e2e/runtime.mjs';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const fixtureDir = path.join(rootDir, 'e2e', 'app');
const setupReportPath = path.join(rootDir, 'test-results', 'e2e-setup.json');
const arguments_ = process.argv.slice(2);
const electronArgumentIndex = arguments_.indexOf('--electron');
const requestedElectron =
  electronArgumentIndex >= 0
    ? arguments_[electronArgumentIndex + 1]
    : process.env.E2E_ELECTRON_VERSION || 'minimum';
const stress = arguments_.includes('--stress');
const tracker = createStageTracker();
const toolVersions = {
  '@types/node': '22.18.1',
  typescript: '5.9.2',
  vite: '8.1.5',
  'vite-plugin-electron': '1.1.0',
};

let packageManager = 'unknown';
let electronVersion;
let runDir;
let packageDir;
let consumerDir;

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      env: options.env || process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed with ${
            signal || `exit code ${code}`
          }`,
        ),
      );
    });
  });
}

async function runPnpm(args, options) {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli) {
    return await run(process.execPath, [pnpmCli, ...args], options);
  }
  return await run(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args,
    options,
  );
}

async function assertExternalImports() {
  const mainOutput = await readFile(
    path.join(consumerDir, 'dist-electron', 'main', 'index.js'),
    'utf8',
  );
  const preloadOutput = await readFile(
    path.join(consumerDir, 'dist-electron', 'preload', 'index.mjs'),
    'utf8',
  );
  if (!/from\s+["']@sovea\/electron-ipc-service["']/.test(mainOutput)) {
    throw new Error('Vite bundled the package root entry into the main output');
  }
  if (!/from\s+["']electron["']/.test(mainOutput)) {
    throw new Error('Vite bundled Electron into the main output');
  }
  if (
    !/from\s+["']@sovea\/electron-ipc-service\/renderer["']/.test(preloadOutput)
  ) {
    throw new Error(
      'Vite bundled the renderer package entry into the preload output',
    );
  }
  if (!/from\s+["']electron["']/.test(preloadOutput)) {
    throw new Error('Vite bundled Electron into the preload output');
  }
}

async function assertInstalledPackage() {
  const packagePath = path.join(
    consumerDir,
    'node_modules',
    '@sovea',
    'electron-ipc-service',
  );
  const resolvedPackagePath = await realpath(packagePath);
  const resolvedConsumerPath = await realpath(consumerDir);
  const relativePath = path.relative(resolvedConsumerPath, resolvedPackagePath);
  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    resolvedPackagePath === rootDir
  ) {
    throw new Error(
      'Packed dependency resolved outside the temporary consumer',
    );
  }

  const manifest = JSON.parse(
    await readFile(path.join(packagePath, 'package.json'), 'utf8'),
  );
  if (manifest.name !== '@sovea/electron-ipc-service') {
    throw new Error('Temporary consumer installed an unexpected package');
  }
  if (manifest.dependencies?.['type-fest'] !== '^4.41.0') {
    throw new Error(
      'Packed manifest is missing the type-fest runtime dependency',
    );
  }
  const expectedExports = {
    '.': {
      types: './esm/index.d.ts',
      import: './esm/index.js',
    },
    './renderer': {
      types: './esm/renderer.d.ts',
      import: './esm/renderer.js',
    },
  };
  if (
    Object.keys(manifest.exports ?? {}).length !==
      Object.keys(expectedExports).length ||
    Object.entries(expectedExports).some(
      ([entry, conditions]) =>
        manifest.exports?.[entry]?.types !== conditions.types ||
        manifest.exports?.[entry]?.import !== conditions.import,
    )
  ) {
    throw new Error('Packed manifest does not expose the expected public API');
  }

  await Promise.all([
    readFile(path.join(packagePath, 'esm', 'index.js')),
    readFile(path.join(packagePath, 'esm', 'renderer.js')),
  ]);
}

async function prepareConsumer() {
  tracker.enter('build');
  await rm(path.join(rootDir, 'esm'), { force: true, recursive: true });
  await mkdir(packageDir, { recursive: true });
  await runPnpm(['run', 'build']);

  tracker.enter('e2e-typecheck');
  await runPnpm(['run', 'test:e2e:types']);

  tracker.enter('pack');
  await runPnpm(['pack', '--pack-destination', packageDir]);
  const tarballName = (await readdir(packageDir)).find((name) =>
    name.endsWith('.tgz'),
  );
  if (!tarballName) {
    throw new Error('pnpm pack did not create a tarball');
  }

  await cp(fixtureDir, consumerDir, { recursive: true });
  await writeFile(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'electron-ipc-service-e2e-consumer',
        private: true,
        type: 'module',
        main: 'playwright-bootstrap.cjs',
        packageManager,
        dependencies: {
          '@sovea/electron-ipc-service': `file:../package/${tarballName}`,
        },
        devDependencies: {
          electron: electronVersion,
          ...toolVersions,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(
    path.join(consumerDir, 'pnpm-workspace.yaml'),
    'allowBuilds:\n  electron: true\n',
    'utf8',
  );

  tracker.enter('install');
  await runPnpm(['install', '--no-frozen-lockfile'], { cwd: consumerDir });
  await assertInstalledPackage();

  tracker.enter('consumer-typecheck');
  await runPnpm(['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: consumerDir });

  tracker.enter('vite-build');
  await runPnpm(['exec', 'vite', 'build', '.', '--config', 'vite.config.ts'], {
    cwd: consumerDir,
  });
  await assertExternalImports();
}

async function initialize() {
  const safeRequestedVersion = String(
    requestedElectron || 'invalid',
  ).replaceAll(/[^a-zA-Z0-9.-]/g, '-');
  runDir = await mkdtemp(
    path.join(tmpdir(), `eis-e2e-${safeRequestedVersion}-`),
  );
  packageDir = path.join(runDir, 'package');
  consumerDir = path.join(runDir, 'consumer');

  if (!requestedElectron || requestedElectron.startsWith('--')) {
    throw new Error('--electron requires a version or alias');
  }

  const [manifest, versions] = await Promise.all([
    readFile(path.join(rootDir, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(rootDir, 'e2e', 'electron-versions.json'), 'utf8').then(
      JSON.parse,
    ),
  ]);
  packageManager = manifest.packageManager;
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageManager)) {
    throw new Error('packageManager must pin an exact pnpm version');
  }
  assertMinimumElectronDependency(manifest, versions);
  electronVersion = resolveElectronVersion(requestedElectron, versions);
  await rm(setupReportPath, { force: true });
}

async function main() {
  await initialize();
  console.log(
    `[e2e] Electron ${requestedElectron} -> ${electronVersion}; consumer ${consumerDir}`,
  );
  await prepareConsumer();

  tracker.enter('electron-preflight');
  const consumerRequire = createRequire(path.join(consumerDir, 'package.json'));
  const electronExecutable = consumerRequire('electron');
  const launchEnvironment = { ...process.env };
  delete launchEnvironment.NO_COLOR;

  const preflight = await preflightElectron(
    electronExecutable,
    electronVersion,
    {
      cwd: consumerDir,
      env: launchEnvironment,
    },
  );
  console.log(
    `[e2e] Electron preflight: ${(
      preflight.stdout || preflight.stderr
    ).trim()}`,
  );

  const testArgs = [
    'exec',
    'playwright',
    'test',
    '--config',
    path.join(rootDir, 'playwright.config.ts'),
  ];
  if (stress) {
    testArgs.push('--grep', '@stress', '--repeat-each', '5');
  }

  tracker.enter('playwright');
  await runPnpm(testArgs, {
    env: {
      ...launchEnvironment,
      E2E_CONSUMER_DIR: consumerDir,
      E2E_ELECTRON_EXECUTABLE: electronExecutable,
      E2E_ELECTRON_VERSION: electronVersion,
      E2E_PACKAGE_MANAGER: packageManager,
      E2E_REQUESTED_ELECTRON: requestedElectron,
      E2E_ROOT_DIR: rootDir,
      E2E_RUN_DIR: runDir,
      E2E_STRESS: stress ? '1' : '0',
    },
  });

  tracker.enter('cleanup');
  await rm(runDir, { force: true, recursive: true });
}

async function writeSetupReport(error) {
  await mkdir(path.dirname(setupReportPath), { recursive: true });
  await writeFile(
    setupReportPath,
    `${JSON.stringify(
      createSetupDiagnostic(
        {
          consumerDir,
          electronVersion,
          packageManager,
          requestedElectron,
          rootDir,
          runDir,
          stage: tracker.current,
          stress,
        },
        error,
      ),
      null,
      2,
    )}\n`,
    'utf8',
  );
}

try {
  await main();
} catch (error) {
  try {
    await writeSetupReport(error);
    console.error(`[e2e] Setup report: ${setupReportPath}`);
  } catch (reportError) {
    console.error('[e2e] Failed to write setup report', reportError);
  }
  console.error(error);
  if (runDir) {
    console.error(`[e2e] Preserved failed consumer at ${runDir}`);
  }
  process.exitCode = 1;
}
