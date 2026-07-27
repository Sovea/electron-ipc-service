import { expect, test } from '../fixtures/electron';
import {
  clearEvents,
  control,
  getEvents,
  invokeTo,
  invokeToError,
  localControl,
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
    invokeToError(main, 'throwRenderer', {
      data: ['renderer-boom'],
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).resolves.toMatchObject({
    code: 'IPC_REMOTE_ERROR',
    message: 'renderer-boom',
    name: 'IpcRemoteError',
    remoteCode: 'IPC_REMOTE_ERROR',
  });

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
  await sendTo(main, 'receiveMessage', {
    data: ['message-by-id'],
    webContentsId: state.windowIds.sub,
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
          sourceId: state.windowIds.main,
        },
        {
          kind: 'receive',
          channel: 'receiveMessage',
          data: 'message-by-id',
          sourceId: state.windowIds.main,
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
          sourceId: state.windowIds.main,
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
      sourceId: state.windowIds.main,
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
    invokeToError(main, 'duplicate', {
      data: [1],
      webContentsId: state.windowIds.sub,
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).resolves.toMatchObject({
    code: 'IPC_REMOTE_ERROR',
    remoteCode: 'IPC_INVALID_TARGET',
  });
  await expect(
    invokeToError(main, 'duplicate', {
      data: [1],
      webContentsId: state.windowIds.other,
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).resolves.toMatchObject({
    remoteCode: 'IPC_INVALID_TARGET',
  });
  await expect(
    invokeToError(main, 'duplicate', {
      data: [1],
    }),
  ).resolves.toMatchObject({
    remoteCode: 'IPC_INVALID_TARGET',
  });
  await expect(
    invokeToError(main, 'duplicate', {
      data: [1],
      windowParams: ['sub', 'missing-workspace'],
    }),
  ).resolves.toMatchObject({
    remoteCode: 'IPC_TARGET_NOT_FOUND',
  });
  await expect(
    invokeToError(main, 'duplicate', {
      data: [1],
      webContentsId: 999_999,
    }),
  ).resolves.toMatchObject({
    remoteCode: 'IPC_TARGET_NOT_FOUND',
  });
  await expect(
    invokeToError(main, 'duplicate', {
      data: [1],
      webContentsId: 0,
    }),
  ).resolves.toMatchObject({
    remoteCode: 'IPC_TARGET_NOT_FOUND',
  });

  await sendTo(main, 'receiveMessage', {
    data: ['dropped-same-target'],
    webContentsId: state.windowIds.sub,
    windowParams: ['sub', electronHarness.workspaceId],
  });
  await expect
    .poll(() =>
      electronHarness.consumeWarning(
        /^\[electron-ipc-service\] IPC_INVALID_TARGET: exactly one of webContentsId or windowParams is required$/,
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
        /^\[electron-ipc-service\] IPC_INVALID_TARGET: exactly one of webContentsId or windowParams is required$/,
      ),
    )
    .toBe(true);

  await sendTo(main, 'receiveMessage', {
    data: ['dropped-no-target'],
  });
  await expect
    .poll(() =>
      electronHarness.consumeWarning(
        /^\[electron-ipc-service\] IPC_INVALID_TARGET: exactly one of webContentsId or windowParams is required$/,
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
        /^\[electron-ipc-service\] IPC_TARGET_NOT_FOUND: windowParams did not resolve to a webContentsId$/,
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
        /^\[electron-ipc-service\] IPC_TARGET_NOT_FOUND: webContents with id 999999 not found$/,
      ),
    )
    .toBe(true);
  expect(await getEvents(sub)).toEqual([]);
});

test('unserializable renderer responses fail without waiting for timeout', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  await localControl(sub, 'clear-reported-errors');

  await expect(
    invokeToError(main, 'unserializable', {
      timeout: 1_000,
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).resolves.toMatchObject({
    code: 'IPC_REMOTE_ERROR',
    remoteCode: 'IPC_SERIALIZATION_ERROR',
  });

  await expect
    .poll(() => localControl(sub, 'reported-errors'))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'IPC_SERIALIZATION_ERROR',
        }),
      ]),
    );
});

test('async onError rejections are observed without an unhandled rejection', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  await localControl(sub, 'clear-reported-errors');
  await localControl(sub, 'reject-reported-errors', true);

  await sendTo(main, 'throwRendererEvent', {
    windowParams: ['sub', electronHarness.workspaceId],
  });
  await expect
    .poll(() => localControl(sub, 'reported-errors'))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'IPC_PROTOCOL_ERROR',
          message: 'renderer-event-boom',
        }),
      ]),
    );
  await expect
    .poll(() =>
      electronHarness.consumeRendererWarning(/onError failed.*rejection/i),
    )
    .toBe(true);
  await expect
    .poll(() =>
      electronHarness.consumeRendererWarning(
        /IPC_PROTOCOL_ERROR: renderer-event-boom/,
      ),
    )
    .toBe(true);
});
