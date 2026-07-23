import {
  IpcMainService,
  type IpcMainServiceOptions,
  type IpcServiceBaseOptions,
  type RequestOptions,
  type Unsubscribe,
} from '@sovea/electron-ipc-service';
import {
  create,
  createForInterRenderers,
  type InterRendererIpcRendererService,
  type IpcRendererServiceListener,
  type MultiRenderersSchema,
} from '@sovea/electron-ipc-service/renderer';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';

type MainSchema = {
  notify: (message: string) => void;
  ping: (message: string) => string;
};

const mainOptions = {
  ipcChannelPrefix: 'app:',
  pendingRequestTimeout: 1_000,
  getWebContentsId: (_windowType: string) => 1,
} satisfies IpcMainServiceOptions;

const baseOptions: IpcServiceBaseOptions = mainOptions;
void baseOptions;

const mainService = new IpcMainService<MainSchema>(mainOptions);
const removeNotify: Unsubscribe = mainService.on('notify', (event, message) => {
  const mainEvent: IpcMainEvent = event;
  void mainEvent;
  void message;
});
removeNotify();

mainService.handle('ping', (event, message) => {
  const invokeEvent: IpcMainInvokeEvent = event;
  void invokeEvent;
  return `pong:${message}`;
});

const rendererService = create<MainSchema>();
rendererService.send('notify', 'hello');
const response = rendererService.invoke('ping', {
  data: ['hello'],
  timeout: 1_000,
});
response satisfies Promise<string>;

const pingOptions: RequestOptions<MainSchema, 'ping'> = {
  data: ['hello'],
};
void pingOptions;

// @ts-expect-error invoke expects RequestOptions, not positional arguments
rendererService.invoke('ping', 'hello');

type RendererId = 'main' | 'settings';
type RendererSchema = MultiRenderersSchema<
  RendererId,
  MainSchema,
  {
    main: {
      refresh: () => void;
    };
    settings: {
      readSettings: () => string;
    };
  }
>;
type GetWebContentsId = (rendererId: RendererId) => number | undefined;

const getRendererService = createForInterRenderers<
  RendererSchema,
  GetWebContentsId
>();
const typedRendererService = getRendererService('main');
typedRendererService.invokeTo('readSettings', {
  windowParams: ['settings'],
});

type NamedService = InterRendererIpcRendererService<
  RendererSchema,
  'main',
  GetWebContentsId
>;
typedRendererService satisfies NamedService;

type SettingsListener = IpcRendererServiceListener<
  { readSettings: () => string },
  'readSettings'
>;
declare const settingsListener: SettingsListener;
void settingsListener;

// @ts-expect-error renderer values are only exported from the renderer entry
import { create as createFromRoot } from '@sovea/electron-ipc-service';

void createFromRoot;

// @ts-expect-error implementation modules are not public package entrypoints
import type { BaseIpcService } from '@sovea/electron-ipc-service/core/base';

declare const internalBase: BaseIpcService;
void internalBase;
