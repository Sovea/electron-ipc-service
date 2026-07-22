import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type PackageManifest = {
  devDependencies?: Record<string, string>;
  version?: string;
};

export type PlaywrightElectronBridge = {
  loaderPath: string;
  version: string;
};

const require = createRequire(import.meta.url);
let cachedBridge: PlaywrightElectronBridge | undefined;

function readManifest(manifestPath: string): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
}

export function resolvePlaywrightElectronBridge(): PlaywrightElectronBridge {
  if (cachedBridge) {
    return cachedBridge;
  }

  const rootManifestPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'package.json',
  );
  const testManifestPath = require.resolve('@playwright/test/package.json');
  const testRequire = createRequire(testManifestPath);
  const playwrightManifestPath = testRequire.resolve('playwright/package.json');
  const playwrightRequire = createRequire(playwrightManifestPath);
  const coreManifestPath = playwrightRequire.resolve(
    'playwright-core/package.json',
  );
  const expectedVersion =
    readManifest(rootManifestPath).devDependencies?.['@playwright/test'];
  const testVersion = readManifest(testManifestPath).version;
  const playwrightVersion = readManifest(playwrightManifestPath).version;
  const coreVersion = readManifest(coreManifestPath).version;

  if (!expectedVersion || !/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
    throw new Error(
      'Playwright Electron bridge requires an exact @playwright/test version',
    );
  }
  if (
    testVersion !== expectedVersion ||
    playwrightVersion !== expectedVersion ||
    coreVersion !== expectedVersion
  ) {
    throw new Error(
      `Unsupported Playwright Electron bridge: expected ${expectedVersion}, ` +
        `installed @playwright/test ${String(testVersion)}, playwright ${String(
          playwrightVersion,
        )}, and playwright-core ${String(coreVersion)}`,
    );
  }

  const loaderPath = path.join(
    path.dirname(coreManifestPath),
    'lib',
    'server',
    'electron',
    'loader.js',
  );
  if (!existsSync(loaderPath)) {
    throw new Error(
      `Playwright ${expectedVersion} Electron loader is missing at ${loaderPath}`,
    );
  }

  cachedBridge = { loaderPath, version: expectedVersion };
  return cachedBridge;
}
