# Electron Ipc Service

Request-Response IPC Service for Electron, enabling communication between the main and renderer processes, and **also among renderer processes**.

## Install

```sh
npm install @sovea/electron-ipc-service@alpha
```

## Usage

### Classic Ipc Between Main and Renderer

Create IpcMainService:

```typescript
import { IpcMainService } from "@sovea/electron-ipc-service";

export type IpcSchema = {
  ping: (msg: string) => boolean;
};

export const ipcMainService = new IpcMainService<IpcSchema>();

ipcMainService.handle("ping", (event, msg) => {
  return true;
});
```

Create IpcRendererService:

```typescript
import { create } from "@sovea/electron-ipc-service/renderer";

export const ipcRendererService = create<IpcSchema>();

ipcRendererService.invoke("ping", "I am renderer.");
```

### Ipc among renderer processes (multiple windows)

Create IpcMainService with getWebContentsId function (function to get target renderer webContentsId).

```typescript
import { IpcMainService } from "@sovea/electron-ipc-service";

export type IpcSchema = {};

export const ipcMainService = new IpcMainService<IpcSchema>({
  getWebContentsId: (type: string) => {
    // any window manager
    return windowManager.getWebContentsId(type);
  },
});
```

Create IpcRendererService with MultiRenderersSchema.

```typescript
import {
  createForInterRenderers,
  MultiRenderersSchema,
} from "@sovea/electron-ipc-service/renderer";

// Renderer unique identifier type
type WindowType = "main" | "sub";

type IpcSchemaBetweenMainAndRenderer = {
  ping: (msg: string) => boolean;
};

export type IpcAmongRenderersSchema = MultiRenderersSchema<
  WindowType,
  IpcSchemaBetweenMainAndRenderer,
  {
    main: {
      testMain: (msg: string) => number;
    };
    sub: {
      testSub: (msg: number) => boolean;
    };
  },
  {
    testCommon: () => number;
  }
>;

export const useIpcRendererService = createForInterRenderers<
  IpcAmongRenderersSchema,
  (type: WindowType) => number
>();
```

Use ipc renderer service in main window:

```typescript
import React, { useEffect } from "react";
import { useIpcRendererService } from "../ipc-service";

const ipcRendererService = useIpcRendererService("main");

export function App() {
  useEffect(() => {
    ipcRendererService
      .invokeTo("testSub", { data: [1], windowParams: ["sub"] })
      .then((res) => {
        console.log("invoke testSub: ", res);
      });
  }, []);

  return <div>main</div>;
}
```

Use ipc renderer service in sub window:

```typescript
import React, { useEffect } from "react";
import { useIpcRendererService } from "../ipc-service";

const ipcRendererService = useIpcRendererService("sub");

export function App() {
  useEffect(() => {
    ipcRendererService.handle("testSub", (_event, data) => {
      console.log("handle testSub", data);
      return true;
    });
  }, []);

  return <div>sub</div>;
}
```

### Direct Message Channel among renderer processes

`connectTo` asks the main process to create a `MessageChannelMain`, transfer one port to the current renderer, and transfer the other port to the target renderer. After setup, messages sent through the returned port go directly between renderers.

Listen for direct connections in the target renderer:

```typescript
const ipcRendererService = useIpcRendererService("sub");

const unsubscribe = ipcRendererService.onConnect("direct-chat", (event, port) => {
  console.log("direct connection from", event.sourceWebContentsId);

  port.onmessage = (message) => {
    console.log("message from main window", message.data);
    port.postMessage("pong from sub window");
  };
});
```

Connect from another renderer:

```typescript
const ipcRendererService = useIpcRendererService("main");

const port = await ipcRendererService.connectTo("direct-chat", {
  windowParams: ["sub"],
});

port.onmessage = (message) => {
  console.log("message from sub window", message.data);
};
port.postMessage("ping from main window");
```

You can also pass `webContentsId` directly:

```typescript
const port = await ipcRendererService.connectTo("direct-chat", {
  webContentsId: subWindow.webContents.id,
});
```

### Inter-renderer type inference

When using `createForInterRenderers`, `windowParams[0]` should be the renderer unique identifier type from `MultiRenderersSchema`. That lets `invokeTo` and `sendTo` infer the target renderer's channel payload and response types even if multiple renderers declare the same channel name with different signatures.

```typescript
type WindowType = "main" | "sub" | "other";

type IpcAmongRenderersSchema = MultiRenderersSchema<
  WindowType,
  {},
  {
    main: {
      getInfo: (value: string) => number;
    };
    sub: {
      getInfo: (value: number) => string;
    };
  },
  {}
>;

const useIpcRendererService = createForInterRenderers<
  IpcAmongRenderersSchema,
  (type: WindowType) => number | undefined
>();

const ipcRendererService = useIpcRendererService("main");

const result = await ipcRendererService.invokeTo("getInfo", {
  windowParams: ["sub"],
  data: [1],
});
// result is string
```

If you target by `webContentsId` without `windowParams`, the target renderer type cannot be known, so `invokeTo` returns `Promise<unknown>` and `data` is intentionally typed as `unknown[]`.
