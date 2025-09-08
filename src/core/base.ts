import { nanoid } from 'nanoid';
import type { IpcServiceBaseOptions } from '../types';

export class BaseIpcService {
  protected options: IpcServiceBaseOptions;

  /** pending requests */
  protected pendingRequests: Map<
    string,
    {
      resolve: (data: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();

  constructor(options?: IpcServiceBaseOptions) {
    this.options = {
      ipcChannelPrefix: 'ipc-service:',
      pendingRequestTimeout: 5000,
      ...(options || {}),
    };
  }

  /** generate unique request id */
  generateId() {
    return nanoid();
  }

  /** generate unique channel name */
  wrapChannel(channel: string) {
    return `${this.options.ipcChannelPrefix || ''}${channel}`;
  }

  /**
   * add pending request
   * @param id request id
   * @param resolve resolve function
   * @param reject reject function
   * @param timeout timer for pending request
   */
  addPendingRequest(
    id: string,
    resolve: (data: any) => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout,
  ) {
    this.pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
    });
  }

  /**
   * resolve pending request with request id
   * @param id request id
   * @param data response data
   */
  resolvePendingRequest(id: string, data: any) {
    const pendingRequest = this.pendingRequests.get(id);
    if (pendingRequest) {
      const { resolve, timeout } = pendingRequest;
      if (timeout) {
        clearTimeout(timeout);
      }
      this.pendingRequests.delete(id);
      resolve(data);
    }
  }

  /**
   * reject pending request with request id
   * @param id request id
   * @param error error object
   */
  rejectPendingRequest(id: string, error?: Error) {
    const pendingRequest = this.pendingRequests.get(id);
    if (pendingRequest) {
      const { reject, timeout } = pendingRequest;
      if (timeout) {
        clearTimeout(timeout);
      }
      this.pendingRequests.delete(id);
      reject(error || new Error(`Request ${id} has been reject`));
    }
  }

  /**
   * drop all pending requests
   */
  dropAllPendingRequests() {
    this.pendingRequests.forEach((pendingRequest, id) => {
      const { reject, timeout } = pendingRequest;
      if (timeout) {
        clearTimeout(timeout);
      }
      this.pendingRequests.delete(id);
      reject(new Error(`Request ${id} has been reject`));
    });
  }

  destroy() {
    this.dropAllPendingRequests();
  }
}
