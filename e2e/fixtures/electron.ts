import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  test as base,
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
} from '@playwright/test';
import { type RendererId, rendererIds } from '../app/src/schema';

const require = createRequire(import.meta.url);
const playwrightElectronLoader = path.join(
  path.dirname(require.resolve('playwright-core/package.json')),
  'lib',
  'server',
  'electron',
  'loader.js',
);

export type ElectronHarness = {
  app: ElectronApplication;
  electronVersion: string;
  workspaceId: string;
  page(rendererId: RendererId): Page;
  consumeMainError(pattern: RegExp): boolean;
  consumeWarning(pattern: RegExp): boolean;
};

type Fixtures = {
  electronHarness: ElectronHarness;
};

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required; run tests through pnpm test:e2e`);
  }
  return value;
}

function hasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (hasExited(child)) {
    return true;
  }
  return await new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(hasExited(child));
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

async function forceKill(child: ChildProcess) {
  if (hasExited(child)) {
    return;
  }
  if (process.platform !== 'win32' || child.pid === undefined) {
    child.kill('SIGKILL');
    return;
  }
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
  });
}

async function closeWithTimeout(app: ElectronApplication, child: ChildProcess) {
  let timeout: NodeJS.Timeout | undefined;
  let closeError: unknown;
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Electron did not close within 5 seconds')),
          5_000,
        );
      }),
    ]);
  } catch (error) {
    closeError = error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  if (!(await waitForExit(child, 1_000))) {
    await forceKill(child);
  }
  if (!(await waitForExit(child, 5_000))) {
    throw new Error(`Electron process ${child.pid ?? 'unknown'} did not exit`);
  }
  if (closeError) {
    throw closeError;
  }
}

export const test = base.extend<Fixtures>({
  electronHarness: [
    async ({ playwright: _playwright }, use, testInfo) => {
      const consumerDir = requiredEnvironment('E2E_CONSUMER_DIR');
      const executablePath = requiredEnvironment('E2E_ELECTRON_EXECUTABLE');
      const electronVersion = requiredEnvironment('E2E_ELECTRON_VERSION');
      const runId = randomUUID();
      const workspaceId = `workspace-${runId}`;
      const channelPrefix = `e2e:${runId}:`;
      const userDataDir = testInfo.outputPath('user-data');
      await mkdir(userDataDir, { recursive: true });

      const logs: string[] = [];
      const mainErrors: string[] = [];
      const warnings: string[] = [];
      const failures: string[] = [];
      const attachedPages = new WeakSet<Page>();
      const pages = new Map<RendererId, Page>();
      let closing = false;
      let setupError: unknown;

      const launchEnvironment = { ...process.env };
      delete launchEnvironment.NO_COLOR;

      const app = await electron.launch({
        executablePath,
        args: [`--user-data-dir=${userDataDir}`, '.'],
        cwd: consumerDir,
        env: {
          ...launchEnvironment,
          E2E_CHANNEL_PREFIX: channelPrefix,
          E2E_PLAYWRIGHT_ELECTRON_LOADER: playwrightElectronLoader,
          E2E_USER_DATA_DIR: userDataDir,
          E2E_WORKSPACE_ID: workspaceId,
        },
        timeout: 30_000,
      });
      const child = app.process();

      child.stdout?.on('data', (chunk) => {
        logs.push(`[main:stdout] ${String(chunk).trimEnd()}`);
      });
      child.stderr?.on('data', (chunk) => {
        logs.push(`[main:stderr] ${String(chunk).trimEnd()}`);
      });
      app.on('console', (message) => {
        const line = `[main:${message.type()}] ${message.text()}`;
        logs.push(line);
        if (message.type() === 'warning') {
          warnings.push(message.text());
        } else if (message.type() === 'error') {
          mainErrors.push(message.text());
        }
      });
      app.on('close', () => {
        if (!closing) {
          failures.push('Electron application closed before fixture teardown');
        }
      });

      const attachPage = (page: Page) => {
        if (attachedPages.has(page)) {
          return;
        }
        attachedPages.add(page);
        page.on('console', (message) => {
          const line = `[renderer:${message.type()}] ${message.text()}`;
          logs.push(line);
          if (message.type() === 'error' || message.type() === 'warning') {
            failures.push(line);
          }
        });
        page.on('pageerror', (error) => {
          failures.push(`[renderer:pageerror] ${error.stack || error.message}`);
        });
        page.on('crash', () => {
          failures.push('[renderer:crash] renderer process crashed');
        });
      };

      try {
        app.on('window', attachPage);
        for (const page of app.windows()) {
          attachPage(page);
        }

        await expect
          .poll(() => app.windows().length, {
            message: 'all renderer windows should open',
            timeout: 15_000,
          })
          .toBe(3);

        for (const page of app.windows()) {
          attachPage(page);
          await page.waitForFunction(
            () => {
              const candidate = window as typeof window & {
                e2e?: { ready?: boolean };
              };
              return candidate.e2e?.ready === true;
            },
            undefined,
            { timeout: 15_000 },
          );
          const rendererId = await page.evaluate(() => {
            const candidate = window as typeof window & {
              e2e: { rendererId: RendererId };
            };
            return candidate.e2e.rendererId;
          });
          pages.set(rendererId, page);
        }
        expect([...pages.keys()].sort()).toEqual([...rendererIds].sort());

        logs.push(
          `[harness] windows=${JSON.stringify(
            [...pages].map(([rendererId, page]) => ({
              rendererId,
              url: page.url(),
            })),
          )}`,
        );
        const actualElectronVersion = await app.evaluate(
          ({ app: electronApp }) =>
            process.versions.electron || electronApp.getVersion(),
        );
        expect(actualElectronVersion).toBe(electronVersion);

        const harness: ElectronHarness = {
          app,
          electronVersion,
          workspaceId,
          page(rendererId) {
            const page = pages.get(rendererId);
            if (!page) {
              throw new Error(`Renderer ${rendererId} is not available`);
            }
            return page;
          },
          consumeMainError(pattern) {
            const index = mainErrors.findIndex((message) =>
              pattern.test(message),
            );
            if (index < 0) {
              return false;
            }
            mainErrors.splice(index, 1);
            return true;
          },
          consumeWarning(pattern) {
            const index = warnings.findIndex((warning) =>
              pattern.test(warning),
            );
            if (index < 0) {
              return false;
            }
            warnings.splice(index, 1);
            return true;
          },
        };

        await use(harness);
      } catch (error) {
        setupError = error;
      }

      const shouldCaptureScreenshots =
        setupError !== undefined ||
        testInfo.status !== testInfo.expectedStatus ||
        failures.length > 0 ||
        warnings.length > 0 ||
        mainErrors.length > 0;
      if (shouldCaptureScreenshots) {
        const mappedPages = new Set(pages.values());
        const screenshotEntries: Array<[string, Page]> = [...pages];
        for (const [index, page] of app.windows().entries()) {
          if (!mappedPages.has(page)) {
            screenshotEntries.push([`unmapped-${index}`, page]);
          }
        }
        logs.push(
          `[harness] windowState=${JSON.stringify(
            screenshotEntries.map(([name, page]) => ({
              name,
              closed: page.isClosed(),
              url: page.url(),
            })),
          )}`,
        );
        await Promise.all(
          screenshotEntries.map(async ([rendererId, page]) => {
            if (!page.isClosed()) {
              const screenshotPath = testInfo.outputPath(`${rendererId}.png`);
              try {
                await page.screenshot({
                  path: screenshotPath,
                  timeout: 2_000,
                });
                await testInfo.attach(`window-${rendererId}`, {
                  path: screenshotPath,
                  contentType: 'image/png',
                });
              } catch {
                // A crashed or closing renderer may no longer be capturable.
              }
            }
          }),
        );
      }

      closing = true;
      try {
        await closeWithTimeout(app, child);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
      logs.push(
        `[harness] exitCode=${String(child.exitCode)} signal=${String(child.signalCode)}`,
      );
      if (child.exitCode !== 0) {
        failures.push(`Electron exited with code ${String(child.exitCode)}`);
      }
      if (child.signalCode !== null) {
        failures.push(`Electron exited from signal ${child.signalCode}`);
      }

      if (warnings.length > 0) {
        failures.push(`Unconsumed main warnings:\n${warnings.join('\n')}`);
      }
      if (mainErrors.length > 0) {
        failures.push(`Unconsumed main errors:\n${mainErrors.join('\n')}`);
      }
      const shouldAttachDiagnostics =
        setupError !== undefined ||
        testInfo.status !== testInfo.expectedStatus ||
        failures.length > 0;
      if (shouldAttachDiagnostics) {
        await testInfo.attach('electron-logs', {
          body: Buffer.from(logs.join('\n'), 'utf8'),
          contentType: 'text/plain',
        });
      }

      if (setupError) {
        if (failures.length > 0) {
          throw new AggregateError(
            [setupError, new Error(failures.join('\n'))],
            'Electron fixture setup and cleanup failed',
          );
        }
        throw setupError;
      }
      if (failures.length > 0 && testInfo.status === testInfo.expectedStatus) {
        throw new Error(failures.join('\n'));
      }
    },
    { timeout: 60_000 },
  ],
});

export { expect } from '@playwright/test';
