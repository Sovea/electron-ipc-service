const loader = process.env.E2E_PLAYWRIGHT_ELECTRON_LOADER;

if (!loader) {
  throw new Error('E2E_PLAYWRIGHT_ELECTRON_LOADER is required');
}

// Playwright skips loader injection for executablePath, so the consumer loads
// it before its native ESM main entry reaches app.whenReady().
require(loader);
if (typeof globalThis.__playwright_run !== 'function') {
  throw new Error(
    `Playwright ${process.env.E2E_PLAYWRIGHT_VERSION || 'unknown'} Electron loader did not define __playwright_run`,
  );
}
void import('./dist-electron/main/index.js');
