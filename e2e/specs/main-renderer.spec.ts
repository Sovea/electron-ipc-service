import { expect, test } from '../fixtures/electron';
import {
  control,
  invokeMain,
  invokeMainError,
  sendMain,
} from '../support/driver';

test('send, once and unsubscribe preserve event semantics', async ({
  electronHarness,
}) => {
  const page = electronHarness.page('main');
  await control(page, 'clear-main-events');

  await sendMain(page, 'mainEvent', ['first']);
  await sendMain(page, 'mainEvent', ['second']);
  await sendMain(page, 'mainOnceEvent', ['once']);
  await sendMain(page, 'mainOnceEvent', ['ignored']);

  await expect
    .poll(() => control(page, 'main-events'))
    .toEqual([
      { channel: 'mainEvent', value: 'first' },
      { channel: 'mainEvent', value: 'second' },
      { channel: 'mainOnceEvent', value: 'once' },
    ]);

  await control(page, 'unsubscribe-main-event');
  await sendMain(page, 'mainEvent', ['ignored']);
  await control(page, 'flush');
  expect(await control(page, 'main-events')).toHaveLength(3);
});

test('request and event channels with the same name do not collide', async ({
  electronHarness,
}) => {
  const page = electronHarness.page('main');
  await control(page, 'clear-main-events');

  await sendMain(page, 'sameChannel', ['event-value']);
  await expect(
    invokeMain(page, 'sameChannel', ['request-value']),
  ).resolves.toBe('request:request-value');
  await expect
    .poll(() => control(page, 'main-events'))
    .toEqual([{ channel: 'sameChannel', value: 'event-value' }]);
});

test('invoke propagates results, errors, timeout and handler replacement', async ({
  electronHarness,
}) => {
  const page = electronHarness.page('main');

  await expect(invokeMain(page, 'echoMain', ['value'])).resolves.toBe('value');
  await expect(invokeMain(page, 'asyncMain', [21])).resolves.toBe(42);
  await expect(
    invokeMainError(page, 'throwMain', ['main-boom']),
  ).resolves.toMatchObject({
    code: 'IPC_REMOTE_ERROR',
    message: 'main-boom',
    remoteCode: 'IPC_REMOTE_ERROR',
  });
  await expect(invokeMain(page, 'onceMain', ['first'])).resolves.toBe(
    'once:first',
  );
  await expect(
    invokeMainError(page, 'onceMain', ['second']),
  ).resolves.toMatchObject({
    code: 'IPC_PROTOCOL_ERROR',
    message: expect.stringMatching(/No handler registered/),
  });
  await expect
    .poll(() => electronHarness.consumeMainError(/No handler registered/))
    .toBe(true);

  await expect(invokeMain(page, 'removableMain', ['before'])).resolves.toBe(
    'handler-1:before',
  );
  await control(page, 'replace-removable-handler');
  await expect(invokeMain(page, 'removableMain', ['after'])).resolves.toBe(
    'handler-2:after',
  );
  await expect(
    invokeMainError(page, 'waitMain', [], 100),
  ).resolves.toMatchObject({
    code: 'IPC_TIMEOUT',
  });

  await expect(
    invokeMainError(page, 'echoMain', ['value'], -1),
  ).resolves.toMatchObject({
    code: 'IPC_PROTOCOL_ERROR',
    message: expect.stringMatching(/timeout/i),
  });

  await sendMain(page, 'throwMainEvent');
  await expect
    .poll(() => electronHarness.consumeWarning(/main-event-boom/))
    .toBe(true);
});
