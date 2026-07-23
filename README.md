# Electron IPC Service

Type-safe request-response IPC for Electron main and renderer processes, with
optional routing between renderer processes.

## Install

```sh
npm install @sovea/electron-ipc-service
```

Electron 28.0.0 or newer is required. The package is published as native ESM.

## Main and renderer

Define the channels shared by the main process and preload:

```typescript
// ipc-schema.ts
export type MainIpc = {
  ping: (message: string) => string;
};
```

Register handlers in the main process:

```typescript
// main.ts
import { IpcMainService } from '@sovea/electron-ipc-service';
import type { MainIpc } from './ipc-schema.js';

const ipc = new IpcMainService<MainIpc>();

const removePingHandler = ipc.handle('ping', (event, message) => {
  // Validate event.senderFrame before performing privileged work.
  return `pong:${message}`;
});

// Dispose application handlers explicitly, then stop internal routing.
function disposeIpc() {
  removePingHandler();
  ipc.destroy();
}
```

Create the renderer service in a preload script and expose only application
operations:

```typescript
// preload.ts
import { contextBridge } from 'electron';
import { create } from '@sovea/electron-ipc-service/renderer';
import type { MainIpc } from './ipc-schema.js';

const ipc = create<MainIpc>();

export type AppApi = {
  ping(message: string): Promise<string>;
};

const appApi: AppApi = {
  ping: (message) => ipc.invoke('ping', { data: [message] }),
};

contextBridge.exposeInMainWorld('appApi', appApi);
```

The page calls the narrow API instead of receiving the IPC service itself:

```typescript
const response = await window.appApi.ping('hello');
```

Add `AppApi` to the page's `Window` type in your application.

## Renderer-to-renderer routing

Configure the main service with a function that resolves an application window
identifier to a `webContentsId`:

```typescript
type WindowId = 'main' | 'settings';

const ipc = new IpcMainService<MainIpc>({
  getWebContentsId: (windowId: WindowId) =>
    windowManager.getWebContentsId(windowId),
});
```

Describe the channels handled by each renderer and create one typed service per
preload:

```typescript
import {
  createForInterRenderers,
  type MultiRenderersSchema,
} from '@sovea/electron-ipc-service/renderer';

type WindowId = 'main' | 'settings';
type RendererIpc = MultiRenderersSchema<
  WindowId,
  MainIpc,
  {
    main: Record<never, never>;
    settings: {
      readSettings: () => string;
    };
  }
>;
type GetWebContentsId = (windowId: WindowId) => number | undefined;

const getIpc = createForInterRenderers<RendererIpc, GetWebContentsId>();

const mainIpc = getIpc('main');
const settings = await mainIpc.invokeTo('readSettings', {
  windowParams: ['settings'],
});

const settingsIpc = getIpc('settings');
const removeHandler = settingsIpc.handle('readSettings', () => {
  return JSON.stringify({ theme: 'system' });
});
```

Expose application-specific wrappers through `contextBridge`; do not expose
`mainIpc`, `settingsIpc`, or Electron's `ipcRenderer` directly to a page.

`invokeTo()` and `sendTo()` require exactly one target:

- `windowParams` uses `getWebContentsId` and preserves target-specific types.
- `webContentsId` routes directly, so its result and payload types are
  intentionally unknown.

## API notes

- `send()` sends a one-way message to the main process.
- `invoke()` calls a main-process handler and returns its result.
- `sendTo()` and `invokeTo()` route through the main process to another
  renderer.
- `on()`, `once()`, `handle()`, `handleOnce()`, `receive()`, and
  `receiveOnce()` return an unsubscribe function.
- `IpcMainService.destroy()` rejects pending renderer-to-renderer requests and
  removes internal routing handlers. Application handlers must be removed with
  their unsubscribe functions.
- Renderer-to-renderer requests default to a 5-second pending-request timeout.
  A positive `timeout` option overrides it for an individual request.

## Security

This package provides compile-time types, not runtime validation or
authorization.

- Create renderer services in trusted preload code.
- Keep `contextIsolation` enabled and `nodeIntegration` disabled.
- Expose narrow application operations through `contextBridge`.
- Validate IPC payloads at runtime and authorize privileged main-process work.
- Validate the sender of incoming IPC messages.
- Do not treat channel names or `ipcChannelPrefix` as a security boundary.

See Electron's
[security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
for the complete application-level guidance.

## Compatibility

- Electron: `>=28.0.0`
- Tested Electron versions: `28.0.0` and `43.1.1`
- Node.js package consumers: `^18.0.0 || >=20.0.0`
- Module format: native ESM; CommonJS callers must use dynamic `import()`

Development setup and verification commands are documented in
[CONTRIBUTING.md](https://github.com/Sovea/electron-ipc-service/blob/main/CONTRIBUTING.md).

## License

[MIT](./LICENSE)
