import { expect, test } from '../fixtures/electron';
import { control } from '../support/driver';

test('packed consumer launches all renderer processes', async ({
  electronHarness,
}) => {
  const state = await control<{
    electronVersion: string;
    readyRenderers: string[];
    windowIds: Record<string, number>;
    workspaceId: string;
  }>(electronHarness.page('main'), 'state');

  expect(state.electronVersion).toBe(electronHarness.electronVersion);
  expect(state.workspaceId).toBe(electronHarness.workspaceId);
  expect(state.readyRenderers).toEqual(['main', 'other', 'sub']);
  expect(Object.keys(state.windowIds).sort()).toEqual(['main', 'other', 'sub']);
});
