import { expect, test } from '../fixtures/electron';
import {
  control,
  forgeReply,
  getEvents,
  invokeMain,
  invokeTo,
  invokeToError,
  localControl,
} from '../support/driver';

test('destroy rejects pending work and permits recreation', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const other = electronHarness.page('other');
  const pending = invokeToError(main, 'waitRenderer', {
    timeout: 1_000,
    windowParams: ['sub', electronHarness.workspaceId],
  });

  await expect
    .poll(async () =>
      (await getEvents(sub)).some(
        (event) => event.kind === 'handle' && event.channel === 'waitRenderer',
      ),
    )
    .toBe(true);
  await control(other, 'destroy-service');
  await expect(pending).resolves.toMatchObject({
    code: 'IPC_REMOTE_ERROR',
    remoteCode: 'IPC_SERVICE_DESTROYED',
  });

  await control(other, 'recreate-service');
  await expect(invokeMain(main, 'echoMain', ['recreated'])).resolves.toBe(
    'recreated',
  );
  await expect(
    invokeTo(main, 'duplicate', {
      data: [5],
      windowParams: ['sub', electronHarness.workspaceId],
    }),
  ).resolves.toBe(10);
});

test('closing a target rejects immediately', async ({ electronHarness }) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const state = await control<{ windowIds: Record<string, number> }>(
    main,
    'state',
  );
  const pending = invokeToError(main, 'waitRenderer', {
    timeout: 1_000,
    windowParams: ['sub', electronHarness.workspaceId],
  });

  await expect
    .poll(async () =>
      (await getEvents(sub)).some(
        (event) => event.kind === 'handle' && event.channel === 'waitRenderer',
      ),
    )
    .toBe(true);
  await electronHarness.app.evaluate(({ BrowserWindow, webContents }, id) => {
    const target = webContents.fromId(id);
    if (target) {
      BrowserWindow.fromWebContents(target)?.close();
    }
  }, state.windowIds.sub);
  await expect(pending).resolves.toMatchObject({
    code: 'IPC_REMOTE_ERROR',
    remoteCode: 'IPC_TARGET_NOT_FOUND',
  });
});

test('a reply from a different renderer cannot settle a request', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const other = electronHarness.page('other');
  await control(sub, 'flush');

  const pending = invokeToError(main, 'waitRenderer', {
    timeout: 300,
    windowParams: ['sub', electronHarness.workspaceId],
  });

  await expect
    .poll(async () =>
      (await getEvents(sub)).find(
        (event) => event.kind === 'wire' && event.channel === 'waitRenderer',
      ),
    )
    .toBeTruthy();
  const wireEvent = (await getEvents(sub)).find(
    (event) => event.kind === 'wire' && event.channel === 'waitRenderer',
  );
  const requestId = (wireEvent?.data as { requestId?: string }).requestId;
  expect(requestId).toBeTruthy();

  await forgeReply(other, requestId as string, 'forged');
  await expect
    .poll(() => electronHarness.consumeWarning(/reply sender does not match/i))
    .toBe(true);

  const error = await pending;
  expect([error.code, error.remoteCode]).toContain('IPC_TIMEOUT');
});

test('renderer request handlers are unique', async ({ electronHarness }) => {
  const sub = electronHarness.page('sub');
  await expect(
    localControl(sub, 'register-duplicate-handler'),
  ).resolves.toMatchObject({
    code: 'IPC_HANDLER_ALREADY_REGISTERED',
  });
});

test('renderer destroy removes handlers and rejects local pending work', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const result = await localControl<{
    error: { code?: string };
    eventListenerCountAfter: number;
    eventListenerCountBefore: number;
    listenerCountAfter: number;
    listenerCountBefore: number;
  }>(main, 'destroy-with-pending');

  expect(result.eventListenerCountBefore).toBeGreaterThan(0);
  expect(result.eventListenerCountAfter).toBe(0);
  expect(result.listenerCountBefore).toBeGreaterThan(0);
  expect(result.listenerCountAfter).toBe(0);
  expect(result.error).toMatchObject({
    code: 'IPC_SERVICE_DESTROYED',
  });
});
