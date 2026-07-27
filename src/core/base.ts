import { nanoid } from 'nanoid';
import {
  IpcError,
  IpcErrorCode,
  type IpcErrorOptions,
  IpcTimeoutError,
  toIpcError,
} from '../errors.js';
import type { IpcServiceBaseOptions, Unsubscribe } from '../types/index.js';

type PendingRequest = {
  resolve: (data: unknown) => void;
  reject: (error: IpcError) => void;
  channel?: string;
  targetWebContentsId?: number;
  timeout?: NodeJS.Timeout;
  cleanup?: () => void;
};

type OwnedRegistration = {
  active: boolean;
  dispose: Unsubscribe;
};

export class BaseIpcService {
  protected options: Required<
    Pick<IpcServiceBaseOptions, 'ipcChannelPrefix' | 'requestTimeout'>
  > &
    Pick<IpcServiceBaseOptions, 'onError'>;

  protected pendingRequests = new Map<string, PendingRequest>();

  protected isDestroyed = false;

  private ownedRegistrations = new Set<OwnedRegistration>();

  constructor(options?: IpcServiceBaseOptions) {
    this.options = {
      ipcChannelPrefix: 'ipc-service:',
      requestTimeout: 5000,
      ...options,
    };
    this.validateTimeout(this.options.requestTimeout);
  }

  protected assertActive() {
    if (this.isDestroyed) {
      throw new IpcError(
        IpcErrorCode.ServiceDestroyed,
        'IPC service has been destroyed',
      );
    }
  }

  protected generateId() {
    return nanoid();
  }

  protected wrapChannel(channel: string) {
    return `${this.options.ipcChannelPrefix}${channel}`;
  }

  protected requestChannel(channel: string) {
    return this.wrapChannel(`external:request:${channel}`);
  }

  protected eventChannel(channel: string) {
    return this.wrapChannel(`external:event:${channel}`);
  }

  protected resolveTimeout(timeout?: number) {
    const resolved = timeout ?? this.options.requestTimeout;
    this.validateTimeout(resolved);
    return resolved;
  }

  protected createTimeout(
    timeout: number,
    callback: () => void,
  ): NodeJS.Timeout | undefined {
    return timeout > 0 ? setTimeout(callback, timeout) : undefined;
  }

  protected addPendingRequest(id: string, request: PendingRequest) {
    this.assertActive();
    this.pendingRequests.set(id, request);
  }

  protected waitForRequest<T>(
    promise: PromiseLike<T>,
    options: {
      channel: string;
      targetWebContentsId?: number;
      timeout: number;
    },
  ): Promise<T> {
    this.assertActive();
    const requestId = this.generateId();

    return new Promise<T>((resolve, reject) => {
      const timer = this.createTimeout(options.timeout, () => {
        this.rejectPendingRequest(
          requestId,
          this.timeoutError(
            options.channel,
            requestId,
            options.targetWebContentsId,
          ),
        );
      });

      try {
        this.addPendingRequest(requestId, {
          channel: options.channel,
          reject,
          resolve: (value) => {
            resolve(value as T);
          },
          targetWebContentsId: options.targetWebContentsId,
          timeout: timer,
        });
      } catch (error) {
        if (timer) {
          clearTimeout(timer);
        }
        reject(
          toIpcError(error, IpcErrorCode.ProtocolError, {
            channel: options.channel,
            requestId,
            targetWebContentsId: options.targetWebContentsId,
          }),
        );
        return;
      }

      Promise.resolve(promise).then(
        (value) => {
          this.resolvePendingRequest(requestId, value);
        },
        (error) => {
          this.rejectPendingRequest(requestId, error, {
            channel: options.channel,
            requestId,
            targetWebContentsId: options.targetWebContentsId,
          });
        },
      );
    });
  }

  protected ownRegistration(dispose: Unsubscribe): Unsubscribe {
    this.assertActive();
    const registration: OwnedRegistration = {
      active: true,
      dispose,
    };
    this.ownedRegistrations.add(registration);

    return () => {
      this.releaseRegistration(registration);
    };
  }

  protected getPendingRequest(id: string) {
    return this.pendingRequests.get(id);
  }

  protected resolvePendingRequest(id: string, data: unknown) {
    const pendingRequest = this.takePendingRequest(id);
    pendingRequest?.resolve(data);
  }

  protected rejectPendingRequest(
    id: string,
    error: unknown,
    options?: IpcErrorOptions,
  ) {
    const pendingRequest = this.takePendingRequest(id);
    pendingRequest?.reject(
      toIpcError(error, IpcErrorCode.ProtocolError, options),
    );
  }

  protected reportError(error: unknown, options?: IpcErrorOptions) {
    const ipcError = toIpcError(error, IpcErrorCode.ProtocolError, options);
    if (this.options.onError) {
      try {
        const result = this.options.onError(ipcError);
        Promise.resolve(result).catch((callbackError) => {
          this.reportOnErrorFailure(callbackError, ipcError);
        });
        return;
      } catch (callbackError) {
        this.reportOnErrorFailure(callbackError, ipcError);
        return;
      }
    }
    this.logError(ipcError);
  }

  private validateTimeout(timeout: number) {
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new IpcError(
        IpcErrorCode.ProtocolError,
        'request timeout must be a finite number greater than or equal to 0',
      );
    }
  }

  private takePendingRequest(id: string) {
    const pendingRequest = this.pendingRequests.get(id);
    if (!pendingRequest) {
      return undefined;
    }
    this.pendingRequests.delete(id);
    if (pendingRequest.timeout) {
      clearTimeout(pendingRequest.timeout);
    }
    try {
      pendingRequest.cleanup?.();
    } catch (error) {
      this.reportError(error, {
        channel: pendingRequest.channel,
        requestId: id,
        targetWebContentsId: pendingRequest.targetWebContentsId,
      });
    }
    return pendingRequest;
  }

  private dropAllPendingRequests() {
    for (const id of Array.from(this.pendingRequests.keys())) {
      const pendingRequest = this.pendingRequests.get(id);
      this.rejectPendingRequest(
        id,
        new IpcError(
          IpcErrorCode.ServiceDestroyed,
          'IPC service has been destroyed',
          {
            channel: pendingRequest?.channel,
            requestId: id,
            targetWebContentsId: pendingRequest?.targetWebContentsId,
          },
        ),
      );
    }
  }

  private releaseRegistration(registration: OwnedRegistration) {
    if (!registration.active) {
      return;
    }
    registration.active = false;
    this.ownedRegistrations.delete(registration);
    registration.dispose();
  }

  private disposeOwnedRegistrations() {
    for (const registration of Array.from(this.ownedRegistrations)) {
      try {
        this.releaseRegistration(registration);
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  private reportOnErrorFailure(callbackError: unknown, ipcError: IpcError) {
    console.warn(
      `[electron-ipc-service] onError failed: ${String(callbackError)}`,
    );
    this.logError(ipcError);
  }

  private logError(error: IpcError) {
    console.warn(`[electron-ipc-service] ${error.code}: ${error.message}`);
  }

  protected timeoutError(
    channel: string,
    requestId?: string,
    targetWebContentsId?: number,
  ) {
    return new IpcTimeoutError('IPC request timed out', {
      channel,
      requestId,
      targetWebContentsId,
    });
  }

  destroy() {
    if (this.isDestroyed) {
      return;
    }
    this.isDestroyed = true;
    this.disposeOwnedRegistrations();
    this.dropAllPendingRequests();
  }
}
