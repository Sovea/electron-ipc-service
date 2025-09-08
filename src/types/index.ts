export type Fn<P extends any[] = any[], R = any> = (...args: P) => R;

export type Optional<T> = T extends null ? never : T | undefined;

export interface IpcServiceBaseOptions {
  /**
   * prefix for ipc channel.
   * @default "ipc-service:"
   */
  ipcChannelPrefix?: string;
  /**
   * timeout for pending requests in milliseconds.
   * @default 5000
   */
  pendingRequestTimeout?: number;
}

/**
 * request options for ipc service.
 */
export type RequestOptions<T extends Record<string, Fn>, K extends keyof T> = {
  /**
   * request timeout in milliseconds.
   * @default 5000
   */
  timeout?: number;
} & (Parameters<T[K]>['length'] extends 0
  ? { data?: unknown[] }
  : { data: Parameters<T[K]> });

/**
 * response data type for ipc service.
 */
export type ResponseData<T extends Fn> = ReturnType<T> extends void
  ? undefined
  : ReturnType<T>;

/**
 * unsubscribe function type.
 */
export type Unsubscribe = () => void;
