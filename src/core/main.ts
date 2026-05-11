import {
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  MessageChannelMain,
  webContents,
} from 'electron';
import type { Promisable, RequireAtLeastOne } from 'type-fest';
import { IpcChannelType } from '../constants';
import type {
  Fn,
  IpcServiceBaseOptions,
  RequestOptions,
  ResponseData,
  Unsubscribe,
} from '../types';
import { BaseIpcService } from './base';

interface IpcMainServiceOptions extends IpcServiceBaseOptions {
  /**
   * function to get target renderer webContentsId
   * @returns webContentsId
   */
  getWebContentsId?: (...args: any[]) => number | undefined;
}

type TargetRendererOptions = RequireAtLeastOne<{
  webContentsId: number;
  windowParams: Parameters<Required<IpcMainServiceOptions>['getWebContentsId']>;
}>;

type ConnectToOptions = TargetRendererOptions & {
  timeout?: number;
};

/**
 * ipc main service
 * @template T - handle ipc type
 */
export class IpcMainService<
  T extends Record<string, Fn>,
> extends BaseIpcService {
  declare options: IpcMainServiceOptions;

  constructor(options?: IpcMainServiceOptions);
  constructor(options?: IpcMainServiceOptions) {
    super(options);
    this.init();
  }

  private getTargetWebContentsId({
    webContentsId,
    windowParams,
  }: TargetRendererOptions) {
    return (
      webContentsId ||
      (windowParams
        ? this.options.getWebContentsId?.(...windowParams)
        : undefined)
    );
  }

  private getTargetWebContents(options: TargetRendererOptions) {
    const targetWebContentsId = this.getTargetWebContentsId(options);

    if (!targetWebContentsId) {
      throw new Error('webContentsId is required');
    }

    const target = webContents.fromId(targetWebContentsId);
    if (!target) {
      throw new Error(`webContents with id ${targetWebContentsId} not found`);
    }

    return { target, targetWebContentsId };
  }

  /**
   * handle invokeTo request from ipc renderer
   */
  private handleInvokeTo() {
    ipcMain.handle(
      this.wrapChannel(`${IpcChannelType.Internal}:invoke-to`),
      async (
        event: IpcMainInvokeEvent,
        channel: string,
        options: RequestOptions<any, any> &
          RequireAtLeastOne<{
            webContentsId: number;
            windowParams: Parameters<
              Required<IpcMainServiceOptions>['getWebContentsId']
            >;
          }>,
      ) => {
        const requestId = this.generateId();
        const { timeout: wait = this.options.pendingRequestTimeout, data } =
          options;
        try {
          const { target } = this.getTargetWebContents(options);

          return await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              this.rejectPendingRequest(
                requestId,
                new Error('Request timeout'),
              );
              clearTimeout(timeout);
            }, wait);

            target.send(channel, data, {
              requestId,
              webContentsId: event.sender.id,
              timeout: wait,
            });
            this.addPendingRequest(requestId, resolve, reject, timeout);
          });
        } catch (error) {
          this.rejectPendingRequest(requestId, error as Error);
        }
      },
    );
  }

  /**
   * handle replyTo request from ipc renderer
   */
  private handleReplyTo() {
    ipcMain.on(
      this.wrapChannel(`${IpcChannelType.Internal}:reply-to`),
      (
        _event: IpcMainEvent,
        requestId: string,
        responseData: unknown,
        error?: Error,
      ) => {
        if (error) {
          this.rejectPendingRequest(requestId, error);
        } else {
          this.resolvePendingRequest(requestId, responseData);
        }
      },
    );
  }

  /**
   * handle sendTo request from ipc renderer
   */
  private handleSendTo() {
    ipcMain.on(
      this.wrapChannel(`${IpcChannelType.Internal}:send-to`),
      (
        event: IpcMainEvent,
        channel: string,
        options: Omit<RequestOptions<any, any>, 'timeout'> &
          TargetRendererOptions,
      ) => {
        const { data } = options;
        const { target } = this.getTargetWebContents(options);

        target.send(channel, data, {
          webContentsId: event.sender.id,
        });
      },
    );
  }

  private handleConnectTo() {
    ipcMain.handle(
      this.wrapChannel(`${IpcChannelType.Internal}:connect-to`),
      async (
        event: IpcMainInvokeEvent,
        channel: string,
        requestId: string,
        options: ConnectToOptions,
      ) => {
        const { target, targetWebContentsId } =
          this.getTargetWebContents(options);
        const { port1, port2 } = new MessageChannelMain();
        const metadata = {
          channel,
          requestId,
          sourceWebContentsId: event.sender.id,
          targetWebContentsId,
        };

        event.sender.postMessage(
          this.wrapChannel(`${IpcChannelType.Internal}:message-port`),
          { ...metadata, source: true },
          [port1],
        );
        target.postMessage(
          this.wrapChannel(`${IpcChannelType.Internal}:message-port`),
          { ...metadata, source: false },
          [port2],
        );
      },
    );
  }

  private init() {
    this.handleInvokeTo();
    this.handleReplyTo();
    this.handleSendTo();
    this.handleConnectTo();
  }

  /**
   * listen ipc channel
   * @param channel ipc channel name
   * @param listener listener function
   */
  on<K extends keyof T & string>(
    channel: K,
    listener: (event: IpcMainInvokeEvent, ...args: Parameters<T[K]>) => void,
  ): Unsubscribe {
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    ipcMain.on(ipcChannel, listener);
    return () => {
      ipcMain.off(ipcChannel, listener);
    };
  }

  /**
   * listen ipc channel only once
   * @param channel ipc channel name
   * @param listener listener function
   */
  once<K extends keyof T & string>(
    channel: K,
    listener: (event: IpcMainInvokeEvent, ...args: Parameters<T[K]>) => void,
  ): Unsubscribe {
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    ipcMain.once(ipcChannel, listener);
    return () => {
      ipcMain.off(ipcChannel, listener);
    };
  }

  /**
   * handle ipc channel
   * @param channel ipc channel name
   * @param listener listener function
   */
  handle<K extends keyof T & string>(
    channel: K,
    listener: (
      event: IpcMainInvokeEvent,
      ...args: Parameters<T[K]>
    ) => Promisable<ResponseData<T[K]>>,
  ): Unsubscribe {
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    ipcMain.handle(ipcChannel, listener);
    return () => {
      ipcMain.off(ipcChannel, listener);
    };
  }

  /**
   * handle ipc channel only once
   * @param channel ipc channel name
   * @param listener listener function
   */
  handleOnce<K extends keyof T & string>(
    channel: K,
    listener: (
      event: IpcMainInvokeEvent,
      ...args: Parameters<T[K]>
    ) => Promisable<ResponseData<T[K]>>,
  ): Unsubscribe {
    const ipcChannel = this.wrapChannel(
      `${IpcChannelType.External}:${channel}`,
    );
    ipcMain.handleOnce(ipcChannel, listener);
    return () => {
      ipcMain.off(ipcChannel, listener);
    };
  }
}
