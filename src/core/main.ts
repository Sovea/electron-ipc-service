import electron, {
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
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
  isIpcResponse,
  type RoutedReplyMessage,
  type RoutedRequestMetadata,
  successResponse,
} from '../protocol.js';
import type {
  EventListener,
  Fn,
  IpcEndpointConstraint,
  IpcServiceBaseOptions,
  MainEventContext,
  MainRequestContext,
  RequestHandler,
  Unsubscribe,
} from '../types/index.js';
import { BaseIpcService } from './base.js';

const { ipcMain, webContents } = electron;

export interface IpcMainServiceOptions extends IpcServiceBaseOptions {
  /**
   * Resolves an application renderer address to a target webContentsId.
   */
  getWebContentsId?: Fn<never[], number | undefined>;
}

type WebContentsTargetOptions = RequireExactlyOne<{
  webContentsId: number;
  windowParams: unknown[];
}>;

type RoutedRequestOptions = {
  data?: unknown[];
  timeout?: number;
} & WebContentsTargetOptions;

type RoutedEventOptions = {
  data?: unknown[];
} & WebContentsTargetOptions;

export class IpcMainService<
  T extends IpcEndpointConstraint<T>,
> extends BaseIpcService {
  private readonly mainOptions: IpcMainServiceOptions;

  private internalDisposers: Unsubscribe[] = [];

  private requestHandlerChannels = new Set<string>();

  private targetRequests = new Map<
    number,
    {
      requestIds: Set<string>;
      target: WebContents;
      onDestroyed: () => void;
    }
  >();

  constructor(options?: IpcMainServiceOptions) {
    super(options);
    this.mainOptions = options ?? {};
    this.init();
  }

  private handleInvokeTo() {
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:invoke-to`);
    const listener = async (
      event: IpcMainInvokeEvent,
      channel: unknown,
      options: unknown,
    ): Promise<IpcResponse> => {
      try {
        this.assertRouteInput(channel, options);
        return await this.dispatchRequest(
          event.sender.id,
          channel,
          options as RoutedRequestOptions,
        );
      } catch (error) {
        return errorResponse(serializeIpcError(error));
      }
    };

    ipcMain.handle(ipcChannel, listener);
    return () => {
      ipcMain.removeHandler(ipcChannel);
    };
  }

  private handleReplyTo() {
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:reply-to`);
    const listener = (event: IpcMainEvent, message: unknown) => {
      if (!this.isReplyMessage(message)) {
        this.reportError(
          new IpcError(
            IpcErrorCode.ProtocolError,
            'Received an invalid IPC reply message',
          ),
        );
        return;
      }

      const pendingRequest = this.getPendingRequest(message.requestId);
      if (!pendingRequest) {
        return;
      }
      if (pendingRequest.targetWebContentsId !== event.sender.id) {
        this.reportError(
          new IpcError(
            IpcErrorCode.ProtocolError,
            'IPC reply sender does not match the request target',
            {
              requestId: message.requestId,
              targetWebContentsId: pendingRequest.targetWebContentsId,
            },
          ),
        );
        return;
      }
      this.resolvePendingRequest(message.requestId, message.response);
    };

    ipcMain.on(ipcChannel, listener);
    return () => {
      ipcMain.off(ipcChannel, listener);
    };
  }

  private handleSendTo() {
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:send-to`);
    const listener = (
      event: IpcMainEvent,
      channel: unknown,
      options: unknown,
    ) => {
      try {
        this.assertRouteInput(channel, options);
        const routeOptions = options as RoutedEventOptions;
        const target = this.resolveTargetWebContents(routeOptions);
        this.sendToTarget(
          target,
          this.eventChannel(channel),
          [
            this.getRouteData(routeOptions),
            {
              kind: 'event',
              source: {
                kind: 'renderer',
                webContentsId: event.sender.id,
              },
              version: IPC_PROTOCOL_VERSION,
            },
          ],
          {
            channel,
            targetWebContentsId: target.id,
          },
        );
      } catch (error) {
        this.reportError(error, {
          channel: typeof channel === 'string' ? channel : undefined,
        });
      }
    };

    ipcMain.on(ipcChannel, listener);
    return () => {
      ipcMain.off(ipcChannel, listener);
    };
  }

  private dispatchRequest(
    sourceWebContentsId: number,
    channel: string,
    options: RoutedRequestOptions,
  ): Promise<IpcResponse> {
    this.assertActive();
    const target = this.resolveTargetWebContents(options);
    const targetWebContentsId = target.id;
    const requestId = this.generateId();
    const timeout = this.resolveTimeout(options.timeout);
    const metadata: RoutedRequestMetadata = {
      kind: 'request',
      requestId,
      source: {
        kind: 'renderer',
        webContentsId: sourceWebContentsId,
      },
      timeout,
      version: IPC_PROTOCOL_VERSION,
    };

    return new Promise<IpcResponse>((resolve, reject) => {
      let cleanupTargetRequest: (() => void) | undefined;
      const timer = this.createTimeout(timeout, () => {
        this.rejectPendingRequest(
          requestId,
          this.timeoutError(channel, requestId, targetWebContentsId),
        );
      });

      try {
        cleanupTargetRequest = this.trackTargetRequest(target, requestId);
        this.addPendingRequest(requestId, {
          channel,
          cleanup: cleanupTargetRequest,
          reject,
          resolve: (data) => {
            resolve(data as IpcResponse);
          },
          targetWebContentsId,
          timeout: timer,
        });
        if (target.isDestroyed()) {
          this.rejectPendingRequest(
            requestId,
            new IpcError(
              IpcErrorCode.TargetNotFound,
              `webContents with id ${targetWebContentsId} was destroyed`,
              { channel, requestId, targetWebContentsId },
            ),
          );
          return;
        }
        this.sendToTarget(
          target,
          this.requestChannel(channel),
          [this.getRouteData(options), metadata],
          { channel, requestId, targetWebContentsId },
        );
      } catch (error) {
        cleanupTargetRequest?.();
        if (timer) {
          clearTimeout(timer);
        }
        const ipcError = toIpcError(error, IpcErrorCode.TargetNotFound, {
          channel,
          requestId,
          targetWebContentsId,
        });
        if (this.getPendingRequest(requestId)) {
          this.rejectPendingRequest(requestId, ipcError);
        } else {
          reject(ipcError);
        }
      }
    });
  }

  private trackTargetRequest(target: WebContents, requestId: string) {
    let tracker = this.targetRequests.get(target.id);
    if (!tracker) {
      const requestIds = new Set<string>();
      const onDestroyed = () => {
        this.targetRequests.delete(target.id);
        for (const pendingRequestId of Array.from(requestIds)) {
          this.rejectPendingRequest(
            pendingRequestId,
            new IpcError(
              IpcErrorCode.TargetNotFound,
              `webContents with id ${target.id} was destroyed`,
              {
                requestId: pendingRequestId,
                targetWebContentsId: target.id,
              },
            ),
          );
        }
      };
      tracker = { onDestroyed, requestIds, target };
      this.targetRequests.set(target.id, tracker);
      target.once('destroyed', onDestroyed);
    }
    tracker.requestIds.add(requestId);

    return () => {
      const current = this.targetRequests.get(target.id);
      if (!current) {
        return;
      }
      current.requestIds.delete(requestId);
      if (current.requestIds.size === 0) {
        current.target.off('destroyed', current.onDestroyed);
        this.targetRequests.delete(target.id);
      }
    };
  }

  private sendToTarget(
    target: WebContents,
    ipcChannel: string,
    args: unknown[],
    options: {
      channel: string;
      requestId?: string;
      targetWebContentsId: number;
    },
  ) {
    try {
      target.send(ipcChannel, ...args);
    } catch (error) {
      throw toIpcError(
        error,
        target.isDestroyed()
          ? IpcErrorCode.TargetNotFound
          : IpcErrorCode.SerializationError,
        options,
      );
    }
  }

  private getRouteData(options: { data?: unknown[] }) {
    const data = options.data ?? [];
    if (!Array.isArray(data)) {
      throw new IpcError(
        IpcErrorCode.ProtocolError,
        'IPC route data must be an array',
      );
    }
    return data;
  }

  private assertRouteInput(
    channel: unknown,
    options: unknown,
  ): asserts channel is string {
    if (typeof channel !== 'string' || channel.length === 0) {
      throw new IpcError(
        IpcErrorCode.ProtocolError,
        'IPC channel must be a non-empty string',
      );
    }
    if (!options || typeof options !== 'object') {
      throw new IpcError(
        IpcErrorCode.ProtocolError,
        'IPC route options must be an object',
        { channel },
      );
    }
  }

  private resolveTargetWebContents(
    options: WebContentsTargetOptions,
  ): WebContents {
    const { webContentsId, windowParams } = options;
    const hasWebContentsId = webContentsId !== undefined;
    const hasWindowParams = windowParams !== undefined;

    if (hasWebContentsId === hasWindowParams) {
      throw new IpcError(
        IpcErrorCode.InvalidTarget,
        'exactly one of webContentsId or windowParams is required',
      );
    }

    if (hasWindowParams && !Array.isArray(windowParams)) {
      throw new IpcError(
        IpcErrorCode.InvalidTarget,
        'windowParams must be an array',
      );
    }

    const targetWebContentsId = hasWindowParams
      ? (
          this.mainOptions.getWebContentsId as
            | ((...args: unknown[]) => number | undefined)
            | undefined
        )?.(...windowParams)
      : webContentsId;
    if (targetWebContentsId === undefined) {
      throw new IpcError(
        IpcErrorCode.TargetNotFound,
        'windowParams did not resolve to a webContentsId',
      );
    }

    const target = webContents.fromId(targetWebContentsId);
    if (!target || target.isDestroyed()) {
      throw new IpcError(
        IpcErrorCode.TargetNotFound,
        `webContents with id ${targetWebContentsId} not found`,
        { targetWebContentsId },
      );
    }
    return target;
  }

  private isReplyMessage(value: unknown): value is RoutedReplyMessage {
    return (
      !!value &&
      typeof value === 'object' &&
      'version' in value &&
      value.version === IPC_PROTOCOL_VERSION &&
      'requestId' in value &&
      typeof value.requestId === 'string' &&
      'response' in value &&
      isIpcResponse(value.response)
    );
  }

  private init() {
    try {
      this.internalDisposers.push(this.handleInvokeTo());
      this.internalDisposers.push(this.handleReplyTo());
      this.internalDisposers.push(this.handleSendTo());
    } catch (error) {
      this.disposeInternalHandlers();
      throw error;
    }
  }

  private disposeInternalHandlers() {
    for (const dispose of this.internalDisposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        this.reportError(error);
      }
    }
    for (const tracker of Array.from(this.targetRequests.values())) {
      try {
        tracker.target.off('destroyed', tracker.onDestroyed);
      } catch (error) {
        this.reportError(error);
      }
    }
    this.targetRequests.clear();
  }

  private runEventListener(
    listener: () => void | PromiseLike<void>,
    channel: string,
  ) {
    try {
      Promise.resolve(listener()).catch((error) => {
        this.reportError(error, { channel });
      });
    } catch (error) {
      this.reportError(error, { channel });
    }
  }

  private registerRequestHandler(
    channel: string,
    ipcChannel: string,
    register: () => void,
  ): Unsubscribe {
    if (this.requestHandlerChannels.has(ipcChannel)) {
      throw new IpcError(
        IpcErrorCode.HandlerAlreadyRegistered,
        `A request handler is already registered for "${channel}"`,
        { channel },
      );
    }

    try {
      register();
    } catch (error) {
      throw new IpcError(
        IpcErrorCode.HandlerAlreadyRegistered,
        `Unable to register request handler for "${channel}"`,
        { cause: error, channel },
      );
    }
    this.requestHandlerChannels.add(ipcChannel);

    return this.ownRegistration(() => {
      this.requestHandlerChannels.delete(ipcChannel);
      ipcMain.removeHandler(ipcChannel);
    });
  }

  on<K extends keyof T['events'] & string>(
    channel: K,
    listener: EventListener<T['events'], K, MainEventContext<K>>,
  ): Unsubscribe {
    this.assertActive();
    const ipcChannel = this.eventChannel(channel);
    const wrapped = (
      event: IpcMainEvent,
      ...args: Parameters<T['events'][K]>
    ) => {
      const context: MainEventContext<K> = {
        channel,
        event,
        kind: 'event',
        source: {
          kind: 'renderer',
          webContentsId: event.sender.id,
        },
      };
      this.runEventListener(() => listener(context, ...args), channel);
    };
    ipcMain.on(ipcChannel, wrapped);
    return this.ownRegistration(() => {
      ipcMain.off(ipcChannel, wrapped);
    });
  }

  once<K extends keyof T['events'] & string>(
    channel: K,
    listener: EventListener<T['events'], K, MainEventContext<K>>,
  ): Unsubscribe {
    this.assertActive();
    const ipcChannel = this.eventChannel(channel);
    let unsubscribe: Unsubscribe = () => {};
    const wrapped = (
      event: IpcMainEvent,
      ...args: Parameters<T['events'][K]>
    ) => {
      unsubscribe();
      const context: MainEventContext<K> = {
        channel,
        event,
        kind: 'event',
        source: {
          kind: 'renderer',
          webContentsId: event.sender.id,
        },
      };
      this.runEventListener(() => listener(context, ...args), channel);
    };
    ipcMain.once(ipcChannel, wrapped);
    unsubscribe = this.ownRegistration(() => {
      ipcMain.off(ipcChannel, wrapped);
    });
    return unsubscribe;
  }

  handle<K extends keyof T['requests'] & string>(
    channel: K,
    listener: RequestHandler<T['requests'], K, MainRequestContext<K>>,
  ): Unsubscribe {
    this.assertActive();
    const ipcChannel = this.requestChannel(channel);
    const wrapped = async (
      event: IpcMainInvokeEvent,
      ...args: Parameters<T['requests'][K]>
    ): Promise<IpcResponse> => {
      const context: MainRequestContext<K> = {
        channel,
        event,
        kind: 'request',
        source: {
          kind: 'renderer',
          webContentsId: event.sender.id,
        },
      };
      try {
        return successResponse(await listener(context, ...args));
      } catch (error) {
        return errorResponse(serializeIpcError(error));
      }
    };
    return this.registerRequestHandler(channel, ipcChannel, () => {
      ipcMain.handle(ipcChannel, wrapped);
    });
  }

  handleOnce<K extends keyof T['requests'] & string>(
    channel: K,
    listener: RequestHandler<T['requests'], K, MainRequestContext<K>>,
  ): Unsubscribe {
    this.assertActive();
    const ipcChannel = this.requestChannel(channel);
    let unsubscribe: Unsubscribe = () => {};
    const wrapped = async (
      event: IpcMainInvokeEvent,
      ...args: Parameters<T['requests'][K]>
    ): Promise<IpcResponse> => {
      unsubscribe();
      const context: MainRequestContext<K> = {
        channel,
        event,
        kind: 'request',
        source: {
          kind: 'renderer',
          webContentsId: event.sender.id,
        },
      };
      try {
        return successResponse(await listener(context, ...args));
      } catch (error) {
        return errorResponse(serializeIpcError(error));
      }
    };
    unsubscribe = this.registerRequestHandler(channel, ipcChannel, () => {
      ipcMain.handleOnce(ipcChannel, wrapped);
    });
    return unsubscribe;
  }

  override destroy() {
    if (this.isDestroyed) {
      return;
    }
    super.destroy();
    this.disposeInternalHandlers();
  }
}
