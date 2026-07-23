import type { IpcRendererEvent } from 'electron';
import type { Promisable, UnionToIntersection } from 'type-fest';
import type { IpcRendererService } from '../core/renderer.js';
import type { Fn, RequestOptions, ResponseData } from './index.js';

/**
 * API type between renderers.
 */
export type APIBetweenRenderers = keyof Pick<
  IpcRendererService,
  'handle' | 'handleOnce' | 'receive' | 'receiveOnce' | 'invokeTo' | 'sendTo'
>;

type EmptyRecord = Record<never, never>;

/** Fallback request options when the target renderer is not known statically. */
export type UnknownRequestOptions = {
  timeout?: number;
  data?: unknown[];
};

export type UnknownSendOptions = Omit<UnknownRequestOptions, 'timeout'>;

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
  M extends Record<string, Fn> = EmptyRecord,
  S extends Partial<Record<I, Record<string, Fn>>> = EmptyRecord,
  C extends Record<string, Fn> = EmptyRecord,
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

/** Channels handled by one renderer, including channels shared by all renderers. */
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

/**
 * Specialize the getWebContentsId parameters for a target renderer while
 * preserving the remaining query parameters.
 */
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

/** Channel names reachable on any renderer other than the current one. */
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

/** Strict request options for a target identified by getWebContentsId parameters. */
export type IpcInvokeToOptions<
  T extends MultiRenderersSchema,
  Q extends Fn<any, number | undefined>,
  K extends IpcRendererId<T>,
  C extends keyof IpcRendererChannels<T, K>,
> = RequestOptions<IpcRendererChannels<T, K>, C> & {
  webContentsId?: never;
  windowParams: IpcWindowParams<T, Q, K>;
};

export type IpcSendToOptions<
  T extends MultiRenderersSchema,
  Q extends Fn<any, number | undefined>,
  K extends IpcRendererId<T>,
  C extends keyof IpcRendererChannels<T, K>,
> = Omit<RequestOptions<IpcRendererChannels<T, K>, C>, 'timeout'> & {
  webContentsId?: never;
  windowParams: IpcWindowParams<T, Q, K>;
};

type IpcRendererChannel<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
  C extends keyof IpcRendererChannels<T, K>,
> = Extract<IpcRendererChannels<T, K>[C], Fn>;

/** Safe fallback for ID-only routing, where no target schema can be selected. */
export type IpcInvokeToUnknownOptions = UnknownRequestOptions & {
  webContentsId: number;
  windowParams?: never;
};

export type IpcSendToUnknownOptions = UnknownSendOptions & {
  webContentsId: number;
  windowParams?: never;
};

/**
 * Renderer service with target-aware invokeTo/sendTo overloads.
 * Runtime behavior is unchanged; only the public call types are specialized.
 */
export type InterRendererIpcRendererService<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
  Q extends Fn<any, number | undefined>,
> = Omit<
  IpcRendererService<IpcRequests<T, K>, IpcHandles<T, K>, T['main'], Q>,
  'invokeTo' | 'sendTo'
> & {
  /** Infer data and result through the getWebContentsId/schema relationship. */
  invokeTo<
    Target extends IpcTargetRendererId<T, K>,
    C extends keyof IpcRendererChannels<T, Target> & string,
  >(
    channel: C,
    options: IpcInvokeToOptions<T, Q, Target, C>,
  ): Promise<Awaited<ReturnType<IpcRendererChannel<T, Target, C>>>>;
  /** Keep ID-only routing safe because its target schema is unknown. */
  invokeTo<C extends IpcRequestChannels<T, K> & string>(
    channel: C,
    options: IpcInvokeToUnknownOptions,
  ): Promise<unknown>;
  /** Infer data through the getWebContentsId/schema relationship. */
  sendTo<
    Target extends IpcTargetRendererId<T, K>,
    C extends keyof IpcRendererChannels<T, Target> & string,
  >(channel: C, options: IpcSendToOptions<T, Q, Target, C>): void;
  /** Keep ID-only routing data intentionally unknown. */
  sendTo<C extends IpcRequestChannels<T, K> & string>(
    channel: C,
    options: IpcSendToUnknownOptions,
  ): void;
};
