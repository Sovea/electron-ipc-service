import { type IpcRendererEvent, ipcRenderer } from 'electron';
import type { RequireAtLeastOne } from 'type-fest';
import { IpcChannelType } from '../constants';
import type { Fn, Optional, RequestOptions, Unsubscribe } from '../types';
import type {
  APIBetweenRenderers,
  InterRendererIpcRendererService,
  IpcRendererConnectionEvent,
  IpcRendererConnectionListener,
  IpcRendererConnectionOptions,
  IpcRendererId,
  IpcRendererMessagePort,
  IpcRendererServiceListener,
  MultiRenderersSchema,
} from '../types/renderer';
import { processFunction } from '../utils/fn';
import { BaseIpcService } from './base';

type MessagePortPayload = IpcRendererConnectionEvent & {
  requestId: string;
  source: boolean;
};

/**
 * ipc renderer service
 * @template R - request ipc type
 * @template H - handle ipc type
 * @template M - main process ipc type
 * @template Q - query webContentsId function type
 */
export class IpcRendererService<
  R extends Record<string, Fn<any, any>> = any,
  H extends Record<string, Fn<any, any>> = any,
  M extends Record<string, Fn<any, any>> = any,
  Q extends Fn<any, number | undefined> = any,
> extends BaseIpcService {
  private connectionListeners = new Map<
    string,
    Set<IpcRendererConnectionListener>
  >();

  constructor(options?: ConstructorParameters<typeof BaseIpcService>[0]) {
    super(options);
    this.initMessagePortListener();
  }

  private initMessagePortListener() {
    ipcRenderer.on(
      this.wrapChannel(`${IpcChannelType.Internal}:message-port`),
      (event: IpcRendererEvent, payload: MessagePortPayload) => {
        const [port] = event.ports;
        if (!port) {
          return;
        }

        port.start();
        if (payload.source) {
          this.resolvePendingRequest(payload.requestId, port);
          return;
        }

        const listeners = this.connectionListeners.get(payload.channel);
        if (!listeners?.size) {
          port.close();
          return;
        }

        const connectionEvent: IpcRendererConnectionEvent = {
          channel: payload.channel,
          sourceWebContentsId: payload.sourceWebContentsId,
          targetWebContentsId: payload.targetWebContentsId,
        };
        listeners.forEach((listener) => listener(connectionEvent, port));
      },
    );
  }

  /**
   * wrap ipc service listener
   * @param listener
   * @returns
   */
  wrapListener<K extends keyof H>(listener: IpcRendererServiceListener<H, K>) {
    return async (...args: Parameters<typeof listener>) => {
      const [, , options] = args;
      const { requestId, timeout } = options;
      let data: Optional<ReturnType<typeof listener>>;
      let rspError: Optional<Error>;
      try {
        data = await processFunction(listener, {
          data: args,
          timeout,
        });
      } catch (error) {
        rspError = error as Error;
      }
      ipcRenderer.send(
        this.wrapChannel(`${IpcChannelType.Internal}:reply-to`),
        requestId,
        data,
        rspError,
      );
    };
  }

  /**
   * send to main process
   * @param channel ipc channel name
   * @param data request data
   * @returns
   */
  send<K extends keyof M & string>(
    channel: K,
    ...data: Parameters<M[K]>['length'] extends 0 ? unknown[] : Parameters<M[K]>
  ) {
    ipcRenderer.send(
      this.wrapChannel(`${IpcChannelType.External}:${channel}`),
      ...data,
    );
  }

  /**
   * request to main process
   * @param channel ipc channel name
   * @param options.data request data
   * @param options.timeout request timeout in milliseconds, < 0 for no timeout
   * @returns
   */
  async invoke<K extends keyof M & string>(
    channel: K,
    options: RequestOptions<M, K>,
  ): Promise<Awaited<ReturnType<M[K]>>> {
    const { timeout = 0, data = [] } = options || {};
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    const invokePromise = ipcRenderer.invoke(ipcChannel, ...data);
    if (timeout > 0) {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new Error('Invoke function timed out'));
        }, timeout);
      });
      return await Promise.race([invokePromise, timeoutPromise]);
    }
    return await invokePromise;
  }

  /**
   * request to target renderer process
   * @param channel ipc channel name
   * @param options.data request data
   * @param options.timeout request timeout in milliseconds
   * @param options.webContentsId target webContents id
   * @param options.windowParams target webContents id query function parameters
   * @returns
   */
  invokeTo<K extends keyof R & string>(
    channel: K,
    options: RequestOptions<R, K> &
      RequireAtLeastOne<{
        webContentsId?: number;
        windowParams?: Parameters<Q>;
      }>,
  ) {
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:invoke-to`);
    return ipcRenderer.invoke(
      ipcChannel,
      this.wrapChannel(`${IpcChannelType.External}:${channel}`),
      options,
    );
  }

  /**
   * send to target renderer process
   * @param channel ipc channel name
   * @param options.data request data
   * @param options.webContentsId target webContents id
   * @param options.windowParams target webContents id query function parameters
   * @returns
   */
  sendTo<K extends keyof R & string>(
    channel: K,
    options: Omit<RequestOptions<R, K>, 'timeout'> &
      RequireAtLeastOne<{
        webContentsId?: number;
        windowParams?: Parameters<Q>;
      }>,
  ) {
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:send-to`);
    ipcRenderer.send(
      ipcChannel,
      this.wrapChannel(`${IpcChannelType.External}:${channel}`),
      options,
    );
  }

  connectTo(
    channel: string,
    options: IpcRendererConnectionOptions &
      RequireAtLeastOne<{
        webContentsId?: number;
        windowParams?: Parameters<Q>;
      }>,
  ): Promise<IpcRendererMessagePort> {
    const requestId = this.generateId();
    const { timeout = this.options.pendingRequestTimeout } = options;
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.Internal}:connect-to`,
    );

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPendingRequest(requestId, new Error('Request timeout'));
      }, timeout);

      this.addPendingRequest(requestId, resolve, reject, timer);
      ipcRenderer
        .invoke(
          ipcChannel,
          this.wrapChannel(`${IpcChannelType.External}:${channel}`),
          requestId,
          options,
        )
        .catch((error) => {
          this.rejectPendingRequest(requestId, error as Error);
        });
    });
  }

  onConnect(
    channel: string,
    listener: IpcRendererConnectionListener,
  ): Unsubscribe {
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    const listeners = this.connectionListeners.get(ipcChannel) || new Set();
    listeners.add(listener);
    this.connectionListeners.set(ipcChannel, listeners);

    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        this.connectionListeners.delete(ipcChannel);
      }
    };
  }

  /**
   * handle request from the other ipc renderers
   * @param channel ipc channel name
   * @param listener request handler
   * @returns function to remove the listener
   */
  handle<K extends keyof H & string>(
    channel: K,
    listener: IpcRendererServiceListener<H, K>,
  ): Unsubscribe {
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    const newListener = this.wrapListener(listener);
    ipcRenderer.on(ipcChannel, newListener);
    return () => {
      ipcRenderer.off(ipcChannel, newListener);
    };
  }

  /**
   * handle request from the other ipc renderers only once
   * @param channel ipc channel name
   * @param listener request handler
   * @returns function to remove the listener
   */
  handleOnce<K extends keyof H & string>(
    channel: K,
    listener: IpcRendererServiceListener<H, K>,
  ): Unsubscribe {
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    const newListener = this.wrapListener(listener);
    ipcRenderer.once(ipcChannel, newListener);
    return () => {
      ipcRenderer.off(ipcChannel, newListener);
    };
  }

  /**
   * receive message in the target channel from other renderer
   * @param channel channel name
   * @param listener event handler
   * @return function to remove the listener
   */
  receive<K extends keyof H & string>(
    channel: K,
    listener: (event: IpcRendererEvent, ...args: Parameters<H[K]>) => void,
  ): Unsubscribe {
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    ipcRenderer.on(ipcChannel, listener);
    return () => {
      ipcRenderer.off(ipcChannel, listener);
    };
  }

  /**
   * receive message in the target channel from other renderer only once
   * @param channel ipc channel name
   * @param listener event handler
   * @return function to remove the listener
   */
  receiveOnce<K extends keyof H & string>(
    channel: K,
    listener: (event: IpcRendererEvent, ...args: Parameters<H[K]>) => void,
  ): Unsubscribe {
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    ipcRenderer.once(ipcChannel, listener);
    return () => {
      ipcRenderer.off(ipcChannel, listener);
    };
  }
}

/**
 * create ipc renderer service, for main - renderer communication only
 */
export function create<T extends Record<string, Fn>>() {
  return new IpcRendererService() as Omit<
    IpcRendererService<any, any, T, any>,
    APIBetweenRenderers
  >;
}

/**
 * create ipc renderer service, support inter-renderers communication
 * @template T - base schema for ipc renderer service
 * @returns function to get typed ipc renderer service
 */
export function createForInterRenderers<
  T extends MultiRenderersSchema,
  Q extends Fn<any, number | undefined>,
>() {
  const ipcRendererService = new IpcRendererService();

  const useIpcRendererService = <K extends string & IpcRendererId<T>>(
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
