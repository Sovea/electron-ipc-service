import { expect, test } from '../fixtures/electron';
import {
  clearEvents,
  control,
  getEvents,
  invokeTo,
  sendTo,
} from '../support/driver';

test('windowParams, webContentsId and common channels route correctly', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const state = await control<{ windowIds: Record<string, number> }>(
    main,
    'state',
  );

  await expect(
    invokeTo(main, 'duplicate', {
      data: [3],
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).resolves.toBe(6);
  await expect(
    invokeTo(main, 'duplicate', {
      data: [true],
      windowParams: ['other', electronHarness.workspaceId],
    }),
  ).resolves.toBe(false);
  await expect(
    invokeTo(main, 'common', {
      data: ['value'],
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).resolves.toBe('sub:value');
  await expect(
    invokeTo(main, 'subOnly', {
      data: [true],
      webContentsId: state.windowIds.sub,
    }),
  ).resolves.toBe(false);
  await expect(
    invokeTo(main, 'throwRenderer', {
      data: ['renderer-boom'],
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).rejects.toThrow(/renderer-boom/);
  await expect
    .poll(() => electronHarness.consumeMainError(/renderer-boom/))
    .toBe(true);

  const subEvents = await getEvents(sub);
  expect(
    subEvents.some((event) => event.sourceId === state.windowIds.main),
  ).toBe(true);
});

test('sendTo preserves payload and source metadata', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const state = await control<{ windowIds: Record<string, number> }>(
    main,
    'state',
  );
  await clearEvents(sub);

  await sendTo(main, 'receiveMessage', {
    data: ['message'],
    windowParams: ['sub', electronHarness.workspaceId],
  });
  await sendTo(main, 'receiveOnceMessage', {
    data: ['first'],
    windowParams: ['sub', electronHarness.workspaceId],
  });
  await sendTo(main, 'receiveOnceMessage', {
    data: ['ignored'],
    windowParams: ['sub', electronHarness.workspaceId],
  });
  await sendTo(main, 'unsubscribedMessage', {
    data: ['ignored'],
    windowParams: ['sub', electronHarness.workspaceId],
  });

  await expect
    .poll(() => getEvents(sub))
    .toEqual(
      expect.arrayContaining([
        {
          kind: 'receive',
          channel: 'receiveMessage',
          data: 'message',
        },
        {
          kind: 'wire',
          channel: 'receiveMessage',
          sourceId: state.windowIds.main,
        },
        {
          kind: 'receive',
          channel: 'receiveOnceMessage',
          data: 'first',
        },
      ]),
    );
  const events = await getEvents(sub);
  expect(
    events.filter((event) => event.channel === 'receiveOnceMessage'),
  ).toEqual([
    {
      kind: 'receive',
      channel: 'receiveOnceMessage',
      data: 'first',
    },
  ]);
  expect(events.some((event) => event.channel === 'unsubscribedMessage')).toBe(
    false,
  );
});

test('invalid selectors and targets reject invokeTo and safely drop sendTo', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const state = await control<{ windowIds: Record<string, number> }>(
    main,
    'state',
  );
  await clearEvents(sub);

  await expect(
    invokeTo(main, 'duplicate', {
      data: [1],
      webContentsId: state.windowIds.sub,
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).rejects.toThrow(/exactly one of webContentsId or windowParams is required/);
  await expect
    .poll(() =>
      electronHarness.consumeMainError(
        /exactly one of webContentsId or windowParams is required/,
      ),
    )
    .toBe(true);
  await expect(
    invokeTo(main, 'duplicate', {
      data: [1],
      webContentsId: state.windowIds.other,
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).rejects.toThrow(/exactly one of webContentsId or windowParams is required/);
  await expect
    .poll(() =>
      electronHarness.consumeMainError(
        /exactly one of webContentsId or windowParams is required/,
      ),
    )
    .toBe(true);
  await expect(
    invokeTo(main, 'duplicate', {
      data: [1],
    }),
  ).rejects.toThrow(/exactly one of webContentsId or windowParams is required/);
  await expect
    .poll(() =>
      electronHarness.consumeMainError(
        /exactly one of webContentsId or windowParams is required/,
      ),
    )
    .toBe(true);
  await expect(
    invokeTo(main, 'duplicate', {
      data: [1],
      windowParams: ['sub', 'missing-workspace'],
    }),
  ).rejects.toThrow(/windowParams did not resolve to a webContentsId/);
  await expect
    .poll(() =>
      electronHarness.consumeMainError(
        /windowParams did not resolve to a webContentsId/,
      ),
    )
    .toBe(true);
  await expect(
    invokeTo(main, 'duplicate', {
      data: [1],
      webContentsId: 999_999,
    }),
  ).rejects.toThrow(/not found/);
  await expect
    .poll(() => electronHarness.consumeMainError(/999999.*not found/))
    .toBe(true);
  await expect(
    invokeTo(main, 'duplicate', {
      data: [1],
      webContentsId: 0,
    }),
  ).rejects.toThrow(/with id 0 not found/);
  await expect
    .poll(() => electronHarness.consumeMainError(/with id 0 not found/))
    .toBe(true);

  await sendTo(main, 'receiveMessage', {
    data: ['dropped-same-target'],
    webContentsId: state.windowIds.sub,
    windowParams: ['sub', electronHarness.workspaceId],
  });
  await expect
    .poll(() =>
      electronHarness.consumeWarning(
        /^\[electron-ipc-service\] sendTo dropped "e2e:[^"]+:external:receiveMessage": exactly one of webContentsId or windowParams is required$/,
      ),
    )
    .toBe(true);

  await sendTo(main, 'receiveMessage', {
    data: ['dropped-mismatch'],
    webContentsId: state.windowIds.other,
    windowParams: ['sub', electronHarness.workspaceId],
  });
  await expect
    .poll(() =>
      electronHarness.consumeWarning(
        /^\[electron-ipc-service\] sendTo dropped "e2e:[^"]+:external:receiveMessage": exactly one of webContentsId or windowParams is required$/,
      ),
    )
    .toBe(true);

  await sendTo(main, 'receiveMessage', {
    data: ['dropped-no-target'],
  });
  await expect
    .poll(() =>
      electronHarness.consumeWarning(
        /^\[electron-ipc-service\] sendTo dropped "e2e:[^"]+:external:receiveMessage": exactly one of webContentsId or windowParams is required$/,
      ),
    )
    .toBe(true);

  await sendTo(main, 'receiveMessage', {
    data: ['dropped-unresolved-query'],
    windowParams: ['sub', 'missing-workspace'],
  });
  await expect
    .poll(() =>
      electronHarness.consumeWarning(
        /^\[electron-ipc-service\] sendTo dropped "e2e:[^"]+:external:receiveMessage": windowParams did not resolve to a webContentsId$/,
      ),
    )
    .toBe(true);

  await sendTo(main, 'receiveMessage', {
    data: ['dropped-missing'],
    webContentsId: 999_999,
  });
  await expect
    .poll(() =>
      electronHarness.consumeWarning(
        /^\[electron-ipc-service\] sendTo dropped "e2e:[^"]+:external:receiveMessage": webContents with id 999999 not found$/,
      ),
    )
    .toBe(true);
  expect(await getEvents(sub)).toEqual([]);
});
