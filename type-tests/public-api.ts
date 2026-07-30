import {
  createForInterRenderers as createMainForInterRenderers,
  type InterRendererIpcMainService,
  type InterRendererIpcMainServiceOptions,
  type IpcError,
  IpcErrorCode,
  type IpcErrorCode as IpcErrorCodeType,
  IpcMainService,
  type IpcMainServiceOptions,
  type IpcServiceBaseOptions,
  type MainEventContext,
  type MainRequestContext,
  type RequestOptions,
  type Unsubscribe,
} from '@sovea/electron-ipc-service';
import {
  create,
  createForInterRenderers,
  type InterRendererIpcRendererService,
  type IpcRendererRequestHandler,
  type MultiRenderersSchema,
  type RendererRequestContext,
} from '@sovea/electron-ipc-service/renderer';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';

type MainSchema = {
  requests: {
    ping: (message: string) => string;
  };
  events: {
    notify: (message: string) => void;
  };
};

interface InterfaceRequests {
  interfacePing: (message: string) => Promise<string>;
}

interface InterfaceEvents {
  interfaceNotify: (message: string) => void;
}

interface InterfaceSchema {
  requests: InterfaceRequests;
  events: InterfaceEvents;
}

interface InvalidSchema {
  requests: {
    invalid: string;
  };
  events: InterfaceEvents;
}

const mainOptions = {
  ipcChannelPrefix: 'app:',
  requestTimeout: 1_000,
  getWebContentsId: (_windowType: string) => 1,
  onError(error) {
    error satisfies IpcError;
  },
} satisfies IpcMainServiceOptions;

const baseOptions: IpcServiceBaseOptions = mainOptions;
void baseOptions;

const asyncErrorOptions: IpcServiceBaseOptions = {
  async onError(_error) {
    await Promise.resolve();
  },
};
void asyncErrorOptions;

const mainService = new IpcMainService<MainSchema>(mainOptions);
const removeNotify: Unsubscribe = mainService.on(
  'notify',
  (context, message) => {
    context satisfies MainEventContext;
    context.channel satisfies 'notify';
    const mainEvent: IpcMainEvent = context.event;
    void mainEvent;
    void message;
  },
);
removeNotify();

mainService.handle('ping', (context, message) => {
  context satisfies MainRequestContext;
  context.channel satisfies 'ping';
  const invokeEvent: IpcMainInvokeEvent = context.event;
  void invokeEvent;
  return `pong:${message}`;
});

// @ts-expect-error events cannot be registered as request handlers
mainService.handle('notify', () => undefined);

// @ts-expect-error requests cannot be registered as events
mainService.on('ping', () => undefined);

const interfaceMainService = new IpcMainService<InterfaceSchema>();
interfaceMainService.handle('interfacePing', (context, message) => {
  context.channel satisfies 'interfacePing';
  return Promise.resolve(message);
});
interfaceMainService.on('interfaceNotify', (context, message) => {
  context.channel satisfies 'interfaceNotify';
  void message;
});

// @ts-expect-error schema members must be functions
new IpcMainService<InvalidSchema>();

const rendererService = create<MainSchema>();
rendererService.send('notify', 'hello');
const response = rendererService.invoke('ping', {
  data: ['hello'],
  timeout: 1_000,
});
response satisfies Promise<string>;

const interfaceRendererService = create<InterfaceSchema>();
interfaceRendererService.send('interfaceNotify', 'value');
interfaceRendererService.invoke('interfacePing', {
  data: ['value'],
});

// @ts-expect-error schema members must be functions
create<InvalidSchema>();

// @ts-expect-error requests cannot be sent
rendererService.send('ping', 'hello');

// @ts-expect-error events cannot be invoked
rendererService.invoke('notify', { data: ['hello'] });

const pingOptions: RequestOptions<MainSchema['requests'], 'ping'> = {
  data: ['hello'],
};
void pingOptions;

type RendererId = 'main' | 'settings';
type RendererSchema = MultiRenderersSchema<
  RendererId,
  MainSchema,
  {
    main: {
      requests: Record<never, never>;
      events: {
        refresh: () => void;
      };
    };
    settings: {
      requests: {
        readSettings: () => string;
      };
      events: Record<never, never>;
    };
  }
>;
type GetWebContentsId = (rendererId: RendererId) => number | undefined;

const mainInterRendererOptions = {
  getWebContentsId: (_rendererId: RendererId) => 1,
  requestTimeout: 500,
} satisfies InterRendererIpcMainServiceOptions<
  RendererSchema,
  GetWebContentsId
>;

const interRendererMainService = createMainForInterRenderers<
  RendererSchema,
  GetWebContentsId
>(mainInterRendererOptions);
const settingsResult = interRendererMainService.invoke('readSettings', {
  windowParams: ['settings'],
});
settingsResult satisfies Promise<string>;

const unknownSettingsResult = interRendererMainService.invoke('readSettings', {
  webContentsId: 1,
});
unknownSettingsResult satisfies Promise<unknown>;

// @ts-expect-error target-specific request payload is inferred from the target
interRendererMainService.invoke('readSettings', {
  windowParams: ['settings'],
  data: ['unexpected'],
});

// @ts-expect-error unknown renderer request channel
interRendererMainService.invoke('missing', {
  webContentsId: 1,
});

type NamedMainService = InterRendererIpcMainService<
  RendererSchema,
  GetWebContentsId
>;
interRendererMainService satisfies NamedMainService;

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

const settingsService = getRendererService('settings');
settingsService.handle('readSettings', (context) => {
  context.channel satisfies 'readSettings';
  if (context.source.kind === 'renderer') {
    context.source.webContentsId satisfies number;
  } else {
    context.source satisfies { readonly kind: 'main' };
  }
  return 'settings';
});

type SettingsHandler = IpcRendererRequestHandler<
  { readSettings: () => string },
  'readSettings'
>;
declare const settingsHandler: SettingsHandler;
declare const rendererContext: RendererRequestContext;
void settingsHandler;
void rendererContext;

const code = IpcErrorCode.Timeout;
code satisfies 'IPC_TIMEOUT';
const typedCode: IpcErrorCodeType = code;
void typedCode;

// @ts-expect-error renderer values are only exported from the renderer entry
import { create as createFromRoot } from '@sovea/electron-ipc-service';

void createFromRoot;

// @ts-expect-error implementation modules are not public package entrypoints
import type { BaseIpcService } from '@sovea/electron-ipc-service/core/base';

declare const internalBase: BaseIpcService;
void internalBase;
