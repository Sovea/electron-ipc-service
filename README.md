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
