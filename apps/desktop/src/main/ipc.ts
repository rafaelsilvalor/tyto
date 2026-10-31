// `import type` and not an inline `{ type IpcMain }`: under `verbatimModuleSyntax` the
// inline form still emits `import {} from 'electron'`, which outside a running Electron
// resolves to a path string and would make this module unloadable in a test.
import { basename } from 'node:path';

import type { IpcMain, WebContents } from 'electron';
import type { Diagnostics } from '@tyto/core';
import type { SettingOption, SettingOutline } from '@tyto/plugin-api';

import {
  type IpcChannelName,
  type IpcEventName,
  type IpcEventPayload,
  type IpcRequest,
  type IpcResponse,
  type MenuModel,
  type MenuMove,
  IPC_CHANNEL_NAMES,
  parseIpc,
  parseIpcEvent,
} from '../../shared/ipc.js';
import { TAB_EXTENSIONS, isTextFile } from '../../shared/file-icons.js';
import { type StatusBarColors } from '../../shared/status-bar-colors.js';
import { type StatusBarItemId } from '../../shared/status-bar-items.js';
import { type VimModeStyle } from '../../shared/vim-mode-style.js';
import { type VimPlugins } from '../../shared/vim-plugins.js';
import { type BriefColumnLook } from '../../shared/brief-columns.js';
import { type LineNumbersLook } from '../../shared/line-numbers.js';
import { type CommandsOrder } from '../../shared/command-runs.js';
import { type Typography, type ZoomStep } from '../../shared/typography.js';
import { type CliRunner } from './cli-runner.js';
import { type Terminals } from './terminal.js';
import { type Credentials } from './credentials.js';
import { credentialAccount } from './installed-plugins.js';
import { declaredCredentialKeys } from './plugin-list.js';
import { type DeliveryService } from './delivery.js';
import { type DesktopLog } from './log.js';
import { type DocumentService } from './documents.js';
import { type ExplorerService } from './explorer.js';
import { type ExportService } from './export.js';
import { type DesktopGallery } from './gallery.js';
import { type LayoutStore } from './layout-store.js';
import { type SessionService, type TemplateFolder } from './session.js';
import { type PanelService } from './panels.js';
import { type PreviewService } from './preview.js';
import { type QueueService, type QueueView } from './queue.js';
import { type RecipeRunner } from './recipe-runner.js';
import { recipeAnswerToWire } from './recipe-wire.js';
import { type TemplateDiagnostic, type TemplateEditorService } from './template-editor.js';
import { type TemplateCatalogue } from './templates.js';
import { type AppliedThemes, type ThemeService, themeVariant } from './themes.js';
import { type UpdateService } from './updates.js';

/**
 * What the window asks of the themes (TYTO-208): the service's reading half, and `choose`,
 * which `index.ts` composes with the settings store that writes the choice.
 */
export interface WindowThemes extends Pick<ThemeService, 'list' | 'current' | 'preview'> {
  choose(id: string): Promise<{ readonly applied: AppliedThemes; readonly saved: boolean }>;
  /** The `iconStrokeWidth` setting in force (TYTO-288), sent with every theme answer. */
  iconStrokeWidth(): number;
  /** The `statusBarItems` setting in force (TYTO-301), sent with every theme answer too. */
  statusBarItems(): readonly StatusBarItemId[];
  /** The `statusBarColors` setting in force (TYTO-301), on the same answer. */
  statusBarColors(): StatusBarColors;
  /** The `vimMode` setting in force (TYTO-333), on the same answer. */
  vimMode(): boolean;
  /** The `vimPlugins` setting in force (TYTO-418), on the same answer. */
  vimPlugins(): VimPlugins;
  /** The `vimModeStyle` setting in force (TYTO-301), on the same answer. */
  vimModeStyle(): VimModeStyle;
  /** The `indentGuides` setting in force (TYTO-293), on the same answer. */
  indentGuides(): boolean;
  /** The `stickyScroll` setting in force (TYTO-295), on the same answer. */
  stickyScroll(): boolean;
  /** The `tabSize` setting in force (TYTO-297), on the same answer. */
  tabSize(): number;
  /** The `formatBriefOnSave` setting in force (TYTO-297), on the same answer. */
  formatBriefOnSave(): boolean;
  /** The `briefColumns` setting in force (TYTO-298), on the same answer. */
  briefColumns(): BriefColumnLook;
  /** The `lineNumbers` setting in force (TYTO-415), on the same answer. */
  lineNumbers(): LineNumbersLook;
  /** The command panel's two settings in force (TYTO-496), on the same answer. */
  commandsOrder(): CommandsOrder;
  commandsFoldOlderRuns(): boolean;
  /** The faces and sizes in force (TYTO-272), on the same answer. */
  typography(): Typography;
}

/**
 * The applied themes as the window takes them. Each diagnostic loses its range, which is an
 * offset into the theme's file: the problems panel would count it as lines of the brief.
 */
function appliedForWindow(
  applied: AppliedThemes,
  themes: Pick<
    WindowThemes,
    | 'iconStrokeWidth'
    | 'statusBarItems'
    | 'statusBarColors'
    | 'vimMode'
    | 'vimPlugins'
    | 'vimModeStyle'
    | 'indentGuides'
    | 'stickyScroll'
    | 'tabSize'
    | 'formatBriefOnSave'
    | 'briefColumns'
    | 'lineNumbers'
    | 'commandsOrder'
    | 'commandsFoldOlderRuns'
    | 'typography'
  >,
): IpcResponse<'theme:current'> {
  const { light, dark } = applied;
  return {
    mode: applied.mode,
    iconStrokeWidth: themes.iconStrokeWidth(),
    statusBarItems: [...themes.statusBarItems()],
    statusBarColors: { ...themes.statusBarColors() },
    vimMode: themes.vimMode(),
    vimPlugins: { ...themes.vimPlugins() },
    vimModeStyle: themes.vimModeStyle(),
    indentGuides: themes.indentGuides(),
    stickyScroll: themes.stickyScroll(),
    tabSize: themes.tabSize(),
    formatBriefOnSave: themes.formatBriefOnSave(),
    briefColumns: themes.briefColumns(),
    lineNumbers: themes.lineNumbers(),
    commandsOrder: themes.commandsOrder(),
    commandsFoldOlderRuns: themes.commandsFoldOlderRuns(),
    typography: { ...themes.typography() },
    light: { id: light.id, colors: light.colors },
    dark: { id: dark.id, colors: dark.colors },
    diagnostics: [...light.diagnostics, ...dark.diagnostics]
      .slice(0, 200)
      .map(({ severity, code, message }) => ({ severity, code, message })),
  };
}

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
  /** The tabs, kept for the next launch and decided against the disk then (TYTO-113). */
  readonly session: SessionService;
  /**
   * A yes-or-no in front of the window (E9.11), injected for the reason the dialogs are.
   *
   * Every string in it is the renderer's, already translated. Main owns the OS dialog and
   * nothing else about the question.
   */
  readonly confirm: (question: IpcRequest<'dialog:confirm'>) => Promise<boolean>;
  /**
   * The three-way question on the way out (TYTO-153), injected for the reason `confirm` is.
   *
   * It answers with the meaning and never with a button index. The order the buttons are
   * drawn in is main's — `src/main/index.ts` builds it — so reading an index back is main's
   * too, and what crosses this interface is what the person chose rather than where they
   * clicked.
   */
  readonly askToSave: (
    question: IpcRequest<'dialog:save-changes'>,
  ) => Promise<IpcResponse<'dialog:save-changes'>['answer']>;
  /**
   * The two return legs of the one question main asks (TYTO-123, ADR 0029; TYTO-147, ADR 0031).
   *
   * Here rather than in `quit.ts` for the reason everything else in this interface is here:
   * the handler table is the contract's half, and what it is wired to is the composition
   * root's business. `windowGone` is not in it, because nothing on this table can carry it —
   * it comes from Electron's own events and stays in the composition root.
   */
  readonly exit: {
    readonly acknowledge: (askId: number) => void;
    readonly answer: (askId: number, allow: boolean) => void;
    readonly listening: () => void;
  };
  /** Brief text to files on disk (E9.4). Injected for the reason `preview` is. */
  readonly exports: ExportService;
  /** A newer version: what the notice says, and what clicking it does (TYTO-131). */
  readonly updates: Pick<UpdateService, 'status' | 'act'>;
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
   * The workspace folder (TYTO-278, ADR 0113), wrapped for `project`'s reason: opening one is a
   * native dialog, a trust lookup and a read, all the composition root's. Never handed a path.
   */
  readonly workspace: {
    state: () => IpcResponse<'workspace:folder'>;
    setFolder: (choose: boolean) => Promise<IpcResponse<'workspace:folder'>>;
    setTrust: (
      trusted: boolean,
      source: IpcRequest<'workspace:trust'>['source'],
    ) => Promise<IpcResponse<'workspace:trust'>>;
    /** The folders opened before, by id (TYTO-487). */
    recent: () => Promise<IpcResponse<'workspace:recent'>>;
    /** Opens one of them by the id `recent` minted; anything else changes nothing. */
    openRecent: (id: string) => Promise<IpcResponse<'workspace:folder'>>;
  };
  /**
   * The plugin files' sync (TYTO-433, ADR 0151): the composition root knows the open folder,
   * its trust and the plugin set the copies run in, so the handler only says whether refs move.
   */
  readonly pluginFiles: { sync: (update: boolean) => Promise<void> };
  /**
   * The gallery (TYTO-504, ADR 0162): `@tyto/io`'s install and update, the setting's index, and
   * the sync above afterwards. The handlers pass an entry's id and nothing else.
   */
  readonly gallery: DesktopGallery;
  /**
   * The open workspace folder's files (TYTO-279, ADR 0115): listed by id, and a brief's path
   * found by id, only inside the folder main has open.
   */
  readonly explorer: Pick<
    ExplorerService,
    'list' | 'filePath' | 'image' | 'create' | 'rename' | 'delete' | 'pathOf' | 'idsTo'
  >;
  /** A new delivery in the open folder (TYTO-489, ADR 0157): planned and written by main. */
  readonly delivery: DeliveryService;
  /** `tyto` commands run in main for the window (TYTO-495, ADR 0159). */
  readonly cli: Pick<CliRunner, 'start' | 'cancel' | 'commands' | 'diagnosticPath'>;
  /** The terminals, which main owns and the window only draws and types into (ADR 0164). */
  readonly terminals: Pick<Terminals, 'open' | 'input' | 'resize' | 'kill' | 'list'>;
  /**
   * A native context menu of the window's items at a point, settling with the id picked or
   * `null` (TYTO-352, ADR 0121). A function for the reason `confirm` is one: `Menu.popup` is
   * the browser process's.
   */
  readonly contextMenu: (request: IpcRequest<'menu:context'>) => Promise<string | null>;
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
    /** Greys these File menu items, and only these, in every menu built from now on (TYTO-283). */
    setDisabled: (ids: readonly string[]) => void;
    /** The installed menu, projected for the drawn row (TYTO-244, `menu-model.ts`). */
    model: () => MenuModel[];
    /**
     * Opens the native list of the top-level menu `id` at a point in the page, and settles
     * when it closes; `opened: false` for an id the installed menu does not have (TYTO-244),
     * and `move` when Left or Right closed it on Windows (TYTO-263, `menu-arrows.ts`).
     */
    popup: (
      id: string,
      at: { x: number; y: number },
    ) => Promise<{ opened: boolean; move?: MenuMove }>;
  };
  /**
   * The template mode (TYTO-44), and the two pickers it needs. Wrapped like `folders`: a
   * picker is an Electron dialog, and the service below it names none.
   */
  readonly templateEditor: TemplateEditorService;
  /**
   * The folder the template mode has open, filed here so the session can keep it without the
   * window naming it (TYTO-266). Shared with `createSessionService`.
   */
  readonly templateFolder: TemplateFolder;
  /**
   * The local queue panel (TYTO-45). `chooseFolder` is the native picker, wrapped by the
   * composition root like every other dialog here; `remember` writes the choice to
   * `settings.json`.
   */
  readonly queue: {
    readonly service: QueueService;
    chooseFolder: () => Promise<string | undefined>;
    remember: (changes: {
      queueFolder?: string | null;
      queueAutoRun?: boolean;
      queueKinds?: Readonly<Record<string, readonly string[]>>;
    }) => Promise<unknown>;
  };
  /** The settings tab (TYTO-206): the one file it opens, its validation, its closing. */
  readonly settings: {
    open: (documentId: string) => Promise<IpcResponse<'settings:open'>>;
    /** Answered once the installed plugins have started, so their keys are known (TYTO-254). */
    validate: (request: IpcRequest<'settings:validate'>) => Promise<Diagnostics>;
    closed: (documentId: string) => Promise<boolean>;
    /** What every declared setting is, for the tab's suggestions and hover (TYTO-304). */
    outline: () => Promise<readonly SettingOutline[]>;
  };
  /**
   * The keybindings tab (TYTO-207): the one file it opens, and its text for the window to
   * read. No validation here — the window checks it against its own command registry.
   */
  readonly keybindings: {
    open: (documentId: string) => Promise<IpcResponse<'keybindings:open'>>;
    read: () => Promise<string>;
  };
  /** The snippets tab (TYTO-277): `keybindings`'s shape, and checked in the window too. */
  readonly snippets: {
    open: (documentId: string) => Promise<IpcResponse<'snippets:open'>>;
    read: () => Promise<string>;
  };
  /** The plugins screen (TYTO-47): built-ins and installed plugins, read and never run. */
  readonly plugins: {
    readonly folder: string;
    list: () => Promise<readonly IpcResponse<'plugins:list'>['plugins'][number][]>;
  };
  /** The installed plugins' panels and their bridge (ADR 0045). */
  readonly panels: PanelService;
  /** The installed plugins' keymaps, once they have started (TYTO-207). */
  keymaps(): Promise<IpcResponse<'plugins:keymaps'>['keymaps']>;
  /** The vim contributions, the built-ins' first, once the plugins have started (TYTO-418). */
  vim(): Promise<IpcResponse<'plugins:vim'>['contributions']>;
  /** The colours the window applies in each system mode, and the theme picker (TYTO-208). */
  readonly themes: WindowThemes;
  /**
   * Steps the `zoom` setting, applies it and writes it (TYTO-272): the zoom in effect after,
   * and whether `settings.json` took it.
   */
  readonly zoom: (step: ZoomStep) => Promise<{ readonly zoom: number; readonly saved: boolean }>;
  /**
   * Writes the `vimMode` setting (TYTO-333): the setting in force after, and whether
   * `settings.json` took it.
   */
  readonly vimMode: (
    on: boolean,
  ) => Promise<{ readonly vimMode: boolean; readonly saved: boolean }>;
  /**
   * Opens the user manual in the system browser, in the window's language (TYTO-318). The
   * composition root holds the locale and `shell.openExternal`; the URL is one of the two
   * literals in `documentation.ts`, never something the window sent.
   */
  readonly openDocumentation: () => void;
  readonly templateDialogs: {
    /** A template folder to edit, or nothing when the picker is dismissed. */
    chooseTemplate: () => Promise<string | undefined>;
    /** Where a new template goes when no template folder is chosen. */
    chooseParent: () => Promise<string | undefined>;
  };
  /**
   * The recipe notebook's runner (TYTO-377, ADR 0148): a document's cells, kept in main and
   * forgotten when its tab closes.
   */
  readonly recipes: RecipeRunner;
}

/** A setting's outline as the contract writes it: the same fields, in arrays of its own. */
function wireOutline(setting: SettingOutline): IpcResponse<'settings:outline'>['settings'][number] {
  const copy = (options: readonly SettingOption[]) => options.map((option) => ({ ...option }));
  return {
    key: setting.key,
    plugin: setting.plugin,
    description: setting.description,
    type: setting.type,
    default: setting.default,
    options: copy(setting.options),
    ...(setting.entries === undefined
      ? {}
      : { entries: { options: copy(setting.entries.options) } }),
    ...(setting.members === undefined
      ? {}
      : { members: { options: copy(setting.members.options) } }),
  };
}

/** What crosses the bridge of a diagnostic: the fields the contract names, and no others. */
const wireDiagnostic = (item: TemplateDiagnostic) => ({
  severity: item.severity,
  code: item.code,
  message: item.message,
  file: item.file,
  ...(item.range === undefined ? {} : { range: item.range }),
});

/**
 * The keychain account for a plugin's credential, or a refusal when no plugin the screen lists
 * declares `credentials:<key>` (TYTO-187).
 *
 * Read from the same list the screen shows, on every ask, so what the renderer may write or
 * forget is exactly the keys it can see — and a plugin installed in a terminal a moment ago
 * is already there. The refusal names the pair and never a secret.
 */
async function declaredAccount(
  plugins: IpcDependencies['plugins'],
  plugin: string,
  key: string,
): Promise<string> {
  const row = (await plugins.list()).find((candidate) => candidate.name === plugin);
  if (row === undefined || !declaredCredentialKeys(row.permissions).includes(key)) {
    throw new Error(
      `No installed plugin '${plugin}' declares credentials:${key}, so nothing was stored or forgotten.`,
    );
  }
  return credentialAccount(plugin, key);
}

/** One handler per channel, typed against the contract in both directions. */
type Handlers = {
  readonly [Name in IpcChannelName]: (request: IpcRequest<Name>) => Promise<IpcResponse<Name>>;
};

export function createHandlers(dependencies: IpcDependencies): Handlers {
  const {
    askToSave,
    cli,
    terminals,
    confirm,
    contextMenu,
    credentials,
    delivery,
    documents,
    exit,
    exports,
    folders,
    info,
    keybindings,
    snippets,
    layout,
    log,
    menu,
    plugins,
    preview,
    project,
    workspace,
    pluginFiles,
    gallery,
    explorer,
    queue,
    recipes,
    session,
    settings,
    templateDialogs,
    templateEditor,
    templateFolder,
    templates,
    updates,
  } = dependencies;

  return {
    'app:info': () => Promise.resolve(info()),

    'brief:preview': async ({ requestId, documentId, brief, fetch }) => {
      // The folder is looked up from the id **this request carries**, not from whichever
      // tab is in front. A preview is debounced and answers out of order by design, so the
      // subject has to travel with the question (`shared/ipc.ts`).
      const result = await preview.preview(
        brief,
        documents.folderOf(documentId),
        fetch === true ? 'save' : 'typing',
      );
      // The id goes back untouched. Main does not know which answer the renderer still
      // wants — only the renderer knows what it has asked since — so the whole of main's
      // part in discarding a stale result is not losing the number.
      return {
        requestId,
        frames: [...result.frames],
        artworks: [...result.artworks],
        diagnostics: [...result.diagnostics],
        completion: {
          ...(result.completion.manifest === undefined
            ? {}
            : { manifest: result.completion.manifest }),
          directives: [...result.completion.directives],
        },
      };
    },

    // No `Promise.resolve` any more: `list()` is async since TYTO-122, because a folder change
    // means new `preview.png` files to read.
    'templates:list': () => templates.list(),

    'templates:folder': () => Promise.resolve(project.folder()),

    'templates:set-folder': ({ choose }) => project.setFolder(choose),

    'workspace:folder': () => Promise.resolve(workspace.state()),

    'recipe:run': async ({ requestId, documentId, text, from, explicit, saved, fresh }) => {
      // The file is the one main holds for this tab, never a path the window sent (ADR 0086).
      // The id goes back untouched, as `brief:preview`'s does: the renderer drops a stale one.
      const answer = await recipes.run({
        documentId,
        text,
        path: documents.pathOf(documentId),
        from,
        explicit,
        saved,
        fresh,
      });
      return { requestId, ...recipeAnswerToWire(answer) };
    },

    'recipe:verbs': () => Promise.resolve({ verbs: [...recipes.verbs()] }),

    // TYTO-274, ADR 0125: a label inside the open folder is relative to it, so every open tab is
    // labelled again when the folder changes, and the window applies it as it applies a rename.
    'workspace:set-folder': async ({ choose }) => ({
      ...(await workspace.setFolder(choose)),
      relabelled: documents.relabel(),
    }),

    'workspace:trust': ({ trusted, source }) => workspace.setTrust(trusted, source),

    'workspace:recent': () => workspace.recent(),

    // TYTO-487: the same relabelling as `workspace:set-folder`, for the same reason.
    'workspace:open-recent': async ({ id }) => ({
      ...(await workspace.openRecent(id)),
      relabelled: documents.relabel(),
    }),

    'plugin-files:sync': async ({ update }) => {
      await pluginFiles.sync(update);
      return {};
    },

    'gallery:list': () => gallery.list(),
    'gallery:install': ({ id }) => gallery.install(id),
    'gallery:update': ({ id }) => gallery.update(id),

    'explorer:list': ({ entryId }) => explorer.list(entryId),

    // TYTO-247, ADR 0132: a `.txt` or `.md` opens in a tab as a brief does, its format named by
    // the documents service from the extension; anything else opens nothing.
    'explorer:open': async ({ documentId, entryId }) => {
      const path = await explorer.filePath(entryId, TAB_EXTENSIONS);
      if (path === undefined) return { document: null, documentId: null };
      return documents.openPath(documentId, path);
    },

    // TYTO-366, ADR 0124: an image for the preview, by id, as bytes main checked.
    // TYTO-274: the image's tab says where it is, as a brief's does (ADR 0086, ADR 0125).
    'explorer:image': async ({ entryId, have }) => {
      const answer = await explorer.image(entryId, have);
      const path = explorer.pathOf(entryId);
      if (!('ok' in answer) || !answer.ok || path === undefined) return answer;
      return { ...answer, pathLabel: documents.labelOf(path) };
    },

    // TYTO-352, ADR 0121: the explorer writes by id and name; the tabs follow here, in the one
    // place that holds both the explorer and the documents.
    'explorer:create': async ({ documentId, parentId, name, kind }) => {
      const made = await explorer.create(parentId, name, kind);
      if (!made.ok) return made;
      const opened =
        made.entry.kind === 'brief' || (made.entry.kind === 'file' && isTextFile(made.entry.name))
          ? await documents.openPath(documentId, made.path)
          : { document: null, documentId: null };
      return { ok: true, entry: made.entry, ...opened };
    },

    // TYTO-489, ADR 0157 §5: the delivery is made by main, then opens like an explorer entry.
    'delivery:new': async ({ documentId, name, brief }) => {
      const made = await delivery.create(name, brief);
      if (!made.ok) return made;
      const opened = await documents.openPath(documentId, made.brief);
      return { ok: true, ...opened, reveal: [...(explorer.idsTo(made.brief) ?? [])] };
    },

    // TYTO-490, ADR 0157 §6: the folders are main's, from the tab's path and the open layout.
    'delivery:of': ({ documentId }) => {
      const path = documents.pathOf(documentId);
      const found = path === undefined ? undefined : delivery.of(path);
      return Promise.resolve({ name: found?.name ?? null });
    },

    'delivery:export': ({ documentId, brief }) => {
      const path = documents.pathOf(documentId);
      const found = path === undefined ? undefined : delivery.of(path);
      // The button is disabled for such a brief; a key bound to the command still gets here.
      if (path === undefined || found === undefined) {
        return Promise.resolve({ ok: false, ...delivery.notIn(path) });
      }
      const started = exports.start({
        brief,
        directory: found.exports,
        briefDirectory: found.report,
        label: documents.nameOf(documentId) ?? found.name,
        outputs: found.types.map((kind) => ({ kind })),
        ...(found.formats === undefined ? {} : { formats: [...found.formats] }),
        deliveryReport: found.report,
      });
      return started.then(({ exportId }) => ({ ok: true, exportId, directory: found.exports }));
    },

    'explorer:rename': async ({ entryId, name }) => {
      const renamed = await explorer.rename(entryId, name);
      if (!renamed.ok) return renamed;
      return {
        ok: true,
        entry: renamed.entry,
        moved: documents.retargetUnder(renamed.from, renamed.to),
      };
    },

    'explorer:tabs-under': async ({ entryId }) => {
      const path = explorer.pathOf(entryId);
      return { documentIds: path === undefined ? [] : documents.heldUnder(path) };
    },

    'explorer:delete': async ({ entryId }) => {
      const deleted = await explorer.delete(entryId);
      if (!deleted.ok) return deleted;
      return { ok: true, released: documents.releaseUnder(deleted.path) };
    },

    'file:open': ({ documentId }) => documents.open(documentId),

    'file:reopen': ({ documentId, path }) => documents.reopen(documentId, path),

    'file:save': ({ documentId, text, saveAs, format }) =>
      documents.save(documentId, text, saveAs, format),

    'file:close': async ({ documentId }) => {
      documents.close(documentId);
      // A recipe's cells die with its tab (ADR 0148): nothing of them outlives the document.
      recipes.close(documentId);
      // Awaited: a settings tab closed unsaved may still owe the file a screen's change.
      await settings.closed(documentId);
      return {};
    },

    'dialog:confirm': async (question) => ({ confirmed: await confirm(question) }),

    'dialog:save-changes': async (question) => ({ answer: await askToSave(question) }),

    'app:exit-ack': ({ askId }) => {
      exit.acknowledge(askId);
      return Promise.resolve({});
    },

    'app:exit-answer': ({ askId, allow }) => {
      exit.answer(askId, allow);
      return Promise.resolve({});
    },

    'app:exit-listening': () => {
      exit.listening();
      return Promise.resolve({});
    },

    'update:status': () => Promise.resolve(updates.status()),

    'update:act': () => {
      updates.act();
      return Promise.resolve({});
    },

    'files:recent': () => documents.recent(),

    'layout:get': async () => ({ layout: await layout.read() }),

    'layout:set': async (request) => {
      await layout.write(request.layout);
      return {};
    },

    'session:write': (request) => session.write(request),

    'session:read': () => session.read(),

    'credentials:set': async ({ plugin, key, secret }) => {
      await credentials.set(await declaredAccount(plugins, plugin, key), secret);
      return { stored: true };
    },

    'credentials:delete': async ({ plugin, key }) => ({
      deleted: await credentials.delete(await declaredAccount(plugins, plugin, key)),
    }),

    'export:start': ({ documentId, brief, directory, outputs, formats }) => {
      // The text is the request's and the folder is main's, which is `brief:preview`'s
      // split exactly: the editor's buffer is the only place an unsaved brief exists, and
      // the path is the only thing main keeps about a tab.
      const briefDirectory = documents.folderOf(documentId);
      return exports.start({
        brief,
        directory,
        // A tab that was never saved has no name to render under. `untitled` rather than a
        // blank, because the label names the run in its errors and a run filed under '' is a
        // run nobody can find.
        label: documents.nameOf(documentId) ?? 'untitled',
        // Rebuilt field by field rather than spread, because `exactOptionalPropertyTypes`
        // distinguishes an absent key from an undefined one and Zod's `.optional()` gives
        // the second. `OutputRequest` wants the first.
        outputs: outputs.map((output) => ({
          kind: output.kind,
          ...(output.quality === undefined ? {} : { quality: output.quality }),
          ...(output.scale === undefined ? {} : { scale: output.scale }),
        })),
        ...(briefDirectory === undefined ? {} : { briefDirectory }),
        ...(formats === undefined ? {} : { formats: [...formats] }),
        // The export box and the presets write only the artwork into the folder the person
        // picked: no result.json, no brief, no assets/ (ADR 0157, TYTO-490). The queue does
        // not come here, and keeps its report.
        artworkOnly: true,
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

    'cli:run': ({ argv }) => Promise.resolve(cli.start(argv)),

    'cli:cancel': ({ runId }) => {
      cli.cancel(runId);
      return Promise.resolve({});
    },

    'cli:commands': () => Promise.resolve({ tree: cli.commands() }),

    // ADR 0159 decision 7: a command's Problems row opens its file, which main kept by run and
    // row. Only a file a tab opens, the explorer's own rule (`TAB_EXTENSIONS`).
    'cli:open-diagnostic': async ({ documentId, runId, index }) => {
      const path = cli.diagnosticPath(runId, index);
      const name = path?.toLowerCase();
      if (path === undefined || !TAB_EXTENSIONS.some((extension) => name?.endsWith(extension))) {
        return { document: null, documentId: null };
      }
      return documents.openPath(documentId, path);
    },

    'terminal:open': (size) => Promise.resolve(terminals.open(size)),

    'terminal:input': ({ terminalId, data }) => {
      terminals.input(terminalId, data);
      return Promise.resolve({});
    },

    'terminal:resize': ({ terminalId, cols, rows }) => {
      terminals.resize(terminalId, cols, rows);
      return Promise.resolve({});
    },

    'terminal:kill': ({ terminalId }) => {
      terminals.kill(terminalId);
      return Promise.resolve({});
    },

    'terminal:list': () => Promise.resolve({ terminals: [...terminals.list()] }),

    'export:cancel': ({ exportId }) => {
      exports.cancel(exportId);
      return Promise.resolve({});
    },

    'export:kinds': async () => ({ kinds: [...(await exports.kinds())] }),

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

    'plugins:list': async () => ({ folder: plugins.folder, plugins: [...(await plugins.list())] }),

    'plugins:panels': async () => ({ panels: [...(await dependencies.panels.list())] }),
    'plugins:keymaps': async () => ({ keymaps: await dependencies.keymaps() }),
    'plugins:vim': async () => ({ contributions: await dependencies.vim() }),

    'theme:current': async () =>
      appliedForWindow(await dependencies.themes.current(), dependencies.themes),
    'theme:list': async () => ({
      themes: (await dependencies.themes.list()).map((theme) => {
        const variant = themeVariant(theme);
        return {
          id: theme.id,
          label: theme.label,
          kind: theme.kind,
          ...(variant === undefined ? {} : { variant }),
        };
      }),
    }),
    'theme:preview': async ({ id }) =>
      appliedForWindow(await dependencies.themes.preview(id ?? undefined), dependencies.themes),
    'theme:choose': async ({ id }) => {
      const { applied, saved } = await dependencies.themes.choose(id);
      return { ...appliedForWindow(applied, dependencies.themes), saved };
    },

    'panel:request': ({ panelId, capability, args }) =>
      dependencies.panels.request(panelId, capability, args),

    'queue:list': async () => wireQueueView(await queue.service.view()),

    'queue:set-folder': async ({ choose }) => {
      let chosen: string | null = null;
      if (choose) {
        const picked = await queue.chooseFolder();
        // A dismissed picker is not a clear, which is `templates:set-folder`'s rule.
        if (picked === undefined) return wireQueueView(await queue.service.view());
        chosen = picked;
      }
      await queue.service.setFolder(chosen);
      await queue.remember({ queueFolder: chosen });
      return wireQueueView(await queue.service.view());
    },

    'queue:set-auto-run': async ({ on }) => {
      queue.service.setAutoRun(on);
      await queue.remember({ queueAutoRun: on });
      return wireQueueView(await queue.service.view());
    },

    'queue:set-kinds': async ({ kinds }) => {
      // The whole record, because `remember` patches top-level keys and a folder's choice is
      // one entry of one key: writing only this folder's would forget every other folder's.
      await queue.remember({ queueKinds: queue.service.setKinds(kinds) });
      return wireQueueView(await queue.service.view());
    },

    'queue:run': ({ taskId }) => {
      // Not awaited: a render is seconds and the answer is a push. `run` never rejects for a
      // bad brief; anything else it could reject with is already the task's failure.
      void queue.service.run(taskId).catch(() => undefined);
      return Promise.resolve({});
    },

    'queue:reveal-output': async ({ taskId }) => {
      const directory = queue.service.outDirectory(taskId);
      if (directory !== undefined) await folders.reveal(directory);
      return {};
    },

    'queue:open-brief': async ({ documentId, taskId }) => {
      const path = queue.service.briefPath(taskId);
      if (path === undefined) return { document: null, documentId: null };
      // Named after the task: every task's brief is `brief.brief`, and two of them open at
      // once would otherwise be two tabs nobody could tell apart.
      return documents.openPath(documentId, path, `${taskId} · ${basename(path)}`);
    },

    'settings:open': ({ documentId }) => settings.open(documentId),

    'keybindings:open': ({ documentId }) => keybindings.open(documentId),

    'keybindings:read': async () => ({ text: await keybindings.read() }),

    'snippets:open': ({ documentId }) => snippets.open(documentId),

    'snippets:read': async () => ({ text: await snippets.read() }),

    'settings:outline': async () => ({ settings: (await settings.outline()).map(wireOutline) }),

    'settings:validate': async (request) => ({
      diagnostics: (await settings.validate(request)).map((item) => ({
        severity: item.severity,
        code: item.code,
        message: item.message,
        ...(item.range === undefined ? {} : { range: item.range }),
        ...(item.hint === undefined ? {} : { hint: item.hint }),
      })),
    }),

    'log:reveal': async () => {
      await folders.reveal(log.directory);
      return {};
    },

    'help:open-documentation': () => {
      dependencies.openDocumentation();
      return Promise.resolve({});
    },

    'app:locale': ({ locale }) => {
      menu.setLocale(locale);
      return Promise.resolve({});
    },

    'window:zoom': async ({ step }) => {
      const { zoom, saved } = await dependencies.zoom(step);
      return { zoom, saved };
    },

    'editor:vim-mode': async ({ on }) => {
      const { vimMode, saved } = await dependencies.vimMode(on);
      return { vimMode, saved };
    },

    'menu:disabled': ({ ids }) => {
      menu.setDisabled(ids);
      return Promise.resolve({});
    },

    'menu:model': () => Promise.resolve({ menus: menu.model() }),

    'menu:popup': ({ id, x, y }) => menu.popup(id, { x, y }),

    'menu:context': async (request) => {
      const chosen = await contextMenu(request);
      // Only an item the window offered, and offered enabled, is an answer.
      const offered = request.items.some((item) => item.id === chosen && item.enabled);
      return { chosen: offered ? chosen : null };
    },

    'template:open': async ({ directory }) => {
      const chosen = directory ?? (await templateDialogs.chooseTemplate());
      if (chosen === undefined) return { template: null };
      const opened = await templateEditor.open(chosen);
      // What the mode now shows: its buffers only for a markup folder, nothing for the rest.
      templateFolder.set(opened.kind === 'markup' ? opened.directory : undefined);
      return {
        template:
          opened.kind === 'markup'
            ? { ...opened, examples: opened.examples.map((example) => ({ ...example })) }
            : opened,
      };
    },

    'template:preview': async ({ requestId, directory, manifest, markup, brief, briefPath }) => {
      const result = await templateEditor.preview({
        directory,
        manifest,
        markup,
        brief,
        ...(briefPath === undefined ? {} : { briefPath }),
      });
      return {
        requestId,
        frames: [...result.frames],
        diagnostics: result.diagnostics.map(wireDiagnostic),
      };
    },

    'template:save': async ({ directory, manifest, markup }) => {
      const result = await templateEditor.save({ directory, manifest, markup });
      return {
        saved: result.saved,
        registered: result.registered,
        ...(result.name === undefined ? {} : { name: result.name }),
        diagnostics: result.diagnostics.map(wireDiagnostic),
      };
    },

    'template:new': async ({ name }) => {
      // Into the template folder in force, so the new template is one briefs can name at once;
      // with none chosen, wherever the person says.
      const parent = project.folder().folder ?? (await templateDialogs.chooseParent());
      if (parent === undefined) return { directory: null };
      const result = await templateEditor.scaffold(parent, name);
      return result.ok
        ? { directory: result.directory }
        : { directory: null, problem: result.problem, detail: result.detail };
    },
  };
}

/**
 * The queue as the wire carries it: diagnostics flattened the way `export:progress` flattens
 * them, because `exactOptionalPropertyTypes` tells an absent `range` from an undefined one.
 */
function wireQueueView(view: QueueView): IpcResponse<'queue:list'> {
  return {
    folder: view.folder,
    inbox: view.inbox,
    autoRun: view.autoRun,
    kinds: [...view.kinds],
    tasks: view.tasks.slice(0, 500).map((task) => ({
      id: task.id,
      status: task.status,
      diagnostics: task.diagnostics.map((item) => ({
        severity: item.severity,
        code: item.code,
        message: item.message,
        ...(item.range === undefined ? {} : { range: item.range }),
        ...(item.hint === undefined ? {} : { hint: item.hint }),
      })),
      ...(task.failure === undefined ? {} : { failure: task.failure }),
      hasOutput: task.hasOutput,
    })),
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
