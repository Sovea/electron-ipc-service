import { defineConfig } from '@playwright/test';

const isCi = Boolean(process.env.CI);
const isStress = process.env.E2E_STRESS === '1';

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 45_000,
  globalTimeout: 20 * 60_000,
  expect: {
    timeout: 5_000,
  },
  workers: 1,
  fullyParallel: false,
  retries: isCi ? 1 : 0,
  failOnFlakyTests: isCi,
  forbidOnly: isCi,
  grep: isStress ? /@stress/ : undefined,
  grepInvert: isStress ? undefined : /@stress/,
  outputDir: 'test-results',
  preserveOutput: 'failures-only',
  reporter: isCi
    ? [
        ['line'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/junit.xml' }],
      ]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
      ],
  use: {
    trace: 'on-first-retry',
  },
});
