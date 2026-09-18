// `import type` and not an inline `{ type IpcMain }`: under `verbatimModuleSyntax` the
// inline form still emits `import {} from 'electron'`, which outside a running Electron
// resolves to a path string and would make this module unloadable in a test.
import type { IpcMain, WebContents } from 'electron';

import {
  type IpcChannelName,
  type IpcEventName,
  type IpcEventPayload,
  type IpcRequest,
  type IpcResponse,
  IPC_CHANNEL_NAMES,
  parseIpc,
  parseIpcEvent,
} from '../../shared/ipc.js';
import { type Credentials } from './credentials.js';
import { type DesktopLog } from './log.js';
import { type DocumentService } from './documents.js';
import { type ExportService } from './export.js';
import { type LayoutStore } from './layout-store.js';
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
  /** Opening, saving, and the folder the preview resolves assets against (E9.8). */
  readonly documents: DocumentService;
  /** Where the panels were last time (E9.10). */
  readonly layout: LayoutStore;
  /**
   * A yes-or-no in front of the window (E9.11), injected for the reason the dialogs are.
   *
   * Every string in it is the renderer's, already translated. Main owns the OS dialog and
   * nothing else about the question.
   */
  readonly confirm: (question: IpcRequest<'dialog:confirm'>) => Promise<boolean>;
  /**
   * The return leg of the one question main asks (TYTO-123, ADR 0029).
   *
   * Here rather than in `quit.ts` for the reason everything else in this interface is here:
   * the handler table is the contract's half, and what it is wired to is the composition
   * root's business.
   */
  readonly exit: { readonly answer: (askId: number, allow: boolean) => void };
  /** Brief text to files on disk (E9.4). Injected for the reason `preview` is. */
  readonly exports: ExportService;
  /**
   * The native folder picker and the OS file manager, wrapped here for the reason the other
   * dialogs are: `dialog` and `shell` are Electron main-process APIs, and a service that
   * named one could not be tested without launching one.
   */
  readonly folders: {
    choose: () => Promise<string | undefined>;
    reveal: (directory: string) => Promise<void>;
  };
  /**
   * Where a failure gets written down (TYTO-132).
   *
   * Injected like everything else here, and typed as the whole log rather than as `Logger`
   * because `log:reveal` needs to know which folder to open and the log is the only thing
   * that knows.
   */
  readonly log: DesktopLog;
  /**
   * The template folder this app searches before the built-in pack (TYTO-122).
   *
   * Wrapped here for the reason `folders` is: choosing one opens a native dialog and writes a
   * file, and both are Electron's and the composition root's. What the handler owns is the
   * message, not the picker and not the disk.
   */
  readonly project: {
    folder: () => { folder: string | null; found: number };
    setFolder: (choose: boolean) => Promise<{ folder: string | null; found: number }>;
  };
  /**
   * Rebuilds the application menu in a language (TYTO-124).
   *
   * A function and not the menu, for the reason every other Electron thing here arrives as
   * one: `Menu.setApplicationMenu` is the browser process's and this module is tested without
   * a browser process. An unknown locale string is the composition root's to resolve, which is
   * why this takes what the window sent rather than a `Locale`.
   */
  readonly menu: {
    setLocale: (locale: string) => void;
  };
}

/** One handler per channel, typed against the contract in both directions. */
type Handlers = {
  readonly [Name in IpcChannelName]: (request: IpcRequest<Name>) => Promise<IpcResponse<Name>>;
};

export function createHandlers(dependencies: IpcDependencies): Handlers {
  const {
    confirm,
    credentials,
    documents,
    exit,
    exports,
    folders,
    info,
    layout,
    log,
    menu,
    preview,
    project,
    templates,
  } = dependencies;

  return {
    'app:info': () => Promise.resolve(info()),

    'brief:preview': async ({ requestId, documentId, brief }) => {
      // The folder is looked up from the id **this request carries**, not from whichever
      // tab is in front. A preview is debounced and answers out of order by design, so the
      // subject has to travel with the question (`shared/ipc.ts`).
      const result = await preview.preview(brief, documents.folderOf(documentId));
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

    // No `Promise.resolve` any more: `list()` is async since TYTO-122, because a folder change
    // means new `preview.png` files to read.
    'templates:list': () => templates.list(),

    'templates:folder': () => Promise.resolve(project.folder()),

    'templates:set-folder': ({ choose }) => project.setFolder(choose),

    'file:open': ({ documentId }) => documents.open(documentId),

    'file:reopen': ({ documentId, path }) => documents.reopen(documentId, path),

    'file:save': ({ documentId, text, saveAs }) => documents.save(documentId, text, saveAs),

    'file:close': ({ documentId }) => {
      documents.close(documentId);
      return Promise.resolve({});
    },

    'dialog:confirm': async (question) => ({ confirmed: await confirm(question) }),

    'app:exit-answer': ({ askId, allow }) => {
      exit.answer(askId, allow);
      return Promise.resolve({});
    },

    'files:recent': () => documents.recent(),

    'layout:get': async () => ({ layout: await layout.read() }),

    'layout:set': async (request) => {
      await layout.write(request.layout);
      return {};
    },

    'credentials:set': async ({ account, secret }) => {
      await credentials.set(account, secret);
      return { stored: true };
    },

    'credentials:get': async ({ account }) => ({ secret: await credentials.get(account) }),

    'credentials:delete': async ({ account }) => ({ deleted: await credentials.delete(account) }),

    'export:start': ({ documentId, brief, directory, outputs, formats }) => {
      // The text is the request's and the folder is main's, which is `brief:preview`'s
      // split exactly: the editor's buffer is the only place an unsaved brief exists, and
      // the path is the only thing main keeps about a tab.
      const assetBase = documents.folderOf(documentId);
      return exports.start({
        brief,
        directory,
        // A tab that was never saved has no name to render under. `untitled` rather than a
        // blank, because the label reaches `result.json` and a run filed under '' is a run
        // nobody can find.
        label: documents.nameOf(documentId) ?? 'untitled',
        // Rebuilt field by field rather than spread, because `exactOptionalPropertyTypes`
        // distinguishes an absent key from an undefined one and Zod's `.optional()` gives
        // the second. `OutputRequest` wants the first.
        outputs: outputs.map((output) => ({
          kind: output.kind,
          ...(output.quality === undefined ? {} : { quality: output.quality }),
          ...(output.scale === undefined ? {} : { scale: output.scale }),
        })),
        ...(assetBase === undefined ? {} : { assetBase }),
        ...(formats === undefined ? {} : { formats: [...formats] }),
      });
    },

    'export:progress': ({ exportId }) => {
      const progress = exports.progress(exportId);
      if (progress === undefined) return Promise.resolve({});
      return Promise.resolve({
        progress: {
          status: progress.status,
          total: progress.total,
          done: progress.done,
          failed: progress.failed,
          directory: progress.directory,
          diagnostics: progress.diagnostics.map((item) => ({
            severity: item.severity,
            code: item.code,
            message: item.message,
            ...(item.range === undefined ? {} : { range: item.range }),
          })),
          ...(progress.failure === undefined ? {} : { failure: progress.failure }),
        },
      });
    },

    'export:cancel': ({ exportId }) => {
      exports.cancel(exportId);
      return Promise.resolve({});
    },

    'export:reveal': async ({ directory }) => {
      await folders.reveal(directory);
      return {};
    },

    'export:choose-directory': async () => {
      const directory = await folders.choose();
      return directory === undefined ? {} : { directory };
    },

    'log:write': ({ level, message, detail }) => {
      log[level](message, detail);
      return Promise.resolve({});
    },

    'log:reveal': async () => {
      await folders.reveal(log.directory);
      return {};
    },

    'app:locale': ({ locale }) => {
      menu.setLocale(locale);
      return Promise.resolve({});
    },
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
 * Puts a message on the wire in the other direction (ADR 0029).
 *
 * Validated before it is sent, which is the mirror of `guard`'s reason: main is the side that
 * can refuse a bad push *before* the process boundary, and a payload the preload rejects
 * would otherwise be a listener that silently never fires.
 *
 * `send` and not `invoke`: a push carries no reply. What the renderer has to say about this
 * one comes back on `app:exit-answer`, an ordinary channel in the table above.
 */
export function sendIpcEvent<Name extends IpcEventName>(
  webContents: WebContents,
  name: Name,
  payload: IpcEventPayload<Name>,
): void {
  webContents.send(name, parseIpcEvent(name, payload));
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
