import type { MultiRenderersSchema } from '@sovea/electron-ipc-service/renderer';

export const rendererIds = ['main', 'sub', 'other'] as const;
export const ipcChannelPrefix = 'ipc-service:';

export type RendererId = (typeof rendererIds)[number];

export type MainSchema = {
  requests: {
    echoMain: (value: string) => string;
    asyncMain: (value: number) => Promise<number>;
    throwMain: (message: string) => never;
    waitMain: () => Promise<string>;
    onceMain: (value: string) => string;
    removableMain: (value: string) => string;
    sameChannel: (value: string) => string;
  };
  events: {
    mainEvent: (value: string) => void;
    mainOnceEvent: (value: string) => void;
    sameChannel: (value: string) => void;
    throwMainEvent: () => void;
  };
};

export type RendererSchema = MultiRenderersSchema<
  RendererId,
  MainSchema,
  {
    main: {
      requests: {
        duplicate: (value: string) => string;
        mainOnly: () => string;
      };
      events: Record<never, never>;
    };
    sub: {
      requests: {
        duplicate: (value: number) => number;
        subOnly: (enabled: boolean) => boolean;
        throwRenderer: (message: string) => never;
        unserializable: () => unknown;
        waitRenderer: () => Promise<string>;
        outOfOrder: (index: number, delay: number) => { index: number };
      };
      events: {
        receiveMessage: (value: string) => void;
        receiveOnceMessage: (value: string) => void;
        throwRendererEvent: () => void;
        unsubscribedMessage: (value: string) => void;
      };
    };
    other: {
      requests: {
        duplicate: (value: boolean) => boolean;
        otherOnly: (name: string) => string;
      };
      events: Record<never, never>;
    };
  },
  {
    requests: {
      common: (value: string) => string;
    };
    events: {
      commonMessage: (value: string) => void;
    };
  }
>;

export type GetWebContentsId = (
  rendererId: RendererId,
  workspaceId: string,
) => number | undefined;

export type BroadcastScope =
  | {
      kind: 'workspace';
      workspaceId: string;
    }
  | {
      kind: 'renderer';
      rendererId: RendererId;
    }
  | {
      kind: 'with-missing-target';
      workspaceId: string;
    };

export type DriverEvent = {
  kind: 'handle' | 'receive' | 'wire';
  channel: string;
  data?: unknown;
  sourceId?: number;
  sourceKind?: 'main' | 'renderer';
  deliveryKind?: 'broadcast';
  scope?: unknown;
};

export type DriverError = {
  name: string;
  message: string;
  code?: string;
  remoteCode?: string;
};

// Keep the driver permissive so E2E can exercise invalid wire-level input.
export type TargetOptions = {
  data?: unknown[];
  timeout?: number;
  webContentsId?: number;
  windowParams?: [RendererId, string];
};

export type BroadcastTargetOptions = {
  data?: unknown[];
  scope?: { kind: 'all' } | BroadcastScope;
};

export interface E2EDriver {
  readonly ready: true;
  readonly rendererId: RendererId;
  invokeMain(
    channel: string,
    data?: unknown[],
    timeout?: number,
  ): Promise<unknown>;
  invokeMainError(
    channel: string,
    data?: unknown[],
    timeout?: number,
  ): Promise<DriverError>;
  sendMain(channel: string, data?: unknown[]): void;
  invokeTo(channel: string, options: TargetOptions): Promise<unknown>;
  invokeToError(channel: string, options: TargetOptions): Promise<DriverError>;
  forgeReply(requestId: string, value: unknown): void;
  sendTo(channel: string, options: Omit<TargetOptions, 'timeout'>): void;
  broadcast(channel: string, options: BroadcastTargetOptions): void;
  getEvents(): DriverEvent[];
  clearEvents(): void;
  control<T>(command: string, payload?: unknown): Promise<T>;
  localControl<T>(command: string, payload?: unknown): T | Promise<T>;
}
