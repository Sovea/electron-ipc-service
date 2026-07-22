import { expect, test } from '../fixtures/electron';
import { control, getEvents, invokeMain, invokeTo } from '../support/driver';

test('destroy rejects pending work and permits recreation', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const other = electronHarness.page('other');
  const pending = invokeTo(main, 'waitRenderer', {
    timeout: 1_000,
    windowParams: ['sub', electronHarness.workspaceId],
  });
  const pendingAssertion = expect(pending).rejects.toThrow(/reject/i);

  await expect
    .poll(async () =>
      (await getEvents(sub)).some(
        (event) => event.kind === 'handle' && event.channel === 'waitRenderer',
      ),
    )
    .toBe(true);
  await control(other, 'destroy-service');
  await pendingAssertion;
  await expect
    .poll(() => electronHarness.consumeMainError(/has been reject/))
    .toBe(true);

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

test('closing a target rejects after the configured timeout', async ({
  electronHarness,
}) => {
  const main = electronHarness.page('main');
  const sub = electronHarness.page('sub');
  const state = await control<{ windowIds: Record<string, number> }>(
    main,
    'state',
  );
  const pending = invokeTo(main, 'waitRenderer', {
    timeout: 200,
    windowParams: ['sub', electronHarness.workspaceId],
  });
  const pendingAssertion = expect(pending).rejects.toThrow(/timeout/i);

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
  await pendingAssertion;
  await expect
    .poll(() => electronHarness.consumeMainError(/Request timeout/))
    .toBe(true);
});
