import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertElectronVersionOutput,
  assertMinimumElectronDependency,
  CapturedCommandError,
  createSetupDiagnostic,
  createStageTracker,
  resolveElectronVersion,
  runCaptured,
} from './runtime.mjs';

const versions = { current: '43.1.1', minimum: '28.0.0' };

test('resolves aliases and exact Electron versions', () => {
  assert.equal(resolveElectronVersion('minimum', versions), '28.0.0');
  assert.equal(resolveElectronVersion('current', versions), '43.1.1');
  assert.equal(resolveElectronVersion('30.2.0', versions), '30.2.0');
  assert.throws(
    () => resolveElectronVersion('latest', versions),
    /Unknown Electron version/,
  );
});

test('tracks only known setup stages', () => {
  const tracker = createStageTracker();
  assert.equal(tracker.current, 'initialization');
  tracker.enter('electron-preflight');
  assert.equal(tracker.current, 'electron-preflight');
  assert.throws(() => tracker.enter('unknown'), /Unknown E2E stage/);
});

test('requires the root Electron dependency to match minimum', () => {
  assert.doesNotThrow(() =>
    assertMinimumElectronDependency(
      { devDependencies: { electron: '28.0.0' } },
      versions,
    ),
  );
  assert.throws(
    () =>
      assertMinimumElectronDependency(
        { devDependencies: { electron: '43.1.1' } },
        versions,
      ),
    /must equal the minimum E2E version/,
  );
});

test('captured commands propagate exit status and stderr', async () => {
  await assert.rejects(
    runCaptured(process.execPath, [
      '-e',
      "process.stderr.write('missing-library\\n'); process.exit(23)",
    ]),
    (error) => {
      assert.ok(error instanceof CapturedCommandError);
      assert.equal(error.exitCode, 23);
      assert.equal(error.stderr, 'missing-library\n');
      assert.match(error.message, /missing-library/);
      const diagnostic = createSetupDiagnostic(
        {
          consumerDir: '/tmp/consumer',
          electronVersion: '28.0.0',
          packageManager: 'pnpm@11.15.1',
          requestedElectron: 'minimum',
          rootDir: '/repo',
          runDir: '/tmp/run',
          stage: 'electron-preflight',
          stress: false,
        },
        error,
      );
      assert.equal(diagnostic.error.exitCode, 23);
      assert.equal(diagnostic.error.stderr, 'missing-library\n');
      return true;
    },
  );
});

test('validates Electron output and includes setup failure metadata', () => {
  const result = { stderr: '', stdout: 'v43.1.1\n' };
  assert.doesNotThrow(() => assertElectronVersionOutput(result, '43.1.1'));
  assert.throws(
    () => assertElectronVersionOutput(result, '28.0.0'),
    /expected 28\.0\.0, received 43\.1\.1/,
  );

  const diagnostic = createSetupDiagnostic(
    {
      consumerDir: '/tmp/consumer',
      electronVersion: '43.1.1',
      packageManager: 'pnpm@11.15.1',
      requestedElectron: 'current',
      rootDir: '/repo',
      runDir: '/tmp/run',
      stage: 'electron-preflight',
      stress: false,
    },
    new Error('preflight failed'),
  );
  assert.equal(diagnostic.stage, 'electron-preflight');
  assert.equal(diagnostic.electron.resolved, '43.1.1');
  assert.equal(diagnostic.directories.consumer, '/tmp/consumer');
  assert.match(diagnostic.error.stack, /preflight failed/);
});
