import type { E2EDriver } from '../app/src/schema';
import { expect, test } from '../fixtures/electron';

test('@stress handles seeded high concurrency', async ({
  electronHarness,
}, testInfo) => {
  const baseSeed = Number(process.env.E2E_STRESS_SEED ?? 0x5eed) >>> 0;
  const effectiveSeed = (baseSeed + testInfo.repeatEachIndex) >>> 0;
  await testInfo.attach('stress-seed', {
    body: JSON.stringify(
      {
        baseSeed,
        effectiveSeed,
        repeatEachIndex: testInfo.repeatEachIndex,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });

  let seed = effectiveSeed;
  const delays = Array.from({ length: 300 }, () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed % 31;
  });
  const results = await electronHarness.page('main').evaluate(
    async ({ delays, workspaceId }) => {
      const driver = (window as typeof window & { e2e: E2EDriver }).e2e;
      return await Promise.all(
        delays.map((delay, index) =>
          driver.invokeTo('outOfOrder', {
            data: [index, delay],
            timeout: 5_000,
            windowParams: ['sub', workspaceId],
          }),
        ),
      );
    },
    { delays, workspaceId: electronHarness.workspaceId },
  );

  expect(results).toEqual(
    Array.from({ length: delays.length }, (_, index) => ({ index })),
  );
});
