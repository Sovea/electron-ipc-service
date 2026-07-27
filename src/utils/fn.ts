import type { Fn } from '../types/index.js';

export function withTimeout<T>(
  promise: PromiseLike<T>,
  timeout: number,
  createError: () => Error,
): Promise<T> {
  if (timeout === 0) {
    return Promise.resolve(promise);
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createError());
    }, timeout);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function processFunction<T extends Fn>(
  fn: T,
  options: {
    timeout: number;
    data: Parameters<T>;
    createTimeoutError: () => Error;
  },
): Promise<Awaited<ReturnType<T>>> {
  let result: ReturnType<T>;
  try {
    result = fn(...options.data) as ReturnType<T>;
  } catch (error) {
    return Promise.reject(error);
  }
  return withTimeout(
    Promise.resolve(result),
    options.timeout,
    options.createTimeoutError,
  );
}
