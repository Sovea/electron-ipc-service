import electron, { type IpcRendererEvent } from 'electron';
import type { RequireExactlyOne } from 'type-fest';
import { IpcChannelType } from '../constants/index.js';
import {
  IpcError,
  IpcErrorCode,
  serializeIpcError,
  toIpcError,
} from '../errors.js';
import {
  errorResponse,
  IPC_PROTOCOL_VERSION,
  type IpcResponse,
  type RoutedEventMetadata,
  type RoutedReplyMessage,
  type RoutedRequestMetadata,
  successResponse,
  unwrapResponse,
} from '../protocol.js';
import type {
  EmptyIpcEndpoint,
  EventListener,
  Fn,
  IpcEndpointConstraint,
  IpcServiceBaseOptions,
  RendererEventContext,
  RendererRequestContext,
  RequestHandler,
  RequestOptions,
  Unsubscribe,
} from '../types/index.js';
import type {
  APIBetweenRenderers,
  InterRendererIpcRendererService,
  IpcRendererId,
  MultiRenderersSchema,
} from '../types/renderer.js';
import { withTimeout } from '../utils/fn.js';
import { BaseIpcService } from './base.js';

const { ipcRenderer } = electron;
const requestHandlerOwners = new Map<string, symbol>();

export class IpcRendererService<
  R extends IpcEndpointConstraint<R> = EmptyIpcEndpoint,
  H extends IpcEndpointConstraint<H> = EmptyIpcEndpoint,
  M extends IpcEndpointConstraint<M> = EmptyIpcEndpoint,
  Q extends Fn<never[], number | undefined> = Fn<never[], number | undefined>,
> extends BaseIpcService {
  send<K extends keyof M['events'] & string>(
    channel: K,
    ...data: Parameters<M['events'][K]>
  ) {
    this.assertActive();
    this.sendMessage(this.eventChannel(channel), channel, ...data);
  }

  async invoke<K extends keyof M['requests'] & string>(
    channel: K,
    options: RequestOptions<M['requests'], K>,
  ): Promise<Awaited<ReturnType<M['requests'][K]>>> {
    this.assertActive();
    const timeout = this.resolveTimeout(options?.timeout);
    const data = options?.data ?? [];
    try {
      const operation = ipcRenderer
        .invoke(this.requestChannel(channel), ...data)
        .then((response) =>
          unwrapResponse<Awaited<ReturnType<M['requests'][K]>>>(response, {
            channel,
          }),
        );
      return await this.waitForRequest(operation, {
        channel,
        timeout,
      });
    } catch (error) {
      throw toIpcError(error, IpcErrorCode.ProtocolError, { channel });
    }
  }

  async invokeTo<K extends keyof R['requests'] & string>(
    channel: K,
    options: RequestOptions<R['requests'], K> &
      RequireExactlyOne<{
        webContentsId: number;
        windowParams: Parameters<Q>;
      }>,
  ): Promise<Awaited<ReturnType<R['requests'][K]>>> {
    this.assertActive();
    const timeout = this.resolveTimeout(options.timeout);
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:invoke-to`);
    try {
      const operation = ipcRenderer
        .invoke(ipcChannel, channel, { ...options, timeout })
        .then((response) =>
          unwrapResponse<Awaited<ReturnType<R['requests'][K]>>>(response, {
            channel,
          }),
        );
      return await this.waitForRequest(operation, {
        channel,
        targetWebContentsId: options.webContentsId,
        timeout,
      });
    } catch (error) {
      throw toIpcError(error, IpcErrorCode.ProtocolError, { channel });
    }
  }

  sendTo<K extends keyof R['events'] & string>(
    channel: K,
    options: Omit<RequestOptions<R['events'], K>, 'timeout'> &
      RequireExactlyOne<{
        webContentsId: number;
        windowParams: Parameters<Q>;
      }>,
  ) {
    this.assertActive();
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:send-to`);
    this.sendMessage(ipcChannel, channel, channel, options);
  }

  handle<K extends keyof H['requests'] & string>(
    channel: K,
    listener: RequestHandler<H['requests'], K, RendererRequestContext<K>>,
  ): Unsubscribe {
    this.assertActive();
    const ipcChannel = this.requestChannel(channel);
    const wrapped = this.wrapRequestListener(channel, listener);
    return this.registerRequestHandler(
      channel,
      ipcChannel,
      () => {
        ipcRenderer.on(ipcChannel, wrapped);
      },
      () => {
        ipcRenderer.off(ipcChannel, wrapped);
      },
    );
  }

  handleOnce<K extends keyof H['requests'] & string>(
    channel: K,
    listener: RequestHandler<H['requests'], K, RendererRequestContext<K>>,
  ): Unsubscribe {
    this.assertActive();
    const ipcChannel = this.requestChannel(channel);
    let unsubscribe: Unsubscribe = () => {};
    const wrapped = this.wrapRequestListener(channel, listener, () => {
      unsubscribe();
    });
    unsubscribe = this.registerRequestHandler(
      channel,
      ipcChannel,
      () => {
        ipcRenderer.once(ipcChannel, wrapped);
      },
      () => {
        ipcRenderer.off(ipcChannel, wrapped);
      },
    );
    return unsubscribe;
  }

  receive<K extends keyof H['events'] & string>(
    channel: K,
    listener: EventListener<H['events'], K, RendererEventContext<K>>,
  ): Unsubscribe {
    this.assertActive();
    const ipcChannel = this.eventChannel(channel);
    const wrapped = this.wrapEventListener(channel, listener);
    ipcRenderer.on(ipcChannel, wrapped);
    return this.ownRegistration(() => {
      ipcRenderer.off(ipcChannel, wrapped);
    });
  }

  receiveOnce<K extends keyof H['events'] & string>(
    channel: K,
    listener: EventListener<H['events'], K, RendererEventContext<K>>,
  ): Unsubscribe {
    this.assertActive();
    const ipcChannel = this.eventChannel(channel);
    let unsubscribe: Unsubscribe = () => {};
    const wrapped = this.wrapEventListener(channel, listener, () => {
      unsubscribe();
    });
    ipcRenderer.once(ipcChannel, wrapped);
    unsubscribe = this.ownRegistration(() => {
      ipcRenderer.off(ipcChannel, wrapped);
    });
    return unsubscribe;
  }

  private registerRequestHandler(
    channel: string,
    ipcChannel: string,
    register: () => void,
    dispose: Unsubscribe,
  ): Unsubscribe {
    if (requestHandlerOwners.has(ipcChannel)) {
      throw new IpcError(
        IpcErrorCode.HandlerAlreadyRegistered,
        `A request handler is already registered for "${channel}"`,
        { channel },
      );
    }
    const owner = Symbol(ipcChannel);

    try {
      register();
    } catch (error) {
      throw new IpcError(
        IpcErrorCode.HandlerAlreadyRegistered,
        `Unable to register request handler for "${channel}"`,
        {
          cause: error,
          channel,
        },
      );
    }
    requestHandlerOwners.set(ipcChannel, owner);

    return this.ownRegistration(() => {
      if (requestHandlerOwners.get(ipcChannel) === owner) {
        requestHandlerOwners.delete(ipcChannel);
      }
      dispose();
    });
  }

  private sendMessage(ipcChannel: string, channel: string, ...args: unknown[]) {
    try {
      ipcRenderer.send(ipcChannel, ...args);
    } catch (error) {
      throw toIpcError(error, IpcErrorCode.SerializationError, {
        channel,
      });
    }
  }

  private wrapRequestListener<K extends keyof H['requests'] & string>(
    channel: K,
    listener: RequestHandler<H['requests'], K, RendererRequestContext<K>>,
    onReceive?: () => void,
  ) {
    return (event: IpcRendererEvent, data: unknown, metadata: unknown) => {
      onReceive?.();
      if (!this.isRequestMetadata(metadata) || !Array.isArray(data)) {
        this.reportError(
          new IpcError(
            IpcErrorCode.ProtocolError,
            'Received an invalid routed IPC request',
            { channel },
          ),
        );
        return;
      }

      const context: RendererRequestContext<K> = {
        channel,
        event,
        kind: 'request',
        source: metadata.source,
      };

      const processRequest = async () => {
        let response: IpcResponse;
        try {
          const result = listener(
            context,
            ...(data as Parameters<H['requests'][K]>),
          );
          const value = await withTimeout(
            Promise.resolve(result),
            metadata.timeout,
            () => this.timeoutError(channel, metadata.requestId),
          );
          response = successResponse(value);
        } catch (error) {
          response = errorResponse(serializeIpcError(error));
        }
        this.sendRoutedReply(channel, metadata.requestId, response);
      };

      void processRequest().catch((error) => {
        this.reportError(error, {
          channel,
          requestId: metadata.requestId,
        });
      });
    };
  }

  private wrapEventListener<K extends keyof H['events'] & string>(
    channel: K,
    listener: EventListener<H['events'], K, RendererEventContext<K>>,
    onReceive?: () => void,
  ) {
    return (event: IpcRendererEvent, data: unknown, metadata: unknown) => {
      onReceive?.();
      if (!this.isEventMetadata(metadata) || !Array.isArray(data)) {
        this.reportError(
          new IpcError(
            IpcErrorCode.ProtocolError,
            'Received an invalid routed IPC event',
            { channel },
          ),
        );
        return;
      }

      const context: RendererEventContext<K> = {
        channel,
        event,
        kind: 'event',
        source: metadata.source,
      };
      try {
        Promise.resolve(
          listener(context, ...(data as Parameters<H['events'][K]>)),
        ).catch((error) => {
          this.reportError(error, { channel });
        });
      } catch (error) {
        this.reportError(error, { channel });
      }
    };
  }

  private sendRoutedReply(
    channel: string,
    requestId: string,
    response: IpcResponse,
  ) {
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:reply-to`);
    const reply: RoutedReplyMessage = {
      requestId,
      response,
      version: IPC_PROTOCOL_VERSION,
    };

    try {
      ipcRenderer.send(ipcChannel, reply);
    } catch (error) {
      const serializationError = new IpcError(
        IpcErrorCode.SerializationError,
        `Unable to serialize IPC response for "${channel}"`,
        { cause: error, channel, requestId },
      );
      this.reportError(serializationError);

      const fallbackReply: RoutedReplyMessage = {
        requestId,
        response: errorResponse(serializeIpcError(serializationError)),
        version: IPC_PROTOCOL_VERSION,
      };
      try {
        ipcRenderer.send(ipcChannel, fallbackReply);
      } catch (fallbackError) {
        this.reportError(fallbackError, { channel, requestId });
      }
    }
  }

  private isRequestMetadata(value: unknown): value is RoutedRequestMetadata {
    return (
      !!value &&
      typeof value === 'object' &&
      'version' in value &&
      value.version === IPC_PROTOCOL_VERSION &&
      'kind' in value &&
      value.kind === 'request' &&
      'requestId' in value &&
      typeof value.requestId === 'string' &&
      'timeout' in value &&
      typeof value.timeout === 'number' &&
      Number.isFinite(value.timeout) &&
      value.timeout >= 0 &&
      'source' in value &&
      this.isRequestSource(value.source)
    );
  }

  private isEventMetadata(value: unknown): value is RoutedEventMetadata {
    return (
      !!value &&
      typeof value === 'object' &&
      'version' in value &&
      value.version === IPC_PROTOCOL_VERSION &&
      'kind' in value &&
      value.kind === 'event' &&
      'source' in value &&
      this.isRendererSource(value.source)
    );
  }

  private isRequestSource(
    value: unknown,
  ): value is RoutedRequestMetadata['source'] {
    if (!value || typeof value !== 'object' || !('kind' in value)) {
      return false;
    }
    if (value.kind === 'main') {
      return true;
    }
    return this.isRendererSource(value);
  }

  private isRendererSource(
    value: unknown,
  ): value is RoutedEventMetadata['source'] {
    if (!value || typeof value !== 'object' || !('kind' in value)) {
      return false;
    }
    return (
      value.kind === 'renderer' &&
      'webContentsId' in value &&
      typeof value.webContentsId === 'number' &&
      Number.isInteger(value.webContentsId) &&
      value.webContentsId >= 0
    );
  }
}

export function create<T extends IpcEndpointConstraint<T>>(
  options?: IpcServiceBaseOptions,
) {
  return new IpcRendererService<EmptyIpcEndpoint, EmptyIpcEndpoint, T>(
    options,
  ) as Omit<
    IpcRendererService<EmptyIpcEndpoint, EmptyIpcEndpoint, T>,
    APIBetweenRenderers
  >;
}

export function createForInterRenderers<
  T extends MultiRenderersSchema,
  Q extends Fn<never[], number | undefined>,
>(options?: IpcServiceBaseOptions) {
  const ipcRendererService = new IpcRendererService(options);

  const useIpcRendererService = <K extends IpcRendererId<T>>(
    _key: K,
  ): InterRendererIpcRendererService<T, K, Q> => {
    return ipcRendererService as unknown as InterRendererIpcRendererService<
      T,
      K,
      Q
    >;
  };

  return useIpcRendererService;
}
