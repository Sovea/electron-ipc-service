# Electron IPC Service

Type-safe request-response and event IPC for Electron main and renderer
processes, with optional routing between renderer endpoints.

## Install

```sh
npm install @sovea/electron-ipc-service
```

Electron 28.0.0 or newer is required. The package is published as native ESM.

## Requests and events

Every endpoint separates request-response channels from one-way events:

```typescript
// ipc-schema.ts
export type MainIpc = {
  requests: {
    ping: (message: string) => string;
  };
  events: {
    notify: (message: string) => void;
  };
};
```

This distinction is enforced throughout the API:

- `invoke()` and `handle()` accept request channels.
- `send()` and `on()` accept event channels.
- `invokeTo()` and renderer `handle()` accept renderer request channels.
- `sendTo()` and `receive()` accept renderer event channels.

Request and event channels use separate wire namespaces, so the same name can
exist in both groups without colliding.

Channel maps may be declared with either type aliases or interfaces. Every map
member must be a function; non-function members are rejected when the schema is
used by a service.

## Main and renderer

Register handlers in the main process:

```typescript
// main.ts
import { IpcMainService } from '@sovea/electron-ipc-service';
import type { MainIpc } from './ipc-schema.js';

const ipc = new IpcMainService<MainIpc>();

const removePingHandler = ipc.handle('ping', (context, message) => {
  // Validate the native Electron event before privileged work.
  const senderFrame = context.event.senderFrame;
  return `pong:${message}`;
});

const removeNotifyListener = ipc.on('notify', (context, message) => {
  console.log(context.source.webContentsId, message);
});

function disposeIpc() {
  removePingHandler();
  removeNotifyListener();
  ipc.destroy();
}
```

Create the renderer service in a preload script and expose only
application-specific operations:

```typescript
// preload.ts
import { contextBridge } from 'electron';
import { create } from '@sovea/electron-ipc-service/renderer';
import type { MainIpc } from './ipc-schema.js';

const ipc = create<MainIpc>();

export type AppApi = {
  ping(message: string): Promise<string>;
  notify(message: string): void;
};

const appApi: AppApi = {
  ping: (message) => ipc.invoke('ping', { data: [message] }),
  notify: (message) => ipc.send('notify', message),
};

contextBridge.exposeInMainWorld('appApi', appApi);
```

Do not expose the service or Electron's `ipcRenderer` directly to a page.

## Multi-renderer routing

Define an application-owned renderer resolver:

```typescript
type RendererId = 'main' | 'settings';

type GetWebContentsId = (
  rendererId: RendererId,
  workspaceId: string,
) => number | undefined;

type BroadcastScope =
  | {
      kind: 'workspace';
      workspaceId: string;
    }
  | {
      kind: 'project';
      projectId: string;
    };

const getWebContentsId: GetWebContentsId = (
  rendererId,
  workspaceId,
) => windowManager.getWebContentsId(rendererId, workspaceId);
```

Describe request and event channels for each renderer:

```typescript
import {
  type MultiRenderersSchema,
} from '@sovea/electron-ipc-service/renderer';

type RendererId = 'main' | 'settings';

type RendererIpc = MultiRenderersSchema<
  RendererId,
  MainIpc,
  {
    main: {
      requests: Record<never, never>;
      events: {
        refresh: (reason: string) => void;
      };
    };
    settings: {
      requests: {
        readSettings: () => string;
      };
      events: Record<never, never>;
    };
  },
  {
    requests: {
      health: () => 'ready';
    };
    events: {
      themeChanged: (theme: string) => void;
    };
  }
>;

type GetWebContentsId = (
  rendererId: RendererId,
  workspaceId: string,
) => number | undefined;
```

In the main process, create the typed router from the complete schema. Main uses
`invoke()` because its outbound direction is unambiguously a renderer:

```typescript
import {
  createForInterRenderers,
} from '@sovea/electron-ipc-service';

const ipc = createForInterRenderers<
  RendererIpc,
  GetWebContentsId,
  BroadcastScope
>({
  getWebContentsId,
  resolveBroadcastTargets: ({ source, channel, scope }) => {
    // Validate the renderer-declared logical scope before resolving it.
    if (scope.kind === 'all') {
      return windowManager.getAllRendererWebContentsIds();
    }
    return windowManager.getRendererWebContentsIds(scope);
  },
});

const settings = await ipc.invoke('readSettings', {
  windowParams: ['settings', 'workspace'],
});
```

In each trusted renderer preload, select the current logical renderer:

```typescript
import {
  createForInterRenderers,
} from '@sovea/electron-ipc-service/renderer';

const getIpc = createForInterRenderers<
  RendererIpc,
  GetWebContentsId,
  BroadcastScope
>();

const mainRendererIpc = getIpc('main');
const settings = await mainRendererIpc.invokeTo('readSettings', {
  windowParams: ['settings', 'workspace'],
});
mainRendererIpc.sendTo('themeChanged', {
  windowParams: ['settings', 'workspace'],
  data: ['dark'],
});
mainRendererIpc.broadcast('themeChanged', {
  data: ['dark'],
  scope: {
    kind: 'workspace',
    workspaceId: 'workspace',
  },
});

const settingsIpc = getIpc('settings');
const removeHandler = settingsIpc.handle(
  'readSettings',
  (context) => {
    if (context.source.kind === 'renderer') {
      console.log(context.source.webContentsId);
    }
    return JSON.stringify({ theme: 'system' });
  },
);
```

Main `invoke()` and renderer `invokeTo()` / `sendTo()` require exactly one
target:

- `windowParams` uses `getWebContentsId` and preserves target-specific types.
- `webContentsId` routes directly, so payload and result types are intentionally
  unknown.

Renderer identifiers support both strings and numbers, including mixed unions
such as `'main' | 1`.

`broadcast()` accepts only `renderer.common.events`. It sends one message from
the source renderer to Main; Main resolves the logical scope and fans the event
out to a snapshot of live targets. The source renderer is always excluded,
duplicate targets are delivered once, and a failed target does not block the
others. Omitting `scope` means `{ kind: 'all' }`.

Scope descriptors are application-defined, type-safe structured-clone values.
Renderers declare routing intent, while Main remains responsible for validating
that intent and mapping it to `webContentsId` values. Common request and event
channel names cannot be redeclared by a specific renderer.

## Handler context

Handlers and listeners consistently receive `(context, ...arguments)`.
Contexts remain precise for their process and message kind:

- `MainRequestContext`
- `MainEventContext`
- `RendererRequestContext`
- `RendererEventContext`

The public context contains only the channel, source and native Electron event.
Its channel retains the registered string literal. Main handlers and renderer
event listeners receive a renderer source. Renderer request handlers may be
invoked by either Main or another renderer, so they receive a discriminated
source union. Internal request IDs, timeout timers and response envelopes are
not exposed.

```typescript
type RendererIpcSource = {
  kind: 'renderer';
  webContentsId: number;
};

type MainIpcSource = {
  kind: 'main';
};

type RendererRequestSource =
  | MainIpcSource
  | RendererIpcSource;

type RendererEventDelivery<BroadcastScope> =
  | {
      kind: 'direct';
    }
  | {
      kind: 'broadcast';
      scope: { kind: 'all' } | BroadcastScope;
    };
```

Renderer event listeners can discriminate `context.delivery.kind` to determine
whether an event was sent directly or broadcast and inspect the effective
broadcast scope.

## Errors and timeouts

IPC failures use stable error classes and codes:

```typescript
import {
  IpcError,
  IpcErrorCode,
} from '@sovea/electron-ipc-service/renderer';

try {
  await ipc.invoke('ping', {
    data: ['hello'],
    timeout: 1_000,
  });
} catch (error) {
  if (
    error instanceof IpcError &&
    error.code === IpcErrorCode.Timeout
  ) {
    // Handle a local request timeout.
  }
}
```

Remote handler failures reject with `IpcRemoteError`. Its `remoteCode` contains
the serialized error code reported by the remote endpoint.

An unserializable routed response rejects with
`IPC_SERIALIZATION_ERROR` instead of leaving the caller waiting for a timeout.
Registering a second request handler for the same service channel throws
`IPC_HANDLER_ALREADY_REGISTERED`. Event channels may still have multiple
listeners.

Timeout behavior is consistent:

- omitted: use `requestTimeout`, which defaults to 5 seconds;
- `0`: disable the timeout;
- positive number: override the timeout;
- negative or non-finite number: reject with `IPC_PROTOCOL_ERROR`.

Use the `onError` service option to observe asynchronous event and protocol
errors. It may return a Promise; rejected callbacks are caught and reported
without creating an unhandled rejection. One-way events cannot report handler
completion to their sender.

## Lifecycle

- Registration methods return an idempotent unsubscribe function.
- A service owns the handlers and listeners it registers. `destroy()` removes
  application and internal registrations automatically.
- `destroy()` rejects locally pending requests with
  `IPC_SERVICE_DESTROYED`.
- Request channels have one handler per service; event channels may have
  multiple listeners.
- A handler that already started before `destroy()` may finish once. New
  messages are not accepted afterward.
- A pending routed request rejects immediately when its target `WebContents` is
  destroyed.
- Replies are accepted only from the request's expected target.

## Migrating from the previous API

This refactor intentionally changes the public schema and handler contract:

- Wrap each previous function map in `requests` or `events`.
- Rename `pendingRequestTimeout` to `requestTimeout`.
- Change Main listeners from `(event, ...args)` to `(context, ...args)` and use
  `context.event` for the native Electron event.
- Change renderer request handlers from `(event, data, options)` to
  `(context, ...args)`.
- Read the routed sender from `context.source`.
- Catch `IpcError` subclasses and inspect stable codes instead of matching
  transport error strings.
- Treat `destroy()` as ownership cleanup: it now removes registrations created
  by that service in addition to rejecting pending work.

The previous and current wire protocols are not interoperable. Main and preload
code must use matching implementations.

## Security

This package provides compile-time types and basic protocol integrity, not
runtime payload validation or application authorization.

- Create renderer services in trusted preload code.
- Keep `contextIsolation` enabled and `nodeIntegration` disabled.
- Expose narrow application operations through `contextBridge`.
- Validate IPC payloads at runtime.
- Authorize privileged work and validate `context.event.senderFrame`.
- Do not treat channel names or `ipcChannelPrefix` as a security boundary.

See Electron's
[security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
for complete application guidance.

## Compatibility

- Electron: `>=28.0.0`
- Tested Electron versions: `28.0.0` and `43.1.1`
- Node.js package consumers: `^18.0.0 || >=20.0.0`
- Module format: native ESM; CommonJS callers must use dynamic `import()`

Development setup and verification commands are documented in
[CONTRIBUTING.md](https://github.com/Sovea/electron-ipc-service/blob/main/CONTRIBUTING.md).

## License

[MIT](./LICENSE)
