import {
  IpcError,
  IpcErrorCode,
  IpcRemoteError,
  type SerializedIpcError,
} from './errors.js';
import type { IpcSource, RendererIpcSource } from './types/index.js';

export const IPC_PROTOCOL_VERSION = 1;

export type IpcResponse<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: SerializedIpcError };

export interface RoutedRequestMetadata {
  version: typeof IPC_PROTOCOL_VERSION;
  kind: 'request';
  requestId: string;
  source: IpcSource;
  timeout: number;
}

export interface RoutedEventMetadata {
  version: typeof IPC_PROTOCOL_VERSION;
  kind: 'event';
  source: RendererIpcSource;
  delivery?: RoutedEventDelivery;
}

export type RoutedEventDelivery =
  | {
      kind: 'direct';
    }
  | {
      kind: 'broadcast';
      scope: unknown;
    };

export interface RoutedReplyMessage {
  version: typeof IPC_PROTOCOL_VERSION;
  requestId: string;
  response: IpcResponse;
}

export function successResponse<T>(value: T): IpcResponse<T> {
  return { ok: true, value };
}

export function errorResponse(error: SerializedIpcError): IpcResponse<never> {
  return { error, ok: false };
}

export function isIpcResponse(value: unknown): value is IpcResponse {
  if (!value || typeof value !== 'object' || !('ok' in value)) {
    return false;
  }
  if (value.ok === true) {
    return 'value' in value;
  }
  if (value.ok !== false || !('error' in value)) {
    return false;
  }
  const error = value.error;
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    'name' in error &&
    typeof error.name === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

export function unwrapResponse<T>(
  response: unknown,
  options?: { channel?: string; requestId?: string },
): T {
  if (!isIpcResponse(response)) {
    throw new IpcError(
      IpcErrorCode.ProtocolError,
      'Received an invalid IPC response',
      options,
    );
  }
  if (response.ok) {
    return response.value as T;
  }
  throw new IpcRemoteError(response.error, options);
}
