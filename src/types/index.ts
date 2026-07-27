import type {
  IpcMainEvent,
  IpcMainInvokeEvent,
  IpcRendererEvent,
} from 'electron';
import type { Promisable } from 'type-fest';
import type { IpcError } from '../errors.js';

export type Fn<P extends unknown[] = never[], R = unknown> = (...args: P) => R;

export type EmptyIpcMap = Record<never, never>;

/**
 * Minimal endpoint shape. Public APIs additionally validate every request and
 * event member through {@link IpcEndpointConstraint}.
 */
export interface IpcEndpointSchema {
  requests: object;
  events: object;
}

export type IpcFunctionMapConstraint<T> = {
  [K in keyof T]: Fn;
};

export type IpcEndpointConstraint<T extends IpcEndpointSchema> = {
  requests: IpcFunctionMapConstraint<T['requests']>;
  events: IpcFunctionMapConstraint<T['events']>;
};

export type NormalizedIpcFunctionMap<T extends object> = {
  [K in keyof T]: Extract<T[K], Fn>;
};

export type NormalizedIpcEndpoint<T extends IpcEndpointSchema> = {
  requests: NormalizedIpcFunctionMap<T['requests']>;
  events: NormalizedIpcFunctionMap<T['events']>;
};

export type EmptyIpcEndpoint = {
  requests: EmptyIpcMap;
  events: EmptyIpcMap;
};

export type RendererIpcSource = {
  readonly kind: 'renderer';
  readonly webContentsId: number;
};

export type MainIpcSource = {
  readonly kind: 'main';
};

export type IpcSource = MainIpcSource | RendererIpcSource;

export type IpcContextBase<
  K extends 'request' | 'event',
  S extends IpcSource,
  E,
  C extends string = string,
> = {
  readonly kind: K;
  readonly channel: C;
  readonly source: S;
  readonly event: E;
};

export type MainRequestContext<C extends string = string> = IpcContextBase<
  'request',
  RendererIpcSource,
  IpcMainInvokeEvent,
  C
>;

export type MainEventContext<C extends string = string> = IpcContextBase<
  'event',
  RendererIpcSource,
  IpcMainEvent,
  C
>;

export type RendererRequestContext<C extends string = string> = IpcContextBase<
  'request',
  RendererIpcSource,
  IpcRendererEvent,
  C
>;

export type RendererEventContext<C extends string = string> = IpcContextBase<
  'event',
  RendererIpcSource,
  IpcRendererEvent,
  C
>;

export type RequestHandler<
  T extends IpcFunctionMapConstraint<T>,
  K extends keyof T,
  C,
> = (
  context: C,
  ...args: Parameters<T[K]>
) => Promisable<Awaited<ReturnType<T[K]>>>;

export type EventListener<
  T extends IpcFunctionMapConstraint<T>,
  K extends keyof T,
  C,
> = (context: C, ...args: Parameters<T[K]>) => Promisable<void>;

export interface IpcServiceBaseOptions {
  /**
   * prefix for ipc channel.
   * @default "ipc-service:"
   */
  ipcChannelPrefix?: string;
  /**
   * default timeout for requests in milliseconds. Use 0 to disable.
   * @default 5000
   */
  requestTimeout?: number;
  /**
   * receives asynchronous event and protocol errors.
   */
  onError?: (error: IpcError) => void | PromiseLike<void>;
}

/**
 * request options for ipc service.
 */
export type RequestOptions<
  T extends IpcFunctionMapConstraint<T>,
  K extends keyof T,
> = {
  /**
   * request timeout in milliseconds.
   * @default 5000
   */
  timeout?: number;
} & (Parameters<T[K]> extends [] ? { data?: [] } : { data: Parameters<T[K]> });

/**
 * response data type for ipc service.
 */
export type ResponseData<T extends Fn> = Awaited<ReturnType<T>> extends void
  ? undefined
  : Awaited<ReturnType<T>>;

/**
 * unsubscribe function type.
 */
export type Unsubscribe = () => void;
