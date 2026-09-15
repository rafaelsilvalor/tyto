// `import type` and not an inline `{ type IpcMain }`: under `verbatimModuleSyntax` the
// inline form still emits `import {} from 'electron'`, which outside a running Electron
// resolves to a path string and would make this module unloadable in a test.
import type { IpcMain } from 'electron';

import {
  type IpcChannelName,
  type IpcRequest,
  type IpcResponse,
  IPC_CHANNEL_NAMES,
  parseIpc,
} from '../../shared/ipc.js';
import { type Credentials } from './credentials.js';
import { type PreviewService } from './preview.js';
import { type TemplateCatalogue } from './templates.js';

/**
 * Every handler, registered from the contract rather than beside it.
 *
 * The loop at the bottom is the load-bearing part: it walks `IPC_CHANNEL_NAMES`, so a
 * channel declared in `shared/ipc.ts` with no handler here is a **type error**, not a
 * renderer call that hangs forever. That is the failure this file is shaped to prevent —
 * the one where both sides look right and the message goes nowhere.
 *
 * Validation runs on the way in *and* on the way out. In, because a renderer is a separate
 * process and main may not trust what crosses the bridge, however typed the other side
 * looked at compile time. Out, because a response that does not match is main's bug and the
 * renderer has no way to tell: it would get `undefined` where the type promised a string,
 * at some later line, with nothing naming the channel.
 */

export interface IpcDependencies {
  readonly credentials: Credentials;
  /** `app.getVersion()` and friends, injected so the handlers can be tested without Electron. */
  readonly info: () => IpcResponse<'app:info'>;
  /** Brief text to one document per frame (E9.2). Injected for the same reason `info` is. */
  readonly preview: PreviewService;
  /** What the template picker lists (E9.3), read from manifests and held. */
  readonly templates: TemplateCatalogue;
}

/** One handler per channel, typed against the contract in both directions. */
type Handlers = {
  readonly [Name in IpcChannelName]: (request: IpcRequest<Name>) => Promise<IpcResponse<Name>>;
};

export function createHandlers(dependencies: IpcDependencies): Handlers {
  const { credentials, info, preview, templates } = dependencies;

  return {
    'app:info': () => Promise.resolve(info()),

    'brief:preview': async ({ requestId, brief }) => {
      const result = await preview.preview(brief);
      // The id goes back untouched. Main does not know which answer the renderer still
      // wants — only the renderer knows what it has asked since — so the whole of main's
      // part in discarding a stale result is not losing the number.
      return {
        requestId,
        frames: [...result.frames],
        artworks: [...result.artworks],
        diagnostics: [...result.diagnostics],
      };
    },

    'templates:list': () => Promise.resolve(templates.list()),

    'credentials:set': async ({ account, secret }) => {
      await credentials.set(account, secret);
      return { stored: true };
    },

    'credentials:get': async ({ account }) => ({ secret: await credentials.get(account) }),

    'credentials:delete': async ({ account }) => ({ deleted: await credentials.delete(account) }),
  };
}

/**
 * Wraps one handler in the contract, so neither direction can drift.
 *
 * Exported because this is the piece a test drives: it is the whole of what a message
 * crossing the bridge goes through, minus Electron's own transport.
 */
export function guard<Name extends IpcChannelName>(
  name: Name,
  handler: (request: IpcRequest<Name>) => Promise<IpcResponse<Name>>,
): (request: unknown) => Promise<IpcResponse<Name>> {
  return async (request: unknown) => {
    const parsed = parseIpc(name, 'request', request) as IpcRequest<Name>;
    const response = await handler(parsed);
    return parseIpc(name, 'response', response) as IpcResponse<Name>;
  };
}

/**
 * Binds every channel to `ipcMain`.
 *
 * `handle` and not `on`: every channel in the table is a request with a response, and
 * `invoke`/`handle` is the pair that carries a rejection back to the caller. A thrown
 * `IpcContractError` reaches the renderer as a rejected promise naming the channel, which
 * is what makes a contract violation visible instead of silent.
 */
export function registerIpcHandlers(ipcMain: IpcMain, dependencies: IpcDependencies): void {
  const handlers = createHandlers(dependencies);

  for (const name of IPC_CHANNEL_NAMES) {
    // The cast is the one place the per-channel types are joined into one signature.
    // `IPC_CHANNEL_NAMES` is a union of literals, and TypeScript cannot narrow `handlers[name]`
    // and the request type to the *same* member of it inside a loop.
    const handler = handlers[name] as (request: IpcRequest<typeof name>) => Promise<unknown>;
    const guarded = guard(name, handler as never);
    ipcMain.handle(name, (_event, request: unknown) => guarded(request));
  }
}
