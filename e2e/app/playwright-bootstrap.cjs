const loader = process.env.E2E_PLAYWRIGHT_ELECTRON_LOADER;

if (!loader) {
  throw new Error('E2E_PLAYWRIGHT_ELECTRON_LOADER is required');
}

// Playwright skips loader injection for executablePath, so the consumer loads
// it before its native ESM main entry reaches app.whenReady().
require(loader);
void import('./dist-electron/main/index.js');
