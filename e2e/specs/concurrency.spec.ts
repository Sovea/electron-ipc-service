import type { E2EDriver } from '../app/src/schema';
import { expect, test } from '../fixtures/electron';

test('concurrent out-of-order replies keep their request association', async ({
  electronHarness,
}) => {
  const results = await electronHarness.page('main').evaluate(
    async ({ workspaceId }) => {
      const driver = (window as typeof window & { e2e: E2EDriver }).e2e;
      return await Promise.all(
        Array.from({ length: 50 }, (_, index) =>
          driver.invokeTo('outOfOrder', {
            data: [index, ((index * 17) % 11) * 3],
            timeout: 1_000,
            windowParams: ['sub', workspaceId],
          }),
        ),
      );
    },
    { workspaceId: electronHarness.workspaceId },
  );

  expect(results).toEqual(
    Array.from({ length: 50 }, (_, index) => ({ index })),
  );
});
