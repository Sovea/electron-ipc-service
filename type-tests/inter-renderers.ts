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
      refreshAll: () => void;
    };
  }
>;

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
      projectId: number;
    };

const useIpcRendererService = createForInterRenderers<
  Schema,
  GetWebContentsId,
  BroadcastScope
>();
const scopedMain = createMainForInterRenderers<
  Schema,
  GetWebContentsId,
  BroadcastScope
>({
  getWebContentsId: (_rendererId, _workspaceId) => 1,
  resolveBroadcastTargets(context) {
    context.channel satisfies 'commonNotice' | 'refreshAll';
    context.source.webContentsId satisfies number;
    if (context.scope.kind === 'project') {
      context.scope.projectId satisfies number;
    }
    return [];
  },
});
void scopedMain;
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
mainService.broadcast('commonNotice', {
  data: ['global'],
});
mainService.broadcast('refreshAll');
mainService.broadcast('commonNotice', {
  data: ['workspace'],
  scope: {
    kind: 'workspace',
    workspaceId: 'workspace',
  },
});
mainService.receive('commonNotice', (context, value) => {
  value satisfies string;
  if (context.delivery.kind === 'broadcast') {
    if (context.delivery.scope.kind === 'workspace') {
      context.delivery.scope.workspaceId satisfies string;
    }
  } else {
    context.delivery satisfies { readonly kind: 'direct' };
  }
});

// @ts-expect-error only common renderer events can be broadcast
mainService.broadcast('subNotice', {
  data: [1],
});

mainService.broadcast('commonNotice', {
  // @ts-expect-error commonNotice requires a string payload
  data: [1],
});

mainService.broadcast('commonNotice', {
  data: ['workspace'],
  scope: {
    kind: 'workspace',
    // @ts-expect-error workspaceId must be a string
    workspaceId: 1,
  },
});

mainService.broadcast('commonNotice', {
  data: ['project'],
  scope: {
    kind: 'project',
    // @ts-expect-error projectId must be a number
    projectId: 'project',
  },
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

type ConflictingSchema = MultiRenderersSchema<
  'only',
  EmptyEndpoint,
  {
    only: {
      requests: Record<never, never>;
      events: {
        duplicateCommon: (value: number) => void;
      };
    };
  },
  {
    requests: Record<never, never>;
    events: {
      duplicateCommon: (value: string) => void;
    };
  }
>;
type GetConflictingWebContentsId = (rendererId: 'only') => number | undefined;

// @ts-expect-error common channels cannot be redeclared by a specific renderer
createForInterRenderers<ConflictingSchema, GetConflictingWebContentsId>();

// @ts-expect-error main rejects the same common/specified channel conflict
createMainForInterRenderers<ConflictingSchema, GetConflictingWebContentsId>({
  getWebContentsId: () => 1,
  resolveBroadcastTargets: () => [],
});
