import type { Page } from '@playwright/test';
import type { DriverEvent, E2EDriver, TargetOptions } from '../app/src/schema';

type DriverWindow = typeof window & { e2e: E2EDriver };

export function invokeMain(
  page: Page,
  channel: string,
  data: unknown[] = [],
  timeout?: number,
) {
  return page.evaluate(
    ({ channel, data, timeout }) =>
      (window as DriverWindow).e2e.invokeMain(channel, data, timeout),
    { channel, data, timeout },
  );
}

export async function sendMain(
  page: Page,
  channel: string,
  data: unknown[] = [],
) {
  await page.evaluate(
    ({ channel, data }) => (window as DriverWindow).e2e.sendMain(channel, data),
    { channel, data },
  );
}

export function invokeTo(page: Page, channel: string, options: TargetOptions) {
  return page.evaluate(
    ({ channel, options }) =>
      (window as DriverWindow).e2e.invokeTo(channel, options),
    { channel, options },
  );
}

export async function sendTo(
  page: Page,
  channel: string,
  options: Omit<TargetOptions, 'timeout'>,
) {
  await page.evaluate(
    ({ channel, options }) =>
      (window as DriverWindow).e2e.sendTo(channel, options),
    { channel, options },
  );
}

export function control<T>(page: Page, command: string, payload?: unknown) {
  return page.evaluate(
    ({ command, payload }) =>
      (window as DriverWindow).e2e.control<T>(command, payload),
    { command, payload },
  );
}

export function getEvents(page: Page): Promise<DriverEvent[]> {
  return page.evaluate(() => (window as DriverWindow).e2e.getEvents());
}

export async function clearEvents(page: Page) {
  await page.evaluate(() => (window as DriverWindow).e2e.clearEvents());
}
