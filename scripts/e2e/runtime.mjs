import { spawn } from 'node:child_process';

export const E2E_STAGES = Object.freeze([
  'initialization',
  'build',
  'e2e-typecheck',
  'pack',
  'install',
  'consumer-typecheck',
  'vite-build',
  'electron-preflight',
  'playwright',
  'cleanup',
]);

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function createStageTracker(initialStage = 'initialization') {
  let current = assertStage(initialStage);
  return {
    get current() {
      return current;
    },
    enter(stage) {
      current = assertStage(stage);
      return current;
    },
  };
}

function assertStage(stage) {
  if (!E2E_STAGES.includes(stage)) {
    throw new Error(`Unknown E2E stage: ${String(stage)}`);
  }
  return stage;
}

export function resolveElectronVersion(argument, versions) {
  if (Object.hasOwn(versions, argument)) {
    const version = versions[argument];
    if (typeof version !== 'string' || !exactVersionPattern.test(version)) {
      throw new Error(`Electron version alias ${argument} is not exact`);
    }
    return version;
  }
  if (exactVersionPattern.test(argument)) {
    return argument;
  }
  throw new Error(
    `Unknown Electron version ${JSON.stringify(argument)}; use ${Object.keys(
      versions,
    ).join(', ')} or an exact version`,
  );
}

export function assertMinimumElectronDependency(manifest, versions) {
  const minimum = versions.minimum;
  const dependency = manifest.devDependencies?.electron;
  if (dependency !== minimum) {
    throw new Error(
      `devDependencies.electron must equal the minimum E2E version ${minimum}; received ${String(
        dependency,
      )}`,
    );
  }
}

export class CapturedCommandError extends Error {
  constructor(command, args, result) {
    const renderedCommand = [command, ...args].join(' ');
    const details = [
      `${renderedCommand} failed with ${
        result.signal || `exit code ${String(result.exitCode)}`
      }`,
      result.stderr ? `stderr:\n${result.stderr.trimEnd()}` : '',
      result.stdout ? `stdout:\n${result.stdout.trimEnd()}` : '',
    ].filter(Boolean);
    super(details.join('\n'));
    this.name = 'CapturedCommandError';
    this.command = command;
    this.args = args;
    this.cwd = result.cwd;
    this.exitCode = result.exitCode;
    this.signal = result.signal;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
  }
}

export async function runCaptured(command, args, options = {}) {
  const cwd = options.cwd || process.cwd();
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timeout;
    let spawnError;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (exitCode, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      const result = { cwd, exitCode, signal, stderr, stdout };
      if (spawnError) {
        const wrapped = new CapturedCommandError(command, args, result);
        wrapped.cause = spawnError;
        reject(wrapped);
        return;
      }
      if (exitCode !== 0) {
        reject(new CapturedCommandError(command, args, result));
        return;
      }
      resolve(result);
    });

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        stderr += `\nTimed out after ${options.timeoutMs}ms`;
        child.kill('SIGKILL');
      }, options.timeoutMs);
    }
  });
}

export function assertElectronVersionOutput(result, expectedVersion) {
  const output = `${result.stdout}\n${result.stderr}`;
  const versions = [
    ...output.matchAll(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/g),
  ].map((match) => match[1]);
  if (!versions.includes(expectedVersion)) {
    throw new Error(
      `Electron preflight expected ${expectedVersion}, received ${
        versions.length > 0 ? versions.join(', ') : 'no version output'
      }\nstdout:\n${result.stdout.trimEnd()}\nstderr:\n${result.stderr.trimEnd()}`,
    );
  }
}

export async function preflightElectron(
  executablePath,
  expectedVersion,
  options = {},
) {
  const platform = options.platform || process.platform;
  const args =
    platform === 'linux' ? ['--no-sandbox', '--version'] : ['--version'];
  const result = await runCaptured(executablePath, args, {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs || 30_000,
  });
  assertElectronVersionOutput(result, expectedVersion);
  return result;
}

export function serializeError(error) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }
  const serialized = {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };
  for (const property of [
    'command',
    'args',
    'cwd',
    'exitCode',
    'signal',
    'stdout',
    'stderr',
  ]) {
    if (property in error) {
      serialized[property] = error[property];
    }
  }
  if (error.cause !== undefined) {
    serialized.cause = serializeError(error.cause);
  }
  return serialized;
}

export function createSetupDiagnostic(context, error) {
  return {
    stage: context.stage,
    electron: {
      requested: context.requestedElectron,
      resolved: context.electronVersion,
    },
    stress: context.stress,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    packageManager: context.packageManager,
    directories: {
      root: context.rootDir,
      run: context.runDir,
      consumer: context.consumerDir,
    },
    recordedAt: new Date().toISOString(),
    error: serializeError(error),
  };
}
