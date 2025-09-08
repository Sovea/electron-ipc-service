import type { IpcRendererEvent } from 'electron';
import type { Promisable, UnionToIntersection } from 'type-fest';
import type { Fn, ResponseData } from '.';
import type { IpcRendererService } from '../core/renderer';

/**
 * API type between renderers.
 */
export type APIBetweenRenderers = keyof Pick<
  IpcRendererService,
  'handle' | 'handleOnce' | 'receive' | 'receiveOnce' | 'invokeTo' | 'sendTo'
>;

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

/**
 * ipc renderer service schema handle type.
 */
export type IpcHandles<
  T extends MultiRenderersSchema,
  K extends IpcRendererId<T>,
> = T['renderer']['common'] & T['renderer']['specified'][K];
