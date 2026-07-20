import {
  type createForInterRenderers,
  IpcRendererService,
} from '@sovea/electron-ipc-service/renderer';
import electron from 'electron';
import type {
  DriverEvent,
  E2EDriver,
  GetWebContentsId,
  RendererId,
  RendererSchema,
  TargetOptions,
} from './schema';
import { rendererIds } from './schema';

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
if (!channelPrefix) {
  throw new Error('Missing e2e channel prefix');
}
if (!workspaceId) {
  throw new Error('Missing e2e workspace id');
}

const events: DriverEvent[] = [];
const sharedRuntimeService = new IpcRendererService({
  ipcChannelPrefix: channelPrefix,
});
const useService = ((_key: RendererId) => sharedRuntimeService) as ReturnType<
  typeof createForInterRenderers<RendererSchema, GetWebContentsId>
>;
const services = {
  main: useService('main'),
  sub: useService('sub'),
  other: useService('other'),
};

function recordHandle(channel: string, data: unknown, sourceId: number) {
  events.push({ kind: 'handle', channel, data, sourceId });
}

if (rendererId === 'main') {
  const service = services.main;
  service.handle('duplicate', (_event, [value], options) => {
    recordHandle('duplicate', value, options.webContentsId);
    return `main:${value}`;
  });
  service.handle('mainOnly', (_event, _data, options) => {
    recordHandle('mainOnly', undefined, options.webContentsId);
    return 'main-only';
  });
  service.handle('common', (_event, [value], options) => {
    recordHandle('common', value, options.webContentsId);
    return `main:${value}`;
  });
  service.receive('commonMessage', (_event, value) => {
    events.push({ kind: 'receive', channel: 'commonMessage', data: value });
  });
}

if (rendererId === 'sub') {
  const service = services.sub;
  service.handle('duplicate', (_event, [value], options) => {
    recordHandle('duplicate', value, options.webContentsId);
    return value * 2;
  });
  service.handle('subOnly', (_event, [enabled], options) => {
    recordHandle('subOnly', enabled, options.webContentsId);
    return !enabled;
  });
  service.handle('throwRenderer', (_event, [message], options) => {
    recordHandle('throwRenderer', message, options.webContentsId);
    throw new Error(message);
  });
  service.handle('waitRenderer', (_event, _data, options) => {
    recordHandle('waitRenderer', undefined, options.webContentsId);
    return new Promise<string>(() => {});
  });
  service.handle('outOfOrder', async (_event, [index, delay], options) => {
    recordHandle('outOfOrder', { delay, index }, options.webContentsId);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return { index };
  });
  service.receive('receiveMessage', (_event, value) => {
    events.push({ kind: 'receive', channel: 'receiveMessage', data: value });
  });
  service.receiveOnce('receiveOnceMessage', (_event, value) => {
    events.push({
      kind: 'receive',
      channel: 'receiveOnceMessage',
      data: value,
    });
  });
  const unsubscribeMessage = service.receive(
    'unsubscribedMessage',
    (_event, value) => {
      events.push({
        kind: 'receive',
        channel: 'unsubscribedMessage',
        data: value,
      });
    },
  );
  unsubscribeMessage();
  service.handle('common', (_event, [value], options) => {
    recordHandle('common', value, options.webContentsId);
    return `sub:${value}`;
  });
  service.receive('commonMessage', (_event, value) => {
    events.push({ kind: 'receive', channel: 'commonMessage', data: value });
  });

  // Observe the wire metadata separately without exposing raw ipcRenderer.
  ipcRenderer.prependListener(
    `${channelPrefix}external:receiveMessage`,
    (_event, _data, options: { webContentsId?: number } | undefined) => {
      events.push({
        kind: 'wire',
        channel: 'receiveMessage',
        sourceId: options?.webContentsId,
      });
    },
  );
}

if (rendererId === 'other') {
  const service = services.other;
  service.handle('duplicate', (_event, [value], options) => {
    recordHandle('duplicate', value, options.webContentsId);
    return !value;
  });
  service.handle('otherOnly', (_event, [name], options) => {
    recordHandle('otherOnly', name, options.webContentsId);
    return `other:${name}`;
  });
  service.handle('common', (_event, [value], options) => {
    recordHandle('common', value, options.webContentsId);
    return `other:${value}`;
  });
  service.receive('commonMessage', (_event, value) => {
    events.push({ kind: 'receive', channel: 'commonMessage', data: value });
  });
}

type RuntimeService = {
  invoke(
    channel: string,
    options: { data?: unknown[]; timeout?: number },
  ): Promise<unknown>;
  send(channel: string, ...data: unknown[]): void;
  invokeTo(channel: string, options: TargetOptions): Promise<unknown>;
  sendTo(channel: string, options: Omit<TargetOptions, 'timeout'>): void;
};

const runtimeService = services[rendererId] as unknown as RuntimeService;
const driver: E2EDriver = {
  ready: true,
  rendererId,
  invokeMain(channel, data = [], timeout) {
    return runtimeService.invoke(channel, { data, timeout });
  },
  sendMain(channel, data = []) {
    runtimeService.send(channel, ...data);
  },
  invokeTo(channel, options) {
    return runtimeService.invokeTo(channel, options);
  },
  sendTo(channel, options) {
    runtimeService.sendTo(channel, options);
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
};

contextBridge.exposeInMainWorld('e2e', driver);
ipcRenderer.send(READY_CHANNEL, rendererId);
