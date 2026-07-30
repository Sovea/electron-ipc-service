import { createForInterRenderers as createMainForInterRenderers } from '@sovea/electron-ipc-service';
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
    requests: {
      mainRequest: (value: string) => number;
    };
    events: {
      mainEvent: (value: string) => void;
    };
  },
  {
    main: {
      requests: {
        getInfo: (value: string) => 'main-result';
        mainOnly: () => void;
      };
      events: {
        mainNotice: (value: string) => void;
      };
    };
    sub: {
      requests: {
        getInfo: (value: number) => 'sub-result';
        subOnly: (enabled: boolean) => number;
      };
      events: {
        subNotice: (value: number) => void;
      };
    };
    other: {
      requests: {
        getInfo: (value: boolean) => Promise<'other-result'>;
        otherOnly: (name: string) => boolean;
      };
      events: {
        otherNotice: (value: boolean) => void;
      };
    };
  },
  {
    requests: {
      ping: () => 'pong';
    };
    events: {
      commonNotice: (value: string) => void;
    };
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

// @ts-expect-error target selectors are mutually exclusive
mainService.invokeTo('getInfo', {
  webContentsId: 1,
  windowParams: ['sub', 'workspace'],
  data: [1],
});

// @ts-expect-error exactly one target selector is required
mainService.invokeTo('getInfo', {
  data: [1],
});

const commonResult = mainService.invokeTo('ping', {
  windowParams: ['sub', 'workspace'],
});
export type CommonResult = Expect<Equal<typeof commonResult, Promise<'pong'>>>;

const uniqueResult = mainService.invokeTo('subOnly', {
  windowParams: ['sub', 'workspace'],
  data: [true],
});
export type UniqueResult = Expect<Equal<typeof uniqueResult, Promise<number>>>;

mainService.sendTo('otherNotice', {
  windowParams: ['other', 'workspace'],
  data: [true],
});
mainService.sendTo('commonNotice', {
  windowParams: ['sub', 'workspace'],
  data: ['value'],
});

const unknownResult = mainService.invokeTo('getInfo', {
  webContentsId: 1,
  data: [{ callerSpecifiedTarget: true }],
});
export type UnknownResult = Expect<
  Equal<typeof unknownResult, Promise<unknown>>
>;

mainService.sendTo('subNotice', {
  webContentsId: 1,
  data: [{ callerSpecifiedTarget: true }],
});

// @ts-expect-error requests cannot be sent as events
mainService.sendTo('getInfo', {
  windowParams: ['sub', 'workspace'],
  data: [1],
});

// @ts-expect-error events cannot be invoked
mainService.invokeTo('subNotice', {
  windowParams: ['sub', 'workspace'],
  data: [1],
});

// @ts-expect-error sub.getInfo accepts a number
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
  // @ts-expect-error resolver requires the workspace id
  windowParams: ['sub'],
  data: [1],
});

// @ts-expect-error workspace id must be a string
mainService.invokeTo('getInfo', {
  windowParams: ['sub', 1],
  data: [1],
});

// @ts-expect-error unknown request channel
mainService.invokeTo('missing', {
  webContentsId: 1,
});

// @ts-expect-error sendTo does not accept timeout
mainService.sendTo('subNotice', {
  windowParams: ['sub', 'workspace'],
  data: [1],
  timeout: 100,
});

type DirectRendererEndpoint = {
  requests: {
    unique: (id: string) => Promise<number>;
  };
  events: {
    changed: (id: string) => void;
  };
};

declare const directService: IpcRendererService<DirectRendererEndpoint>;
const directResult = directService.invokeTo('unique', {
  webContentsId: 1,
  data: ['id'],
});
export type DirectResult = Expect<Equal<typeof directResult, Promise<number>>>;

directService.sendTo('changed', {
  webContentsId: 1,
  data: ['id'],
});

// @ts-expect-error direct event is not invokable
directService.invokeTo('changed', {
  webContentsId: 1,
  data: ['id'],
});

type EmptyRequests = Record<never, never>;

type EmptyEvents = Record<never, never>;

interface EmptyEndpoint {
  requests: EmptyRequests;
  events: EmptyEvents;
}

interface StringRendererRequests {
  textRequest: (value: string) => 'text-result';
}

interface StringRendererEndpoint {
  requests: StringRendererRequests;
  events: EmptyEvents;
}

interface NumericRendererRequests {
  numericRequest: (value: number) => number;
}

interface NumericRendererEndpoint {
  requests: NumericRendererRequests;
  events: EmptyEvents;
}

type MixedRendererId = 'main' | 2;
type MixedRendererSchema = MultiRenderersSchema<
  MixedRendererId,
  EmptyEndpoint,
  {
    main: StringRendererEndpoint;
    2: NumericRendererEndpoint;
  },
  EmptyEndpoint
>;
type GetMixedWebContentsId = (
  rendererId: MixedRendererId,
  workspaceId: string,
) => number | undefined;

const useMixedRenderer = createForInterRenderers<
  MixedRendererSchema,
  GetMixedWebContentsId
>();
const mixedMain = createMainForInterRenderers<
  MixedRendererSchema,
  GetMixedWebContentsId
>({
  getWebContentsId: (_rendererId, _workspaceId) => 1,
});
const stringRenderer = useMixedRenderer('main');
const numericRenderer = useMixedRenderer(2);

const numericResult = stringRenderer.invokeTo('numericRequest', {
  data: [2],
  windowParams: [2, 'workspace'],
});
export type NumericResult = Expect<
  Equal<typeof numericResult, Promise<number>>
>;

const numericMainResult = mixedMain.invoke('numericRequest', {
  data: [2],
  windowParams: [2, 'workspace'],
});
export type NumericMainResult = Expect<
  Equal<typeof numericMainResult, Promise<number>>
>;

const textResult = numericRenderer.invokeTo('textRequest', {
  data: ['value'],
  windowParams: ['main', 'workspace'],
});
export type TextResult = Expect<
  Equal<typeof textResult, Promise<'text-result'>>
>;

const textMainResult = mixedMain.invoke('textRequest', {
  data: ['value'],
  windowParams: ['main', 'workspace'],
});
export type TextMainResult = Expect<
  Equal<typeof textMainResult, Promise<'text-result'>>
>;

// @ts-expect-error renderer ids are limited to the declared string | number union
useMixedRenderer(3);
