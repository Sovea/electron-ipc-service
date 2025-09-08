import type { Fn } from '../types';

/**
 * process async/sync function
 * @param fn function to be processed
 * @param options.timeout timeout in milliseconds
 */
export async function processFunction<T extends Fn<[], any>>(
  fn: T,
  options?: {
    timeout?: number;
  },
): Promise<Awaited<ReturnType<T>>>;
/**
 * process async/sync function
 * @param fn function to be processed
 * @param options.data function arguments
 * @param options.timeout timeout in milliseconds
 */
export async function processFunction<T extends Fn>(
  fn: T,
  options: {
    timeout?: number;
    data: Parameters<T>;
  },
): Promise<Awaited<ReturnType<T>>>;
export async function processFunction<T extends Fn>(
  fn: T,
  options?: {
    timeout?: number;
    data?: Parameters<T>;
  },
): Promise<Awaited<ReturnType<T>>> {
  const { data = [], timeout = 0 } = options || {};
  const functionExecution = Promise.resolve(fn(...data));
  if (timeout > 0) {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Process function timed out'));
      }, timeout);
    });
    return await Promise.race([functionExecution, timeoutPromise]);
  }
  return await functionExecution;
}
