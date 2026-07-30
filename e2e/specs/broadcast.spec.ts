import { expect, test } from '../fixtures/electron';
import { broadcast, clearEvents, control, getEvents } from '../support/driver';

test('global broadcasts reach every other renderer exactly once', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const other = electronHarness.page('other');
  const state = await control<{ windowIds: Record<string, number> }>(
    main,
    'state',
  );
  await Promise.all([clearEvents(main), clearEvents(sub), clearEvents(other)]);

  await broadcast(main, 'commonMessage', {
    data: ['global'],
  });

  const expectedEvent = {
    channel: 'commonMessage',
    data: 'global',
    deliveryKind: 'broadcast',
    kind: 'receive',
    scope: { kind: 'all' },
    sourceId: state.windowIds.main,
  };
  await expect.poll(() => getEvents(sub)).toEqual([expectedEvent]);
  await expect.poll(() => getEvents(other)).toEqual([expectedEvent]);
  expect(await getEvents(main)).toEqual([]);
});

test('renderer-selected scopes are resolved by main and visible to recipients', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const other = electronHarness.page('other');
  const state = await control<{ windowIds: Record<string, number> }>(
    main,
    'state',
  );
  await Promise.all([clearEvents(main), clearEvents(sub), clearEvents(other)]);

  const scope = {
    kind: 'renderer' as const,
    rendererId: 'sub' as const,
  };
  await broadcast(main, 'commonMessage', {
    data: ['scoped'],
    scope,
  });

  await expect
    .poll(() => getEvents(sub))
    .toEqual([
      {
        channel: 'commonMessage',
        data: 'scoped',
        deliveryKind: 'broadcast',
        kind: 'receive',
        scope,
        sourceId: state.windowIds.main,
      },
    ]);
  expect(await getEvents(main)).toEqual([]);
  expect(await getEvents(other)).toEqual([]);
});

test('invalid broadcast targets do not prevent delivery to healthy renderers', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const other = electronHarness.page('other');
  await Promise.all([clearEvents(sub), clearEvents(other)]);

  await broadcast(main, 'commonMessage', {
    data: ['partial'],
    scope: {
      kind: 'with-missing-target',
      workspaceId: electronHarness.workspaceId,
    },
  });

  await expect
    .poll(async () =>
      (await getEvents(sub)).filter(
        (event) =>
          event.channel === 'commonMessage' && event.data === 'partial',
      ),
    )
    .toHaveLength(1);
  await expect
    .poll(async () =>
      (await getEvents(other)).filter(
        (event) =>
          event.channel === 'commonMessage' && event.data === 'partial',
      ),
    )
    .toHaveLength(1);
  await expect
    .poll(() =>
      electronHarness.consumeWarning(
        /IPC_TARGET_NOT_FOUND: webContents with id 999999 not found/,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      electronHarness.consumeWarning(
        /IPC_INVALID_TARGET: Broadcast targets must be non-negative integer webContentsIds/,
      ),
    )
    .toBe(true);
});
