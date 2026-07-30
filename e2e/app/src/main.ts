import path from 'node:path';
import {
  createForInterRenderers,
  type InterRendererIpcMainService,
} from '@sovea/electron-ipc-service';
import electron, {
  type BrowserWindow as ElectronBrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import type {
  DriverError,
  GetWebContentsId,
  RendererId,
  RendererSchema,
  TargetOptions,
} from './schema';
import { rendererIds } from './schema';

const { app, BrowserWindow, ipcMain } = electron;

const CONTROL_CHANNEL = 'e2e-control:request';
const READY_CHANNEL = 'e2e-control:renderer-ready';
const channelPrefix = process.env.E2E_CHANNEL_PREFIX;
const workspaceId = process.env.E2E_WORKSPACE_ID || 'default-workspace';
const windows = new Map<RendererId, ElectronBrowserWindow>();
const readyRenderers = new Set<RendererId>();
const mainEvents: Array<{ channel: string; value: string }> = [];

let service:
  | InterRendererIpcMainService<RendererSchema, GetWebContentsId>
  | undefined;
let mainEventDisposer: (() => void) | undefined;
let removableDisposer: (() => void) | undefined;
let removableGeneration = 1;
let cleanedUp = false;

if (!channelPrefix) {
  throw new Error('Missing E2E channel prefix');
}

if (process.env.E2E_USER_DATA_DIR) {
  app.setPath('userData', process.env.E2E_USER_DATA_DIR);
}

function getWebContentsId(rendererId: RendererId, queryWorkspaceId: string) {
  if (queryWorkspaceId !== workspaceId) {
    return undefined;
  }
  return windows.get(rendererId)?.webContents.id;
}

function installRemovableHandler() {
  removableDisposer = service?.handle('removableMain', (_context, value) => {
    return `handler-${removableGeneration}:${value}`;
  });
}

function installService() {
  service = createForInterRenderers<RendererSchema, GetWebContentsId>({
    getWebContentsId,
    ipcChannelPrefix: channelPrefix,
    requestTimeout: 300,
  });

  mainEventDisposer = service.on('mainEvent', (_context, value) => {
    mainEvents.push({ channel: 'mainEvent', value });
  });
  service.once('mainOnceEvent', (_context, value) => {
    mainEvents.push({ channel: 'mainOnceEvent', value });
  });
  service.handle('echoMain', (_context, value) => value);
  service.handle('asyncMain', async (_context, value) => value * 2);
  service.handle('throwMain', (_context, message) => {
    throw new Error(message);
  });
  service.handle('waitMain', () => new Promise<string>(() => {}));
  service.handleOnce('onceMain', (_event, value) => `once:${value}`);
  service.handle('sameChannel', (_context, value) => `request:${value}`);
  service.on('sameChannel', (_context, value) => {
    mainEvents.push({ channel: 'sameChannel', value });
  });
  service.on('throwMainEvent', async () => {
    await Promise.resolve();
    throw new Error('main-event-boom');
  });
  installRemovableHandler();
}

function destroyService() {
  const currentService = service;
  currentService?.destroy();
  currentService?.destroy();
  service = undefined;
  mainEventDisposer = undefined;
  removableDisposer = undefined;
}

function createWindow(rendererId: RendererId) {
  const window = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    title: `e2e-${rendererId}`,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(
        app.getAppPath(),
        'dist-electron',
        'preload',
        'index.mjs',
      ),
      additionalArguments: [
        `--e2e-channel-prefix=${channelPrefix}`,
        `--e2e-renderer-id=${rendererId}`,
        `--e2e-workspace-id=${workspaceId}`,
      ],
    },
  });
  windows.set(rendererId, window);
  window.on('closed', () => {
    windows.delete(rendererId);
  });
  void window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), {
    query: { renderer: rendererId },
  });
}

function assertRendererId(value: unknown): RendererId {
  if (rendererIds.includes(value as RendererId)) {
    return value as RendererId;
  }
  throw new Error(`Unknown renderer id: ${String(value)}`);
}

type MainInvokePayload = {
  channel: string;
  options: TargetOptions;
};

type MainRuntimeService = {
  invoke(channel: string, options: TargetOptions): Promise<unknown>;
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

async function handleControl(
  event: IpcMainInvokeEvent,
  command: string,
  payload: unknown,
) {
  switch (command) {
    case 'state':
      return {
        electronVersion: process.versions.electron,
        workspaceId,
        readyRenderers: [...readyRenderers].sort(),
        windowIds: Object.fromEntries(
          [...windows].map(([id, window]) => [id, window.webContents.id]),
        ),
      };
    case 'main-events':
      return [...mainEvents];
    case 'clear-main-events':
      mainEvents.length = 0;
      return true;
    case 'flush':
      return true;
    case 'unsubscribe-main-event':
      mainEventDisposer?.();
      mainEventDisposer = undefined;
      return true;
    case 'replace-removable-handler':
      {
        const staleDisposer = removableDisposer;
        staleDisposer?.();
        removableGeneration += 1;
        installRemovableHandler();
        staleDisposer?.();
      }
      return removableGeneration;
    case 'destroy-service':
      destroyService();
      return true;
    case 'recreate-service':
      if (!service) {
        installService();
      }
      return true;
    case 'window-id':
      return windows.get(assertRendererId(payload))?.webContents.id;
    case 'invoke-renderer': {
      const { channel, options } = payload as MainInvokePayload;
      return (service as unknown as MainRuntimeService | undefined)?.invoke(
        channel,
        options,
      );
    }
    case 'invoke-renderer-error': {
      const { channel, options } = payload as MainInvokePayload;
      return captureError(() => {
        const currentService = service as unknown as
          | MainRuntimeService
          | undefined;
        if (!currentService) {
          throw new Error('Main IPC service is not available');
        }
        return currentService.invoke(channel, options);
      });
    }
    case 'close-self':
      BrowserWindow.fromWebContents(event.sender)?.close();
      return true;
    default:
      throw new Error(`Unknown control command: ${command}`);
  }
}

const onRendererReady = (_event: IpcMainEvent, rendererId: RendererId) => {
  readyRenderers.add(assertRendererId(rendererId));
};

ipcMain.handle(CONTROL_CHANNEL, handleControl);
ipcMain.on(READY_CHANNEL, onRendererReady);

app.on('before-quit', () => {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;
  destroyService();
  ipcMain.removeHandler(CONTROL_CHANNEL);
  ipcMain.off(READY_CHANNEL, onRendererReady);
});

app.on('window-all-closed', () => {
  app.quit();
});

await app.whenReady();
installService();
for (const rendererId of rendererIds) {
  createWindow(rendererId);
}
