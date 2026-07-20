import {
  createForInterRenderers,
  type IpcRendererService,
  type MultiRenderersSchema,
} from '@sovea/electron-ipc-service/renderer';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;

type Expect<T extends true> = T;

type RendererId = 'main' | 'sub' | 'other';

type Schema = MultiRenderersSchema<
  RendererId,
  {
    mainRequest: (value: string) => number;
  },
  {
    main: {
      getInfo: (value: string) => 'main-result';
      mainOnly: () => void;
    };
    sub: {
      getInfo: (value: number) => 'sub-result';
      subOnly: (enabled: boolean) => number;
    };
    other: {
      getInfo: (value: boolean) => Promise<'other-result'>;
      otherOnly: (name: string) => boolean;
    };
  },
  {
    ping: () => 'pong';
    commonWithArgument: (value: string) => number;
  }
>;

type GetWebContentsId = (
  rendererId: RendererId,
  workspaceId: string,
) => number | undefined;

const useIpcRendererService = createForInterRenderers<
  Schema,
  GetWebContentsId
>();
const mainService = useIpcRendererService('main');

// Duplicate channel names retain the signature of the selected renderer.
const subResult = mainService.invokeTo('getInfo', {
  windowParams: ['sub', 'workspace'],
  data: [1],
});
export type SubResult = Expect<Equal<typeof subResult, Promise<'sub-result'>>>;

const otherResult = mainService.invokeTo('getInfo', {
  windowParams: ['other', 'workspace'],
  data: [true],
});
export type OtherResult = Expect<
  Equal<typeof otherResult, Promise<'other-result'>>
>;

// The getWebContentsId/schema relationship stays strict when an ID is also supplied.
const bothTargetsResult = mainService.invokeTo('getInfo', {
  webContentsId: 1,
  windowParams: ['sub', 'workspace'],
  data: [1],
});
export type BothTargetsResult = Expect<
  Equal<typeof bothTargetsResult, Promise<'sub-result'>>
>;

// Shared and target-unique channels retain their own return types.
const commonResult = mainService.invokeTo('ping', {
  windowParams: ['sub', 'workspace'],
});
export type CommonResult = Expect<Equal<typeof commonResult, Promise<'pong'>>>;

const uniqueResult = mainService.invokeTo('subOnly', {
  windowParams: ['sub', 'workspace'],
  data: [true],
});
export type UniqueResult = Expect<Equal<typeof uniqueResult, Promise<number>>>;

// sendTo uses the same target-specific argument inference.
mainService.sendTo('getInfo', {
  windowParams: ['other', 'workspace'],
  data: [true],
});
mainService.sendTo('commonWithArgument', {
  windowParams: ['sub', 'workspace'],
  data: ['value'],
});

// A webContentsId alone cannot identify a target schema at compile time.
const unknownResult = mainService.invokeTo('getInfo', {
  webContentsId: 1,
  data: [{ callerSpecifiedTarget: true }],
});
export type UnknownResult = Expect<
  Equal<typeof unknownResult, Promise<unknown>>
>;

mainService.sendTo('getInfo', {
  webContentsId: 1,
  data: [{ callerSpecifiedTarget: true }],
});

// Invalid target-aware calls must remain compile-time errors.
// @ts-expect-error sub.getInfo accepts a number, not a boolean
mainService.invokeTo('getInfo', {
  windowParams: ['sub', 'workspace'],
  data: [true],
});

mainService.invokeTo('getInfo', {
  // @ts-expect-error the current renderer cannot target itself
  windowParams: ['main', 'workspace'],
  data: ['self'],
});

mainService.invokeTo('getInfo', {
  // @ts-expect-error getWebContentsId requires the workspace id
  windowParams: ['sub'],
  data: [1],
});

// @ts-expect-error workspace id must be a string
mainService.invokeTo('getInfo', {
  windowParams: ['sub', 1],
  data: [1],
});

// @ts-expect-error the channel does not exist in any target renderer
mainService.invokeTo('missing', {
  webContentsId: 1,
});

// @ts-expect-error sendTo options do not accept a timeout
mainService.sendTo('getInfo', {
  windowParams: ['sub', 'workspace'],
  data: [1],
  timeout: 100,
});

// The base service preserves return inference for a known request map.
type DirectRequests = {
  unique: (id: string) => Promise<number>;
};

declare const directService: IpcRendererService<DirectRequests>;
const directResult = directService.invokeTo('unique', {
  webContentsId: 1,
  data: ['id'],
});
export type DirectResult = Expect<Equal<typeof directResult, Promise<number>>>;
