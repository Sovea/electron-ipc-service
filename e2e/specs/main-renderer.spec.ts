import { expect, test } from '../fixtures/electron';
import { control, invokeMain, sendMain } from '../support/driver';

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

test('invoke propagates results, errors, timeout and handler replacement', async ({
  electronHarness,
}) => {
  const page = electronHarness.page('main');

  await expect(invokeMain(page, 'echoMain', ['value'])).resolves.toBe('value');
  await expect(invokeMain(page, 'asyncMain', [21])).resolves.toBe(42);
  await expect(invokeMain(page, 'throwMain', ['main-boom'])).rejects.toThrow(
    /main-boom/,
  );
  await expect
    .poll(() => electronHarness.consumeMainError(/main-boom/))
    .toBe(true);
  await expect(invokeMain(page, 'onceMain', ['first'])).resolves.toBe(
    'once:first',
  );
  await expect(invokeMain(page, 'onceMain', ['second'])).rejects.toThrow(
    /No handler registered/,
  );
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
  await expect(invokeMain(page, 'waitMain', [], 100)).rejects.toThrow(
    /timed out/i,
  );
});
