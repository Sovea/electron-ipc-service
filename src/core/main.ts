import electron, {
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import type { Promisable, RequireExactlyOne } from 'type-fest';
import { IpcChannelType } from '../constants/index.js';
import type {
  Fn,
  IpcServiceBaseOptions,
  RequestOptions,
  ResponseData,
  Unsubscribe,
} from '../types/index.js';
import { BaseIpcService } from './base.js';

const { ipcMain, webContents } = electron;

export interface IpcMainServiceOptions extends IpcServiceBaseOptions {
  /**
   * function to get target renderer webContentsId
   * @returns webContentsId
   */
  getWebContentsId?: (...args: any[]) => number | undefined;
}

type WebContentsTargetOptions = RequireExactlyOne<{
  webContentsId: number;
  windowParams: Parameters<Required<IpcMainServiceOptions>['getWebContentsId']>;
}>;

/**
 * ipc main service
 * @template T - handle ipc type
 */
export class IpcMainService<
  T extends Record<string, Fn>,
> extends BaseIpcService {
  declare options: IpcMainServiceOptions;

  private internalDisposers: Unsubscribe[] = [];

  private isDestroyed = false;

  constructor(options?: IpcMainServiceOptions);
  constructor(options?: IpcMainServiceOptions) {
    super(options);
    this.init();
  }

  /**
   * handle invokeTo request from ipc renderer
   */
  private handleInvokeTo() {
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:invoke-to`);
    const listener = async (
      event: IpcMainInvokeEvent,
      channel: string,
      options: RequestOptions<any, any> & WebContentsTargetOptions,
    ) => {
      const requestId = this.generateId();
      const { timeout: wait = this.options.pendingRequestTimeout, data } =
        options;
      const target = this.resolveTargetWebContents(options);

      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.rejectPendingRequest(requestId, new Error('Request timeout'));
        }, wait);

        // Register before dispatch so even an immediate reply has an owner.
        this.addPendingRequest(requestId, resolve, reject, timeout);
        try {
          target.send(channel, data, {
            requestId,
            webContentsId: event.sender.id,
            timeout: wait,
          });
        } catch (error) {
          this.rejectPendingRequest(requestId, this.toError(error));
        }
      });
    };

    ipcMain.handle(ipcChannel, listener);
    return () => {
      ipcMain.removeHandler(ipcChannel);
    };
  }

  /**
   * handle replyTo request from ipc renderer
   */
  private handleReplyTo() {
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:reply-to`);
    const listener = (
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
    };

    ipcMain.on(ipcChannel, listener);
    return () => {
      ipcMain.off(ipcChannel, listener);
    };
  }

  /**
   * handle sendTo request from ipc renderer
   */
  private handleSendTo() {
    const ipcChannel = this.wrapChannel(`${IpcChannelType.Internal}:send-to`);
    const listener = (
      event: IpcMainEvent,
      channel: string,
      options: Omit<RequestOptions<any, any>, 'timeout'> &
        WebContentsTargetOptions,
    ) => {
      try {
        const { data } = options;
        const target = this.resolveTargetWebContents(options);
        target.send(channel, data, {
          webContentsId: event.sender.id,
        });
      } catch (error) {
        console.warn(
          `[electron-ipc-service] sendTo dropped "${channel}": ${this.toError(error).message}`,
        );
      }
    };

    ipcMain.on(ipcChannel, listener);
    return () => {
      ipcMain.off(ipcChannel, listener);
    };
  }

  /** Resolve and validate both supported target selectors in one place. */
  private resolveTargetWebContents(
    options: WebContentsTargetOptions,
  ): WebContents {
    const { webContentsId, windowParams } = options;
    const hasWebContentsId = webContentsId !== undefined;
    const hasWindowParams = windowParams !== undefined;

    // Reject ambiguous input before a potentially stateful target lookup.
    if (hasWebContentsId === hasWindowParams) {
      throw new Error(
        'exactly one of webContentsId or windowParams is required',
      );
    }

    const targetWebContentsId = hasWindowParams
      ? this.options.getWebContentsId?.(...windowParams)
      : webContentsId;
    if (targetWebContentsId === undefined) {
      throw new Error('windowParams did not resolve to a webContentsId');
    }

    const target = webContents.fromId(targetWebContentsId);
    if (!target) {
      throw new Error(`webContents with id ${targetWebContentsId} not found`);
    }
    return target;
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
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
      dispose();
    }
  }

  /**
   * listen ipc channel
   * @param channel ipc channel name
   * @param listener listener function
   */
  on<K extends keyof T & string>(
    channel: K,
    listener: (event: IpcMainEvent, ...args: Parameters<T[K]>) => void,
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
    listener: (event: IpcMainEvent, ...args: Parameters<T[K]>) => void,
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
      ipcMain.removeHandler(ipcChannel);
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
      ipcMain.removeHandler(ipcChannel);
    };
  }

  override destroy() {
    if (this.isDestroyed) {
      return;
    }
    this.isDestroyed = true;
    this.disposeInternalHandlers();
    super.destroy();
  }
}
