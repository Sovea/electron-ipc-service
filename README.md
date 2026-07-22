# Electron Ipc Service

Request-Response IPC Service for Electron, enabling communication between the main and renderer processes, and **also among renderer processes**.

## Install

```sh
npm install @sovea/electron-ipc-service
```

Electron 28.0.0 or newer is required. The package is published as native ESM.

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

## Verification

Development requires Node.js 22.13.0 or newer and pnpm 11.15.1.

The E2E suite builds a clean `esm/` output, packs the real npm tarball, and
installs it into an isolated Vite consumer before Playwright launches Electron.
This prevents tests from resolving the repository source by accident.

```sh
pnpm run test:e2e          # Electron 28.0.0 minimum
pnpm run test:e2e:current  # pinned current Electron
pnpm run test:e2e:stress   # manual/release-PR concurrency stress suite
pnpm run pack:check        # dry-run the npm publish manifest
```

On Debian/Ubuntu Linux:

```sh
pnpm run test:e2e:install-deps
xvfb-run -a pnpm run test:e2e
```

Failed runs preserve the temporary consumer and write diagnostics to
`test-results/e2e-setup.json`.

Use `pnpm run test:types` for the public declaration contract and
`pnpm run check:ci` for a read-only Biome check.
