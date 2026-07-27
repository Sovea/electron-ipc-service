export const IpcErrorCode = {
  HandlerAlreadyRegistered: 'IPC_HANDLER_ALREADY_REGISTERED',
  InvalidTarget: 'IPC_INVALID_TARGET',
  ProtocolError: 'IPC_PROTOCOL_ERROR',
  RemoteError: 'IPC_REMOTE_ERROR',
  SerializationError: 'IPC_SERIALIZATION_ERROR',
  ServiceDestroyed: 'IPC_SERVICE_DESTROYED',
  TargetNotFound: 'IPC_TARGET_NOT_FOUND',
  Timeout: 'IPC_TIMEOUT',
} as const;

export type IpcErrorCode = (typeof IpcErrorCode)[keyof typeof IpcErrorCode];

export interface IpcErrorOptions {
  channel?: string;
  requestId?: string;
  targetWebContentsId?: number;
  cause?: unknown;
}

export interface SerializedIpcError {
  code: string;
  name: string;
  message: string;
}

export class IpcError extends Error {
  readonly code: IpcErrorCode;
  readonly channel?: string;
  readonly requestId?: string;
  readonly targetWebContentsId?: number;

  constructor(
    code: IpcErrorCode,
    message: string,
    options: IpcErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined
        ? undefined
        : {
            cause: options.cause,
          },
    );
    this.name = 'IpcError';
    this.code = code;
    this.channel = options.channel;
    this.requestId = options.requestId;
    this.targetWebContentsId = options.targetWebContentsId;
  }
}

export class IpcTimeoutError extends IpcError {
  constructor(message = 'IPC request timed out', options?: IpcErrorOptions) {
    super(IpcErrorCode.Timeout, message, options);
    this.name = 'IpcTimeoutError';
  }
}

export class IpcRemoteError extends IpcError {
  readonly remoteCode: string;
  readonly remoteName: string;

  constructor(error: SerializedIpcError, options?: IpcErrorOptions) {
    super(IpcErrorCode.RemoteError, error.message, options);
    this.name = 'IpcRemoteError';
    this.remoteCode = error.code;
    this.remoteName = error.name;
  }
}

export function toIpcError(
  error: unknown,
  code: IpcErrorCode = IpcErrorCode.ProtocolError,
  options?: IpcErrorOptions,
): IpcError {
  if (error instanceof IpcError) {
    return error;
  }
  const cause = error instanceof Error ? error : undefined;
  return new IpcError(
    code,
    error instanceof Error ? error.message : String(error),
    { ...options, cause },
  );
}

export function serializeIpcError(error: unknown): SerializedIpcError {
  if (error instanceof IpcError) {
    return {
      code: error.code,
      message: error.message,
      name: error.name,
    };
  }
  if (error instanceof Error) {
    return {
      code: IpcErrorCode.RemoteError,
      message: error.message,
      name: error.name,
    };
  }
  return {
    code: IpcErrorCode.RemoteError,
    message: String(error),
    name: 'Error',
  };
}
