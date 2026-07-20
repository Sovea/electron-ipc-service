import type { MultiRenderersSchema } from '@sovea/electron-ipc-service/renderer';

export const rendererIds = ['main', 'sub', 'other'] as const;

export type RendererId = (typeof rendererIds)[number];

export type MainSchema = {
  mainEvent: (value: string) => void;
  mainOnceEvent: (value: string) => void;
  echoMain: (value: string) => string;
  asyncMain: (value: number) => Promise<number>;
  throwMain: (message: string) => never;
  waitMain: () => Promise<string>;
  onceMain: (value: string) => string;
  removableMain: (value: string) => string;
};

export type RendererSchema = MultiRenderersSchema<
  RendererId,
  MainSchema,
  {
    main: {
      duplicate: (value: string) => string;
      mainOnly: () => string;
    };
    sub: {
      duplicate: (value: number) => number;
      subOnly: (enabled: boolean) => boolean;
      throwRenderer: (message: string) => never;
      waitRenderer: () => Promise<string>;
      outOfOrder: (index: number, delay: number) => { index: number };
      receiveMessage: (value: string) => void;
      receiveOnceMessage: (value: string) => void;
      unsubscribedMessage: (value: string) => void;
    };
    other: {
      duplicate: (value: boolean) => boolean;
      otherOnly: (name: string) => string;
    };
  },
  {
    common: (value: string) => string;
    commonMessage: (value: string) => void;
  }
>;

export type GetWebContentsId = (
  rendererId: RendererId,
  workspaceId: string,
) => number | undefined;

export type DriverEvent = {
  kind: 'handle' | 'receive' | 'wire';
  channel: string;
  data?: unknown;
  sourceId?: number;
};

// Keep the driver permissive so E2E can exercise invalid wire-level input.
export type TargetOptions = {
  data?: unknown[];
  timeout?: number;
  webContentsId?: number;
  windowParams?: [RendererId, string];
};

export interface E2EDriver {
  readonly ready: true;
  readonly rendererId: RendererId;
  invokeMain(
    channel: string,
    data?: unknown[],
    timeout?: number,
  ): Promise<unknown>;
  sendMain(channel: string, data?: unknown[]): void;
  invokeTo(channel: string, options: TargetOptions): Promise<unknown>;
  sendTo(channel: string, options: Omit<TargetOptions, 'timeout'>): void;
  getEvents(): DriverEvent[];
  clearEvents(): void;
  control<T>(command: string, payload?: unknown): Promise<T>;
}
