import type { UnionToIntersection } from 'type-fest';
import type { IpcRendererService } from '../core/renderer.js';
import type {
  EmptyIpcEndpoint,
  EmptyIpcMap,
  EventListener,
  Fn,
  IpcEndpointConstraint,
  IpcEndpointSchema,
  IpcFunctionMapConstraint,
  NormalizedIpcEndpoint,
  RendererEventContext,
  RendererRequestContext,
  RequestHandler,
  RequestOptions,
} from './index.js';

export type APIBetweenRenderers = keyof Pick<
  IpcRendererService,
  'handle' | 'handleOnce' | 'receive' | 'receiveOnce' | 'invokeTo' | 'sendTo'
>;

export type UnknownRequestOptions = {
  timeout?: number;
  data?: unknown[];
};

export type UnknownSendOptions = Omit<UnknownRequestOptions, 'timeout'>;

export type IpcRendererRequestHandler<
  T extends IpcFunctionMapConstraint<T>,
  K extends keyof T & string,
> = RequestHandler<T, K, RendererRequestContext<K>>;

export type IpcRendererEventListener<
  T extends IpcFunctionMapConstraint<T>,
  K extends keyof T & string,
> = EventListener<T, K, RendererEventContext<K>>;

type IpcEndpointMapConstraint<T> = {
  [K in keyof T]: T[K] extends IpcEndpointSchema
    ? IpcEndpointConstraint<T[K]>
    : never;
};

/**
 * Schema for multiple renderer endpoints.
 * @template I Renderer identifier type
 * @template M Channels handled by the main process
 * @template S Channels handled by specific renderers
 * @template C Channels handled by every renderer
 */
export type MultiRenderersSchema<
  I extends string | number = string | number,
  M extends IpcEndpointConstraint<M> = EmptyIpcEndpoint,
  S extends Partial<Record<I, IpcEndpointSchema>> &
    IpcEndpointMapConstraint<S> = Record<never, never>,
  C extends IpcEndpointConstraint<C> = EmptyIpcEndpoint,
> = {
  _type: I;
  main: M;
  renderer: {
    specified: S;
    common: C;
  };
};

export type IpcRendererId<T extends MultiRenderersSchema> = T extends {
  _type: infer I;
}
  ? I
  : never;

export type IpcRendererSchema<T extends MultiRenderersSchema> =
  T['renderer']['specified'];

type SpecificRendererEndpoint<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = K extends keyof IpcRendererSchema<T>
  ? Extract<IpcRendererSchema<T>[K], IpcEndpointSchema>
  : EmptyIpcEndpoint;

type MergeIpcMaps<A extends object, B extends object> = {
  [P in keyof A | keyof B]: P extends keyof B
    ? Extract<B[P], Fn>
    : P extends keyof A
      ? Extract<A[P], Fn>
      : never;
};

/** Channels handled by one renderer, including common channels. */
export type IpcRendererEndpoint<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = {
  requests: MergeIpcMaps<
    T['renderer']['common']['requests'],
    SpecificRendererEndpoint<T, K>['requests']
  >;
  events: MergeIpcMaps<
    T['renderer']['common']['events'],
    SpecificRendererEndpoint<T, K>['events']
  >;
};

export type IpcTargetRendererId<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = Exclude<IpcRendererId<T>, K>;

export type IpcWindowParams<
  T extends MultiRenderersSchema,
  Q extends Fn<never[], number | undefined>,
  K extends IpcRendererId<T>,
> = Parameters<Q> extends [infer I, ...infer Rest]
  ? K extends I
    ? [K, ...Rest]
    : never
  : never;

type OtherSpecificEndpoints<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = Extract<
  T['renderer']['specified'][Exclude<keyof T['renderer']['specified'], K>],
  IpcEndpointSchema
>;

type OtherRequests<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = OtherSpecificEndpoints<T, K> extends infer Endpoint
  ? Endpoint extends IpcEndpointSchema
    ? Endpoint['requests']
    : never
  : never;

type OtherEvents<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = OtherSpecificEndpoints<T, K> extends infer Endpoint
  ? Endpoint extends IpcEndpointSchema
    ? Endpoint['events']
    : never
  : never;

export type IpcRequests<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = MergeIpcMaps<
  T['renderer']['common']['requests'],
  UnionToIntersection<OtherRequests<T, K>> extends object
    ? UnionToIntersection<OtherRequests<T, K>>
    : EmptyIpcMap
>;

export type IpcEvents<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = MergeIpcMaps<
  T['renderer']['common']['events'],
  UnionToIntersection<OtherEvents<T, K>> extends object
    ? UnionToIntersection<OtherEvents<T, K>>
    : EmptyIpcMap
>;

export type IpcRequestChannels<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> =
  | keyof T['renderer']['common']['requests']
  | keyof UnionToIntersection<OtherRequests<T, K>>;

export type IpcEventChannels<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> =
  | keyof T['renderer']['common']['events']
  | keyof UnionToIntersection<OtherEvents<T, K>>;

export type IpcInvokeToOptions<
  T extends MultiRenderersSchema,
  Q extends Fn<never[], number | undefined>,
  K extends IpcRendererId<T>,
  C extends keyof IpcRendererEndpoint<T, K>['requests'],
> = RequestOptions<IpcRendererEndpoint<T, K>['requests'], C> & {
  webContentsId?: never;
  windowParams: IpcWindowParams<T, Q, K>;
};

export type IpcSendToOptions<
  T extends MultiRenderersSchema,
  Q extends Fn<never[], number | undefined>,
  K extends IpcRendererId<T>,
  C extends keyof IpcRendererEndpoint<T, K>['events'],
> = Omit<RequestOptions<IpcRendererEndpoint<T, K>['events'], C>, 'timeout'> & {
  webContentsId?: never;
  windowParams: IpcWindowParams<T, Q, K>;
};

type IpcRendererRequest<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
  C extends keyof IpcRendererEndpoint<T, K>['requests'],
> = Extract<IpcRendererEndpoint<T, K>['requests'][C], Fn>;

export type IpcInvokeToUnknownOptions = UnknownRequestOptions & {
  webContentsId: number;
  windowParams?: never;
};

export type IpcSendToUnknownOptions = UnknownSendOptions & {
  webContentsId: number;
  windowParams?: never;
};

type OutgoingRendererEndpoint<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = {
  requests: IpcRequests<T, K>;
  events: IpcEvents<T, K>;
};

export type InterRendererIpcRendererService<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
  Q extends Fn<never[], number | undefined>,
> = Omit<
  IpcRendererService<
    NormalizedIpcEndpoint<OutgoingRendererEndpoint<T, K>>,
    NormalizedIpcEndpoint<IpcRendererEndpoint<T, K>>,
    NormalizedIpcEndpoint<T['main']>,
    Q
  >,
  'invokeTo' | 'sendTo'
> & {
  invokeTo<
    Target extends IpcTargetRendererId<T, K>,
    C extends keyof IpcRendererEndpoint<T, Target>['requests'] & string,
  >(
    channel: C,
    options: IpcInvokeToOptions<T, Q, Target, C>,
  ): Promise<Awaited<ReturnType<IpcRendererRequest<T, Target, C>>>>;

  invokeTo<C extends IpcRequestChannels<T, K> & string>(
    channel: C,
    options: IpcInvokeToUnknownOptions,
  ): Promise<unknown>;

  sendTo<
    Target extends IpcTargetRendererId<T, K>,
    C extends keyof IpcRendererEndpoint<T, Target>['events'] & string,
  >(channel: C, options: IpcSendToOptions<T, Q, Target, C>): void;

  sendTo<C extends IpcEventChannels<T, K> & string>(
    channel: C,
    options: IpcSendToUnknownOptions,
  ): void;
};
