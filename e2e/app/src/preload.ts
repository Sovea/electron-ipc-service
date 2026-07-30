import {
  create,
  createForInterRenderers,
  IpcRendererService,
  type RendererEventDelivery,
} from '@sovea/electron-ipc-service/renderer';
import electron from 'electron';
import type {
  BroadcastScope,
  BroadcastTargetOptions,
  DriverError,
  DriverEvent,
  E2EDriver,
  GetWebContentsId,
  MainSchema,
  RendererId,
  RendererSchema,
  TargetOptions,
} from './schema';
import {
  ipcChannelPrefix as expectedChannelPrefix,
  rendererIds,
} from './schema';

const { contextBridge, ipcRenderer } = electron;

const CONTROL_CHANNEL = 'e2e-control:request';
const READY_CHANNEL = 'e2e-control:renderer-ready';

function readArgument(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function assertRendererId(value: string | undefined): RendererId {
  if (rendererIds.includes(value as RendererId)) {
    return value as RendererId;
  }
  throw new Error(`Invalid renderer id: ${String(value)}`);
}

const rendererId = assertRendererId(readArgument('e2e-renderer-id'));
const channelPrefix = readArgument('e2e-channel-prefix');
const workspaceId = readArgument('e2e-workspace-id');
if (channelPrefix !== expectedChannelPrefix) {
  throw new Error(`Unexpected e2e channel prefix: ${String(channelPrefix)}`);
}
if (!workspaceId) {
  throw new Error('Missing e2e workspace id');
}

const events: DriverEvent[] = [];
const reportedErrors: DriverError[] = [];
let rejectReportedErrors = false;
const mainService = create<MainSchema>();
const useService = createForInterRenderers<
  RendererSchema,
  GetWebContentsId,
  BroadcastScope
>({
  async onError(error) {
    reportedErrors.push(describeError(error));
    await Promise.resolve();
    if (rejectReportedErrors) {
      throw new Error('e2e-on-error-rejection');
    }
  },
});
const services = {
  main: useService('main'),
  sub: useService('sub'),
  other: useService('other'),
};

function recordHandle(
  channel: string,
  data: unknown,
  source:
    | { readonly kind: 'main' }
    | { readonly kind: 'renderer'; readonly webContentsId: number },
) {
  events.push({
    kind: 'handle',
    channel,
    data,
    sourceId: source.kind === 'renderer' ? source.webContentsId : undefined,
    sourceKind: source.kind,
  });
}

function describeDelivery(delivery: RendererEventDelivery<BroadcastScope>) {
  return delivery.kind === 'broadcast'
    ? {
        deliveryKind: delivery.kind,
        scope: delivery.scope,
      }
    : {};
}

if (rendererId === 'main') {
  const service = services.main;
  service.handle('duplicate', (context, value) => {
    recordHandle('duplicate', value, context.source);
    return `main:${value}`;
  });
  service.handle('mainOnly', (context) => {
    recordHandle('mainOnly', undefined, context.source);
    return 'main-only';
  });
  service.handle('common', (context, value) => {
    recordHandle('common', value, context.source);
    return `main:${value}`;
  });
  service.receive('commonMessage', (context, value) => {
    events.push({
      kind: 'receive',
      channel: 'commonMessage',
      data: value,
      ...describeDelivery(context.delivery),
      sourceId:
        context.source.kind === 'renderer'
          ? context.source.webContentsId
          : undefined,
    });
  });
}

if (rendererId === 'sub') {
  const service = services.sub;
  service.handle('duplicate', (context, value) => {
    recordHandle('duplicate', value, context.source);
    return value * 2;
  });
  service.handle('subOnly', (context, enabled) => {
    recordHandle('subOnly', enabled, context.source);
    return !enabled;
  });
  service.handle('throwRenderer', (context, message) => {
    recordHandle('throwRenderer', message, context.source);
    throw new Error(message);
  });
  service.handle('unserializable', (context) => {
    recordHandle('unserializable', undefined, context.source);
    return () => 'not-cloneable';
  });
  service.handle('waitRenderer', (context) => {
    recordHandle('waitRenderer', undefined, context.source);
    return new Promise<string>(() => {});
  });
  service.handle('outOfOrder', async (context, index, delay) => {
    recordHandle('outOfOrder', { delay, index }, context.source);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return { index };
  });
  service.receive('receiveMessage', (context, value) => {
    events.push({
      kind: 'receive',
      channel: 'receiveMessage',
      data: value,
      sourceId:
        context.source.kind === 'renderer'
          ? context.source.webContentsId
          : undefined,
    });
  });
  service.receiveOnce('receiveOnceMessage', (context, value) => {
    events.push({
      kind: 'receive',
      channel: 'receiveOnceMessage',
      data: value,
      sourceId:
        context.source.kind === 'renderer'
          ? context.source.webContentsId
          : undefined,
    });
  });
  service.receive('throwRendererEvent', async () => {
    await Promise.resolve();
    throw new Error('renderer-event-boom');
  });
  const unsubscribeMessage = service.receive(
    'unsubscribedMessage',
    (_context, value) => {
      events.push({
        kind: 'receive',
        channel: 'unsubscribedMessage',
        data: value,
      });
    },
  );
  unsubscribeMessage();
  service.handle('common', (context, value) => {
    recordHandle('common', value, context.source);
    return `sub:${value}`;
  });
  service.receive('commonMessage', (context, value) => {
    events.push({
      kind: 'receive',
      channel: 'commonMessage',
      data: value,
      ...describeDelivery(context.delivery),
      sourceId:
        context.source.kind === 'renderer'
          ? context.source.webContentsId
          : undefined,
    });
  });

  // Observe the wire metadata separately without exposing raw ipcRenderer.
  ipcRenderer.prependListener(
    `${channelPrefix}external:event:receiveMessage`,
    (
      _event,
      _data,
      metadata:
        | { source?: { kind?: string; webContentsId?: number } }
        | undefined,
    ) => {
      events.push({
        kind: 'wire',
        channel: 'receiveMessage',
        sourceId: metadata?.source?.webContentsId,
      });
    },
  );
  ipcRenderer.prependListener(
    `${channelPrefix}external:request:waitRenderer`,
    (_event, _data, metadata: { requestId?: string } | undefined) => {
      events.push({
        kind: 'wire',
        channel: 'waitRenderer',
        data: { requestId: metadata?.requestId },
      });
    },
  );
}

if (rendererId === 'other') {
  const service = services.other;
  service.handle('duplicate', (context, value) => {
    recordHandle('duplicate', value, context.source);
    return !value;
  });
  service.handle('otherOnly', (context, name) => {
    recordHandle('otherOnly', name, context.source);
    return `other:${name}`;
  });
  service.handle('common', (context, value) => {
    recordHandle('common', value, context.source);
    return `other:${value}`;
  });
  service.receive('commonMessage', (context, value) => {
    events.push({
      kind: 'receive',
      channel: 'commonMessage',
      data: value,
      ...describeDelivery(context.delivery),
      sourceId:
        context.source.kind === 'renderer'
          ? context.source.webContentsId
          : undefined,
    });
  });
}

type MainRuntimeService = {
  invoke(
    channel: string,
    options: { data?: unknown[]; timeout?: number },
  ): Promise<unknown>;
  send(channel: string, ...data: unknown[]): void;
};

type InterRendererRuntimeService = {
  broadcast(channel: string, options: BroadcastTargetOptions): void;
  destroy(): void;
  handle(
    channel: string,
    listener: (...args: unknown[]) => unknown,
  ): () => void;
  invokeTo(channel: string, options: TargetOptions): Promise<unknown>;
  sendTo(channel: string, options: Omit<TargetOptions, 'timeout'>): void;
};

function describeError(error: unknown): DriverError {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
      name: 'Error',
    };
  }
  const details = error as Error & {
    code?: string;
    remoteCode?: string;
  };
  return {
    code: details.code,
    message: details.message,
    name: details.name,
    remoteCode: details.remoteCode,
  };
}

async function captureError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    return describeError(error);
  }
  throw new Error('Expected IPC operation to fail');
}

// The driver intentionally accepts arbitrary wire input for negative E2E cases.
const mainRuntimeService = mainService as unknown as MainRuntimeService;
const interRendererRuntimeService = services[
  rendererId
] as unknown as InterRendererRuntimeService;
const driver: E2EDriver = {
  ready: true,
  rendererId,
  invokeMain(channel, data = [], timeout) {
    return mainRuntimeService.invoke(channel, { data, timeout });
  },
  invokeMainError(channel, data = [], timeout) {
    return captureError(() =>
      mainRuntimeService.invoke(channel, { data, timeout }),
    );
  },
  sendMain(channel, data = []) {
    mainRuntimeService.send(channel, ...data);
  },
  invokeTo(channel, options) {
    return interRendererRuntimeService.invokeTo(channel, options);
  },
  invokeToError(channel, options) {
    return captureError(() =>
      interRendererRuntimeService.invokeTo(channel, options),
    );
  },
  forgeReply(requestId, value) {
    ipcRenderer.send(`${channelPrefix}internal:reply-to`, {
      requestId,
      response: {
        ok: true,
        value,
      },
      version: 1,
    });
  },
  sendTo(channel, options) {
    interRendererRuntimeService.sendTo(channel, options);
  },
  broadcast(channel, options) {
    interRendererRuntimeService.broadcast(channel, options);
  },
  getEvents() {
    return [...events];
  },
  clearEvents() {
    events.length = 0;
  },
  control<T>(command: string, payload?: unknown) {
    return ipcRenderer.invoke(CONTROL_CHANNEL, command, payload) as Promise<T>;
  },
  async localControl<T>(command: string, payload?: unknown) {
    switch (command) {
      case 'reported-errors':
        return [...reportedErrors] as T;
      case 'clear-reported-errors':
        reportedErrors.length = 0;
        return true as T;
      case 'reject-reported-errors':
        rejectReportedErrors = payload === true;
        return rejectReportedErrors as T;
      case 'register-duplicate-handler':
        {
          const competingService =
            new IpcRendererService() as unknown as InterRendererRuntimeService;
          try {
            const dispose = competingService.handle(
              'duplicate',
              () => undefined,
            );
            dispose();
            competingService.destroy();
          } catch (error) {
            competingService.destroy();
            return describeError(error) as T;
          }
        }
        throw new Error('Expected duplicate renderer handler registration');
      case 'destroy-with-pending': {
        const eventChannel = `${channelPrefix}external:event:commonMessage`;
        const requestChannel = `${channelPrefix}external:request:duplicate`;
        const eventListenerCountBefore =
          ipcRenderer.listenerCount(eventChannel);
        const listenerCountBefore = ipcRenderer.listenerCount(requestChannel);
        const pending = captureError(() =>
          interRendererRuntimeService.invokeTo('waitRenderer', {
            timeout: 1_000,
            windowParams: ['sub', workspaceId],
          }),
        );
        await Promise.resolve();
        interRendererRuntimeService.destroy();
        const error = await pending;
        return {
          error,
          eventListenerCountAfter: ipcRenderer.listenerCount(eventChannel),
          eventListenerCountBefore,
          listenerCountAfter: ipcRenderer.listenerCount(requestChannel),
          listenerCountBefore,
        } as T;
      }
      default:
        throw new Error(`Unknown local control command: ${command}`);
    }
  },
};

contextBridge.exposeInMainWorld('e2e', driver);
ipcRenderer.send(READY_CHANNEL, rendererId);
