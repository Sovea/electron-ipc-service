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

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const arguments_ = process.argv.slice(2);
const electronArgumentIndex = arguments_.indexOf('--electron');
const electronVersion =
  electronArgumentIndex >= 0
    ? arguments_[electronArgumentIndex + 1]
    : process.env.E2E_ELECTRON_VERSION || '28.0.0';
const stress = arguments_.includes('--stress');
const toolVersions = {
  '@types/node': '22.18.1',
  typescript: '5.9.2',
  vite: '8.1.5',
  'vite-plugin-electron': '1.1.0',
};

if (!electronVersion || electronVersion.startsWith('--')) {
  throw new Error('--electron requires a version');
}

const safeVersion = electronVersion.replaceAll(/[^a-zA-Z0-9.-]/g, '-');
const runDir = await mkdtemp(path.join(tmpdir(), `eis-e2e-${safeVersion}-`));
const packageDir = path.join(runDir, 'package');
const consumerDir = path.join(runDir, 'consumer');
const fixtureDir = path.join(rootDir, 'e2e', 'app');

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
          `${command} ${args.join(' ')} failed with ${signal || `exit code ${code}`}`,
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
  if (!manifest.exports?.['.'] || !manifest.exports?.['./*']) {
    throw new Error('Packed manifest is missing a public package entry');
  }

  await Promise.all([
    readFile(path.join(packagePath, 'esm', 'index.js')),
    readFile(path.join(packagePath, 'esm', 'renderer.js')),
  ]);
}

async function prepareConsumer() {
  await runPnpm(['run', 'test:e2e:types']);
  await rm(path.join(rootDir, 'esm'), { force: true, recursive: true });
  await mkdir(packageDir, { recursive: true });

  await runPnpm(['run', 'build']);
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
        dependencies: {
          '@sovea/electron-ipc-service': `file:../package/${tarballName}`,
        },
        devDependencies: {
          electron: electronVersion,
          ...toolVersions,
        },
        pnpm: {
          onlyBuiltDependencies: ['electron'],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await runPnpm(['install', '--ignore-workspace', '--no-frozen-lockfile'], {
    cwd: consumerDir,
  });
  await assertInstalledPackage();
  await runPnpm(['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: consumerDir });
  await runPnpm(['exec', 'vite', 'build', '.', '--config', 'vite.config.ts'], {
    cwd: consumerDir,
  });
  await assertExternalImports();
}

async function main() {
  console.log(`[e2e] Electron ${electronVersion}; consumer ${consumerDir}`);
  await prepareConsumer();

  const consumerRequire = createRequire(path.join(consumerDir, 'package.json'));
  const electronExecutable = consumerRequire('electron');
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

  const testEnvironment = {
    ...process.env,
    E2E_CONSUMER_DIR: consumerDir,
    E2E_ELECTRON_EXECUTABLE: electronExecutable,
    E2E_ELECTRON_VERSION: electronVersion,
    E2E_STRESS: stress ? '1' : '0',
  };
  delete testEnvironment.NO_COLOR;
  await runPnpm(testArgs, {
    env: testEnvironment,
  });
  await rm(runDir, { force: true, recursive: true });
}

main().catch((error) => {
  console.error(error);
  console.error(`[e2e] Preserved failed consumer at ${runDir}`);
  process.exitCode = 1;
});
