import type { IpcRendererEvent } from 'electron';
import type { Promisable, UnionToIntersection } from 'type-fest';
import type { IpcRendererService } from '../core/renderer';
import type { Fn, RequestOptions, ResponseData } from '.';

/**
 * API type between renderers.
 */
export type APIBetweenRenderers = keyof Pick<
  IpcRendererService,
  | 'connectTo'
  | 'handle'
  | 'handleOnce'
  | 'invokeTo'
  | 'onConnect'
  | 'receive'
  | 'receiveOnce'
  | 'sendTo'
>;

type EmptyRecord = Record<never, never>;

export type UnknownRequestOptions = {
  timeout?: number;
  data?: unknown[];
};

export type UnknownSendOptions = Omit<UnknownRequestOptions, 'timeout'>;

export interface IpcRendererConnectionOptions {
  timeout?: number;
  webContentsId?: number;
  windowParams?: unknown[];
}

export interface IpcRendererConnectionEvent {
  channel: string;
  sourceWebContentsId: number;
  targetWebContentsId: number;
}

export type IpcRendererMessagePort = IpcRendererEvent['ports'][number];

export type IpcRendererConnectionListener = (
  event: IpcRendererConnectionEvent,
  port: IpcRendererMessagePort,
) => void;

/**
 * listener type in ipc renderer service.
 */
export type IpcRendererServiceListener<
  T extends Record<string, Fn>,
  K extends keyof T,
> = (
  event: IpcRendererEvent,
  data: Parameters<T[K]>,
  options: { requestId: string; webContentsId: number; timeout?: number },
) => Promisable<ResponseData<T[K]>>;

/**
 * Schema for multiple renderers.
 * @template I - Renderer unique identifier type
 * @template M - Renderer - Main ipc schema type
 * @template S - Specific Renderer - Renderer ipc schema type
 * @template C - Common Renderer - Renderer ipc schema type
 */
export type MultiRenderersSchema<
  I extends string | number = string,
  M extends Record<string, Fn> = any,
  S extends Partial<Record<I, Record<string, Fn>>> = any,
  C extends Record<string, Fn> = any,
> = {
  _type: I;
  main: M;
  renderer: {
    specified: S;
    common: C;
  };
};

/**
 * Get the renderer unique identifier type from MultiRenderersSchema.
 */
export type IpcRendererId<T extends MultiRenderersSchema> = T extends {
  _type: infer I;
}
  ? I
  : never;

export type IpcRendererSchema<T extends MultiRenderersSchema> =
  T['renderer']['specified'];

export type IpcRendererChannels<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = T['renderer']['common'] &
  (K extends keyof IpcRendererSchema<T>
    ? IpcRendererSchema<T>[K]
    : EmptyRecord);

export type IpcTargetRendererId<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = Exclude<IpcRendererId<T>, K>;

export type IpcWindowParams<
  T extends MultiRenderersSchema,
  Q extends Fn<any, number | undefined>,
  K extends IpcRendererId<T>,
> = Parameters<Q> extends [infer I, ...infer Rest]
  ? K extends I
    ? [K, ...Rest]
    : never
  : never;

/**
 * ipc renderer service schema request type.
 */
export type IpcRequests<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = UnionToIntersection<
  T['renderer']['specified'][Exclude<keyof T['renderer']['specified'], K>]
> &
  T['renderer']['common'];

export type IpcRequestChannels<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> =
  | keyof T['renderer']['common']
  | keyof UnionToIntersection<
      T['renderer']['specified'][Exclude<keyof T['renderer']['specified'], K>]
    >;

/**
 * ipc renderer service schema handle type.
 */
export type IpcHandles<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = IpcRendererChannels<T, K>;

export type IpcInvokeToOptions<
  T extends MultiRenderersSchema,
  Q extends Fn<any, number | undefined>,
  K extends IpcRendererId<T>,
  C extends keyof IpcRendererChannels<T, K>,
> = RequestOptions<IpcRendererChannels<T, K>, C> & {
  webContentsId?: number;
  windowParams: IpcWindowParams<T, Q, K>;
};

export type IpcSendToOptions<
  T extends MultiRenderersSchema,
  Q extends Fn<any, number | undefined>,
  K extends IpcRendererId<T>,
  C extends keyof IpcRendererChannels<T, K>,
> = Omit<RequestOptions<IpcRendererChannels<T, K>, C>, 'timeout'> & {
  webContentsId?: number;
  windowParams: IpcWindowParams<T, Q, K>;
};

export type IpcInvokeToUnknownOptions = UnknownRequestOptions & {
  webContentsId: number;
  windowParams?: never;
};

export type IpcSendToUnknownOptions = UnknownSendOptions & {
  webContentsId: number;
  windowParams?: never;
};

export type InterRendererIpcRendererService<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
  Q extends Fn<any, number | undefined>,
> = Omit<
  IpcRendererService<IpcRequests<T, K>, IpcHandles<T, K>, T['main'], Q>,
  'invokeTo' | 'sendTo'
> & {
  invokeTo<
    Target extends IpcTargetRendererId<T, K>,
    C extends keyof IpcRendererChannels<T, Target> & string,
  >(
    channel: C,
    options: IpcInvokeToOptions<T, Q, Target, C>,
  ): Promise<Awaited<ReturnType<IpcRendererChannels<T, Target>[C]>>>;
  invokeTo<C extends IpcRequestChannels<T, K> & string>(
    channel: C,
    options: IpcInvokeToUnknownOptions,
  ): Promise<unknown>;
  sendTo<
    Target extends IpcTargetRendererId<T, K>,
    C extends keyof IpcRendererChannels<T, Target> & string,
  >(channel: C, options: IpcSendToOptions<T, Q, Target, C>): void;
  sendTo<C extends IpcRequestChannels<T, K> & string>(
    channel: C,
    options: IpcSendToUnknownOptions,
  ): void;
};
