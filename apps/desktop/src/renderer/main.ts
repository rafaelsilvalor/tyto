import {
  type BriefBlock,
  type BriefSnippet,
  type CommandRegistry,
  EDITOR_CONTEXTS,
  type EditorHandle,
  type EditorPane,
  type KeybindingContext,
  type KeybindingEntry,
  type KeybindingLayer,
  type KeybindingTable,
  COMMAND_BAR_TOGGLE,
  type VimStatus,
  DEFAULT_TAB_SIZE,
  blockAt,
  blocksOf,
  breadcrumbOf,
  directiveLabel,
  formatBriefInView,
  previewBlock,
  briefCompletion,
  briefLint,
  briefSnippets,
  concreteKey,
  createEditor,
  cursorOf,
  insertBriefSkeleton,
  isFollower,
  jsonAssist,
  keyOfStroke,
  openSlashMenu,
  type SlashSource,
  slashCompletion,
  snippetsSlashSource,
  tabThroughCompletions,
  resolveKeybindings,
  selectionOf,
  shownBindingsOf,
  windowBindingsOf,
  withDiagnostics,
  withSelection,
} from '@tyto/editor';

import {
  type IpcEventPayload,
  type IpcResponse,
  type TytoBridge,
  type UpdateStatus,
} from '../../shared/ipc.js';
import type { SessionGroupNode } from '../../shared/session-groups.js';
import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  isLocale,
  translate,
} from '../../shared/i18n/index.js';
import { followScheme } from './color-scheme.js';
import { applyTheme, withThemeRows } from './theme.js';
import { canvasMeasure, missingFamilyRows, withFontRows } from './typography.js';
import { DEFAULT_TYPOGRAPHY, type Typography } from '../../shared/typography.js';
import { offeredFormats, templateOf } from './frontmatter.js';
import {
  type AppFileAssists,
  assistOf,
  commandOffered,
  languageOf,
  type SlashTemplateNote,
  type TabKind,
  slashTemplateChoiceFor,
  slashTemplateNote,
} from './editor-chrome.js';
import { readKeybindingsText } from './keybindings-file.js';
import { type KeybindingCommand, keybindingsAssist } from './keybindings-assist.js';
import { type SettingOutline, settingsAssist } from './settings-assist.js';
import { readSnippetsText } from './snippets-file.js';
import {
  type Diagnostic,
  type SourceRange,
  type Template,
  rangeOfArtwork,
  revealRange,
} from './panel.js';
import { type CommandEntry, type CommandBar, COMMAND_BAR_TAG } from './command-bar.js';
import {
  type ExportDialog,
  type ExportProgressView,
  type FormatOption,
  EXPORT_DIALOG_TAG,
} from './export-dialog.js';
import { type PluginsDialog, PLUGINS_DIALOG_TAG } from './plugins-dialog.js';
import { previewAnalysis } from './brief-analysis.js';
import {
  type OfferedPanel,
  PluginPanel,
  announceDocument,
  servePanelBridge,
} from './plugin-panel.js';
import { type QueuePanel, QUEUE_PANEL_TAG } from './queue-panel.js';
import type { RestoredDrafts, TemplateMode } from './template-mode.js';
import { TEMPLATE_MODE_TAG } from './template-mode-tag.js';
import {
  COMMAND_LABELS,
  DOCUMENT_SLOTS,
  PREVIEW_ZOOM_FIT,
  PREVIEW_ZOOM_IN,
  PREVIEW_ZOOM_OUT,
  PREVIEW_OPEN_TO_SIDE,
  PREVIEW_TOGGLE_LOCK,
  FILE_EXPORT,
  PLUGINS_SHOW,
  SETTINGS_OPEN,
  builtInKeybindings,
  builtInTable,
  createDesktopRegistry,
  keymapSetFor,
  pluginKeybindingLayer,
  panelOfToggleCommand,
  pathOfRecentCommand,
  recentCommandId,
  selectDocumentCommandId,
  slotOfSelectCommand,
  togglePanelCommandId,
  withCommandGate,
} from './commands.js';
import { FILE_MENU_COMMANDS, VIEW_MENU_COMMANDS } from '../../shared/commands.js';
import {
  type StatusBar,
  type StatusBarCommands,
  STATUS_BAR_TAG,
  paintVimStyle,
} from './status-bar.js';
import { type StatusBarItemId, STATUS_BAR_ITEM_IDS } from '../../shared/status-bar-items.js';
import { type VimModeStyle } from '../../shared/vim-mode-style.js';
import { type BriefColumnLook } from '../../shared/brief-columns.js';
import {
  type DocumentState,
  type Workspace,
  activeOf,
  addDocument,
  closeDocument,
  contentOf,
  documentOf,
  isBroken,
  isDisposable,
  isStale,
  isUnsaved,
  newDocument,
  rebaseEdit,
  releaseDocument,
  selectDocument,
  updateDocument,
  workspaceOf,
} from './documents.js';
import {
  type ProblemsMark,
  type RowSubjects,
  FILE_NOT_FOUND,
  SESSION_DRAFT_STALE,
  TEMPLATE_FOLDER_EMPTY,
  UNLIT,
  afterRemoval,
  carriedAcrossTemplateRead,
  raised,
  seen,
  withoutRowsAbout,
} from './problems-mark.js';
import { SAVE_FAILED, saveFailureDiagnostic } from './save-failure.js';
import { type EditorGroupElement, arrangeGroups } from './editor-group.js';
import { applyShares, showShares, wireGroupSplitters } from './group-splitter.js';
import { wireTabDrag } from './tab-drag.js';
import type { TabEntry } from './tabs.js';
import {
  type EditorGroup,
  type EditorGroups,
  type EditorTab,
  type GroupNode,
  activateTab,
  activeTabOf,
  closeDocumentTabs,
  closeTab as closeGroupTab,
  focusGroup,
  focusNeighbour,
  focusedDocumentId,
  focusedGroup,
  followBrief,
  followingPreview,
  groupById,
  groupList,
  groupOfTab,
  groupsFromLayout,
  groupsOf,
  isPreview,
  layoutOf,
  moveTabToNextGroup,
  placeTab,
  stepTabInGroup,
  openDocument,
  openPreviewHere,
  openPreviewToSide,
  replaceDocument,
  resizeSplit,
  shownDocumentIds,
  splitGroup,
  toggleLock,
} from './editor-groups.js';
import { type PreviewPane, previewElementsOf } from './preview-pane.js';
import { type ProblemsPanel, PROBLEMS_TAG } from './problems-panel.js';
import { arrange, wireSplitters } from './dock.js';
import './panels.js';
import {
  type Layout,
  DEFAULT_LAYOUT,
  EDITOR_PANEL,
  PLUGIN_PANEL_ELEMENT,
  PROBLEMS_PANEL,
  QUEUE_PANEL,
  dockHasPanels,
  dockIsHidden,
  dockIsShown,
  panelOf,
  withDockToggled,
  withPanelOpen,
  withPanelSize,
  withPluginPanels,
} from '../../shared/layout.js';
import { type SaveOutcome, holdPageClose, listenForExit, resolveExit } from './exit.js';
import { installErrorReporting, reportToLog } from './report-errors.js';
import { searchPhrasesFor } from './search-phrases.js';
import { type SessionGroups, type TemplateSnapshot, sessionOf } from './session.js';
import { paintUpdateNotice } from './update-notice.js';
import { type ShellState, paint, paintTitle } from './shell.js';
import { AltTap, MenuRow, altLettersTaken, isMenuLetterStroke } from './menu-row.js';
import {
  type PreviewElements,
  type PreviewState,
  type RequestGate,
  type Zoom,
  FORMAT_ATTRIBUTE,
  artworksOf,
  createRequestGate,
  errorCount,
  formatsOf,
  keepSelection,
  paintPreview,
  stepZoom,
} from './preview.js';

/**
 * The renderer's entry point: an editor on the left, the frames it produces on the right.
 *
 * Wiring only. Which frame is showing and at what scale is `preview.ts`, what is open is
 * `documents.ts`, every string is the catalogue's, and compiling is main's — what is left
 * here is the order things happen in and the one decision nothing else can make: **when** to
 * ask.
 *
 * E9.11 took the one thing this file used to own outright: the state. It held one `preview`
 * object and one `panel` object as module-level singletons and every painter read them
 * directly. Now there is a {@link Workspace} of several documents and the painters read
 * whichever one is active, which is the whole of what a tab is.
 */

declare global {
  interface Window {
    /**
     * Optional, and that is not defensive typing.
     *
     * The reason used to be a browser tab with no preload in it; ADR 0024 retired that. The
     * bridgeless window is not hypothetical though — it is this file's own first paint,
     * which runs before main has answered anything, and it is every unit test in
     * `src/renderer`, which drives these functions with no preload at all. `wirePreviewControls`
     * takes a `bridgeless` flag for exactly that reason. Typing it as always-present would
     * make the state the window actually starts in a type error.
     */
    readonly tyto?: TytoBridge;
  }
}

/**
 * How long a pause in typing has to be before the brief is compiled.
 *
 * The same 200 ms `@tyto/editor` uses for its own linting, deliberately: two different
 * delays would make the markers and the preview disagree about what "now" is, and the author
 * would watch the frame update for text the editor had not yet accepted. Compiling is
 * milliseconds — the delay is about not doing it mid-word, not about cost.
 */
const PREVIEW_DELAY = 200;

/**
 * The gutter's and the completion list's analysis, answered by the preview (TYTO-49).
 *
 * `brief-analysis.ts` says why there is no second analyzer. The template names come from
 * the picker's list, which is the same registry the preview resolves against.
 */
const analysis = previewAnalysis(
  () => state.templates,
  // Per document since TYTO-286: the pane asking is matched to the document it shows.
  (view) => documentShownBy(view),
);

/** The installed plugins' panels by layout id, once main has said which there are (ADR 0045). */
const offeredPanels = new Map<string, OfferedPanel>();

const state = {
  locale: DEFAULT_LOCALE as Locale,
  version: '—',
  platform: '—',
  templates: [] as readonly string[],
  /** The folder searched before the built-in pack, and how many it brought (TYTO-122). */
  templatesFolder: null as string | null,
  templatesFound: 0,
};

/**
 * A name for a tab, and the key main files that tab's path under (E9.11).
 *
 * A counter and not the file's path, because a document has no path until it is saved and
 * gets a different one when it is saved again. `shared/ipc.ts` has the rest of the argument.
 */
let documentCount = 0;
const nextDocumentId = (): string => {
  documentCount += 1;
  return `document-${String(documentCount)}`;
};

/**
 * What is open, and which one the window is looking at.
 *
 * Starts as one untitled document with no state in it: CodeMirror does not exist yet at
 * module load, and the first thing the editor is created with *is* this document, whose
 * state is adopted the moment there is one ({@link adoptEditorState}). Every later document
 * is born from `editor.blank`.
 */
let workspace: Workspace = workspaceOf(newDocument(nextDocumentId()));

/**
 * Where each open document is shown: the editor groups (TYTO-286, ADR 0083). A tree of splits
 * whose leaves each have a row of tabs and one in front; the window opens on one group holding
 * the one document. `workspace.activeId` is kept equal to the focused group's document by
 * {@link showGroups}, so `documents.ts`'s own operations still read a consistent workspace.
 */
let groups: EditorGroups = groupsOf([workspace.activeId], workspace.activeId);

/**
 * The document every painter below reads: **the focused group's** tab in front (ADR 0083).
 * The status bar, the problems panel, the preview, the command bar and the title follow it.
 */
const active = (): DocumentState =>
  documentOf(workspace, focusedDocumentId(groups) ?? workspace.activeId) ?? activeOf(workspace);

/**
 * The focused group's tab in front when it is a preview (TYTO-287, ADR 0084). {@link active} is
 * then the brief it shows: export, the queue, the problems panel, the title and the status bar
 * all answer about that brief, as they do from the brief's own tab.
 */
function focusedPreview(): EditorTab | undefined {
  const tab = activeTabOf(focusedGroup(groups));
  return tab !== undefined && isPreview(tab) ? tab : undefined;
}

/** What the tab in front holds, for every door that asks whether a command is offered. */
const activeKind = (): TabKind => (focusedPreview() === undefined ? active().kind : 'preview');

/**
 * The brief the following preview shows: the last brief whose own tab was in front of the
 * focused group (TYTO-287). An app file's tab or a preview coming to the front leaves it alone,
 * as VS Code's Markdown preview keeps the last Markdown file. `''` while no brief is open.
 */
let followedBrief = '';

/**
 * What the document in front says, read from the workspace and never from the editor.
 *
 * **The whole of TYTO-115 lands here.** Five call sites used to ask CodeMirror for the text
 * — the template picker twice, the save, the debounced compile and the first compile — and
 * each of them was therefore an answer only the *active* document could give. They all read
 * this now, the workspace is what holds the content, and the editor is the pane it is shown
 * in (D1 of `docs/explorations/2026-09-16-document-buffer-model.md`).
 *
 * Empty before CodeMirror is mounted, which is the one paint between module load and
 * {@link load} — the same window in which the old `editor?.getValue() ?? ''` answered the
 * same empty string.
 *
 * The question itself moved to `documents.ts` in TYTO-112, because the unsaved marker asks
 * it about documents that are **not** in front: this is now that function applied to the
 * active one, and not a second way of reading a document.
 */
const activeText = (): string => contentOf(active());

/** Changes the active document and leaves every other one exactly as it was. */
function updateActive(change: (document: DocumentState) => DocumentState): void {
  workspace = updateDocument(workspace, active().id, change);
}

/**
 * The recent list, as commands that unregister themselves.
 *
 * Held so the next listing can take the last one down. Re-registering an id would replace
 * it, but a file that left the top ten has no id to be replaced by and would sit in the bar
 * forever.
 */
let recentCommands: (() => void)[] = [];

/**
 * Where the panels are, which is the only thing that decides what the window looks like.
 *
 * Starts at the default and is replaced by whatever main remembered, before the first
 * arrange. Every change goes through `shared/layout.ts`'s three pure operations and then
 * through {@link applyLayout}, so "what is on screen" and "what is remembered" cannot be
 * two things that have to be kept in step.
 */
let layout: Layout = DEFAULT_LAYOUT;

const panel = {
  /**
   * Folders that meant to be a template and could not be read as one.
   *
   * Kept apart from a document's diagnostics because they have a different lifetime: these
   * are read once at startup and never change, and a brief's are replaced on every answer.
   * They are shown together, at the top, because to somebody reading the panel they are the
   * same question — why is this not rendering. They belong to the app rather than to a tab,
   * which is why they stayed here when everything else moved into the workspace.
   */
  installation: [] as readonly Diagnostic[],
  templates: [] as readonly Template[],
};

/**
 * The status bar's "new problems" dot (TYTO-143, ADR 0076): lit when the window raises one of
 * its own rows while the problems panel is not on screen, cleared when it comes on screen.
 */
let problemsMark: ProblemsMark = UNLIT;

/**
 * Which tab or path a save-failure or missing-file row is about, so the save or open that fixes
 * it can take it away (TYTO-260). Not saved anywhere: these rows live as long as the window.
 */
const rowSubjects: RowSubjects = new WeakMap();

/**
 * Takes away the `code` rows about `subject`, which stopped being a problem (TYTO-260). It
 * never lights the mark, and puts it out when no window row is left for it to point at.
 */
function clearWindowProblem(code: string, subject: string): void {
  const before = panel.installation;
  panel.installation = withoutRowsAbout(before, rowSubjects, code, subject);
  if (panel.installation.length !== before.length) {
    problemsMark = afterRemoval(problemsMark, panel.installation);
  }
}

/** Called where a window-raised row is created, never by comparing lists (`problems-mark.ts`). */
function raiseWindowProblem(): void {
  problemsMark = raised(problemsMark, panelShown(PROBLEMS_PANEL));
}

/**
 * The editor, held here because three controls now move it.
 *
 * It used to be a local in `load`, which was right while nothing outside the bridge touched
 * it. A diagnostic row scrolls it, the slide picker scrolls it and the template picker
 * edits it, so the handle is state rather than a local now.
 *
 * **One pane and several documents**, not one editor per tab. The workspace holds every
 * document's `EditorState` and this view shows one of them at a time; a second CodeMirror
 * per tab would be a second set of extensions, a second keymap and a second command registry
 * for the window to keep in step.
 */
let editor: EditorHandle | undefined;

/**
 * The window's one keybinding table (TYTO-207, ADR 0074): what the editor runs, what the
 * window dispatcher runs and what the bar shows, all read off this. The built-in layer, the
 * plugins' once they have answered, and the person's `keybindings.json` on top.
 */
let keybindings: KeybindingTable = builtInTable;
let pluginKeybindings: readonly KeybindingLayer[] = [];
/**
 * The person's layer: the entries of the last `keybindings.json` that read without a syntax
 * error (TYTO-207). Kept as entries and not as a table, so they are resolved again whenever a
 * layer under them or the registry they name changes.
 */
let userKeybindings: readonly KeybindingEntry[] = [];
/**
 * The person's snippets: those of the last `snippets.json` that read without a syntax error
 * (TYTO-277, ADR 0082). The editor asks for them each time a list opens.
 */
let userSnippets: readonly BriefSnippet[] = [];

/**
 * What every declared setting is, from `settings:outline` (TYTO-304, ADR 0092): asked once the
 * window has loaded, and read by the settings tab's suggestions and hover each time they open,
 * so a tab opened before the answer arrived gets them too. Empty until then.
 */
let settingsOutline: readonly SettingOutline[] = [];

/**
 * The help each app file's tab is built with (`assistOf`): the settings tab's suggestions and
 * hover, with Tab stepping through an open list as it does in a brief. The hover's labels are
 * read at each hover, so they follow the window's language.
 */
const appFileAssists: AppFileAssists = {
  settings: [
    tabThroughCompletions(),
    jsonAssist(
      settingsAssist(
        () => settingsOutline,
        () => ({
          type: translate(state.locale, 'settings.assist.type'),
          default: translate(state.locale, 'settings.assist.default'),
          accepted: translate(state.locale, 'settings.assist.accepted'),
        }),
      ),
    ),
  ],
  // The keybindings tab's (TYTO-304): every command the registry holds, read at each opening,
  // so a plugin's command registered after the tab opened is offered too.
  keybindings: [
    tabThroughCompletions(),
    jsonAssist(
      keybindingsAssist(
        () => keybindingCommands(),
        () => ({
          defaultKey: translate(state.locale, 'keybindings.assist.defaultKey'),
          fields: {
            key: translate(state.locale, 'keybindings.assist.field.key'),
            command: translate(state.locale, 'keybindings.assist.field.command'),
            when: translate(state.locale, 'keybindings.assist.field.when'),
          },
          removes: translate(state.locale, 'keybindings.assist.removes'),
          removesWithKey: translate(state.locale, 'keybindings.assist.removesWithKey'),
        }),
      ),
    ),
  ],
};

const byId = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

/**
 * The nodes the window writes into, **looked up again every time the dock rearranges**.
 *
 * This used to be a frozen object built once at module load, and that table is the thing
 * TYTO-101 exists to remove: fifteen ids resolved before anything was on screen meant a
 * panel could never move, close or come back, because the only handle on it was captured
 * when the document was still the one `index.html` shipped.
 *
 * Now the panels are elements the dock creates from a record, so a closed panel's nodes are
 * gone and a reopened panel's are *new nodes*. Anything holding the old ones would be
 * writing into a document nobody is looking at — which is the failure this shape prevents,
 * and it is silent.
 */
let elements = resolveElements();
/** What main last said about a newer version (TYTO-131). Asked for, never only pushed. */
let updateStatus: UpdateStatus = { state: 'none' };

function resolveElements() {
  return {
    editor: byId('editor'),
    // By tag and not by id: the element is the panel, so what identifies it is what it is.
    // Naming the tag here is also what keeps `problems-panel.js` a runtime import rather
    // than a type-only one that the bundler would drop — and dropping it would mean the
    // custom element is never defined and the panel silently stays empty.
    problems: document.querySelector<ProblemsPanel>(PROBLEMS_TAG),
    commandBar: document.querySelector<CommandBar>(COMMAND_BAR_TAG),
    exportDialog: document.querySelector<ExportDialog>(EXPORT_DIALOG_TAG),
    // TYTO-47. By tag, for the problems panel's reason: naming it keeps the import a runtime one.
    pluginsDialog: document.querySelector<PluginsDialog>(PLUGINS_DIALOG_TAG),
    // TYTO-45. A dock panel, so `null` whenever it is closed — which is how it starts.
    queuePanel: document.querySelector<QueuePanel>(QUEUE_PANEL_TAG),
    // TYTO-44. Outside `.shell` for the export dialog's reason: it covers the window.
    templateMode: document.querySelector<TemplateMode>(TEMPLATE_MODE_TAG),
    // TYTO-131. At the end of the status bar; hidden while there is nothing newer.
    updateNotice: byId<HTMLButtonElement>('update-notice'),
    // TYTO-297. A line the window says for a few seconds; hidden the rest of the time.
    statusNotice: byId<HTMLOutputElement>('status-notice'),
    // TYTO-248. Outside the docks, like the command bar: the bar belongs to the window.
    statusBar: document.querySelector<StatusBar>(STATUS_BAR_TAG),
  };
}

/**
 * One request gate per document, because two tabs compile independently.
 *
 * A single gate remembers only the last id it issued anywhere, so with two documents typing
 * into one would throw away the other's answer — the gate would be discarding a *fresh*
 * result for a different brief rather than a stale one for the same brief, which is the
 * opposite of what it is for.
 */
const gates = new Map<string, RequestGate>();

function gateFor(documentId: string): RequestGate {
  const existing = gates.get(documentId);
  if (existing !== undefined) return existing;
  const created = createRequestGate();
  gates.set(documentId, created);
  return created;
}

/**
 * One pending compile per document, holding the text as it was when the key was pressed.
 *
 * Per document and carrying its own brief, because a person types, switches tab and types
 * again inside 200 ms. One shared timer would cancel the first document's compile and then
 * ask for the *editor's* text, which by then is the other document's — so the first tab
 * would never see its own edit and the second would be compiled twice.
 */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function ask(bridge: TytoBridge, documentId: string, brief: string): void {
  const existing = pending.get(documentId);
  if (existing !== undefined) clearTimeout(existing);
  pending.set(
    documentId,
    setTimeout(() => {
      pending.delete(documentId);
      void request(bridge, documentId, brief);
    }, PREVIEW_DELAY),
  );
}

/** The card's acceptance criterion, in `panel.ts` where a test can drive it. */
function reveal(range: SourceRange): void {
  const target = commandPane();
  if (target !== undefined) revealRange(target.view, range);
}

function paintPanel(): void {
  const current = active();
  const problems = [...panel.installation, ...current.diagnostics];

  if (elements.problems !== null) {
    // A property assignment, not a paint: the element schedules its own update and rewrites
    // only the rows that changed (ADR 0024). Assigning a new object every time is the point
    // — Lit compares the property by identity, so a fresh object is what says "look again",
    // and the diffing that follows is what makes doing so cheap.
    elements.problems.state = {
      diagnostics: problems,
      brief: current.brief,
      locale: state.locale,
      // A preview tab's `active()` is the brief it follows, so "this brief" is right there.
      kind: current.kind ?? 'brief',
    };
  }
}

/** The name a tab and the window title show, which is the catalogue's when there is none. */
const labelOf = (document_: DocumentState): string =>
  document_.name ?? translate(state.locale, 'document.untitled');

/** A tab's tooltip: the path main wrote for the file (ADR 0086), or none in no file. */
const whereOf = (document_: DocumentState): { where?: string } =>
  document_.pathLabel === undefined ? {} : { where: document_.pathLabel };

/**
 * Which area a group's pane is drawn in (TYTO-272 PR B): `json` while a settings, keybindings or
 * snippets tab is in front, `editor` otherwise. One CodeMirror view shows both kinds, so its
 * root changes area with the tab. No remeasure here: the area only changes when another
 * document comes to the front, and `restore` gives the view a new state, which CodeMirror
 * measures afresh — measured with a JSON tab in Consolas and a brief in IBM Plex Mono at 14,
 * the brief's guides on their columns with and without a remeasure at this point.
 */
function showFontArea(mount: HTMLElement, front: EditorTab | undefined): void {
  const kind =
    front === undefined || isPreview(front)
      ? undefined
      : documentOf(workspace, front.documentId)?.kind;
  mount.dataset['fontArea'] = kind === undefined ? 'editor' : 'json';
}

function paintTabs(): void {
  // One strip per group (TYTO-286). A fresh array every time, for the reason the problems
  // panel's state object is fresh: Lit compares by identity and `repeat` keyed by tab id is
  // what makes rebuilding a strip cost only the tabs that changed.
  for (const group of groupList(groups)) {
    const element = groupElements.get(group.id);
    if (element === undefined) continue;
    element.locale = state.locale;
    element.focused = group.id === groups.focusedGroupId;
    element.activeTabId = group.activeTabId ?? '';
    const front = activeTabOf(group);
    element.showing = front !== undefined && isPreview(front) ? 'preview' : 'editor';
    showFontArea(element.mount, front);
    // "Open preview to the side" at the end of the strip while a brief's own tab is in front.
    element.offerPreview =
      front !== undefined &&
      !isPreview(front) &&
      documentOf(workspace, front.documentId)?.kind === undefined;
    element.openPreview = () => {
      runCommand(PREVIEW_OPEN_TO_SIDE);
    };
    paintBreadcrumb(group.id);
    element.tabs = group.tabs.flatMap((tab) => {
      if (isPreview(tab)) return [previewEntry(tab)];
      const document_ = documentOf(workspace, tab.documentId);
      // Compared, never looked up: there is no field on a document that says it has been
      // typed in, and this is the only place a strip learns of one that has (TYTO-112).
      return document_ === undefined
        ? []
        : [
            {
              id: tab.id,
              label: labelOf(document_),
              ...whereOf(document_),
              dirty: isUnsaved(document_),
            },
          ];
    });
    element.select = (tabId) => {
      selectTab(tabId);
    };
    element.close = (tabId) => {
      void requestCloseTab(tabId);
    };
  }
}

/**
 * A preview's tab: "Preview <name>" for the brief it shows now (TYTO-287) — for a following one,
 * whichever brief was last in front — and the lock drawn after it when it is locked.
 */
function previewEntry(tab: EditorTab): TabEntry {
  const heading = translate(state.locale, 'preview.heading');
  const shown = documentOf(workspace, tab.documentId);
  return {
    id: tab.id,
    label: shown === undefined ? heading : `${heading} ${labelOf(shown)}`,
    // The path of the brief it shows, which is the question a hover over it asks.
    ...(shown === undefined ? {} : whereOf(shown)),
    dirty: false,
    preview: true,
    ...(tab.locked === true ? { locked: true } : {}),
  };
}

/**
 * The commands, and the one thing in this file that is not wiring.
 *
 * Each of these moves a piece of state this module holds and then repaints, which is
 * exactly what the corresponding button already did — and that is the point: a command is
 * not a second way to do something, it is the same way with a name. The click handlers
 * below call `registry.run(id)` rather than the action, so a button and the bar cannot
 * drift apart the way two copies of a handler would.
 */
/**
 * The export dialog's state that outlives an opening: the folder, and the run in flight.
 *
 * Held here rather than on the element for the reason the element's own doc gives — the
 * dialog runs nothing and remembers nothing about the app. A folder that reset every time
 * the dialog was closed would make a second export of the same brief a second folder hunt.
 */
let exportDirectory: string | undefined;
let exportId: string | undefined;
let exportPoll: ReturnType<typeof setInterval> | undefined;

/** How often the dialog asks how far along the run is. */
const EXPORT_POLL_MS = 150;

/**
 * The formats the brief in front will render, for the dialog's checklist (TYTO-137).
 *
 * **No channel of its own, because the window already has both halves.** `templates:list`
 * answers with each template's formats, id and label, and `panel.templates` holds that answer; the
 * brief's frontmatter names which template it is. So this is a lookup rather than a round
 * trip — and an empty array is the honest answer for a brief that names no template, or one
 * whose manifest this window does not have, which the dialog draws as *every format the
 * template has* rather than as an empty list.
 */
function formatsOfActiveBrief(): readonly FormatOption[] {
  const wanted = templateOf(activeText());
  if (wanted === undefined) return [];
  const formats = panel.templates.find((template) => template.name === wanted)?.formats ?? [];
  // Only the brief's own formats when it lists some, because those are all an export of
  // it can write (ADR 0107): the ticks then narrow that list and never ask for more.
  return offeredFormats(activeText(), formats);
}

function paintExport(progress: ExportProgressView | undefined): void {
  const dialog = elements.exportDialog;
  if (dialog === null || dialog === undefined) return;
  dialog.locale = state.locale;
  dialog.directory = exportDirectory;
  dialog.progress = progress;
}

/**
 * Asks main how the run is going until it stops running.
 *
 * **The whole of the polling decision, in eight lines** (`src/main/export.ts` has the why).
 * The interval is cleared the moment the answer is not `running`, so a finished export
 * costs nothing and a window left open overnight is not asking anybody anything.
 */
function watchExport(): void {
  if (exportPoll !== undefined) clearInterval(exportPoll);
  exportPoll = setInterval(() => {
    void withBridge(async (bridge) => {
      if (exportId === undefined) return;
      const answer = await bridge['export:progress']({ exportId });
      // An id main has never heard of — a window reloaded mid-export, say. Stop asking
      // rather than poll forever against a run that no longer exists.
      if (answer.progress === undefined) {
        stopWatchingExport();
        return;
      }
      paintExport(answer.progress);
      if (answer.progress.status !== 'running') stopWatchingExport();
    });
  }, EXPORT_POLL_MS);
}

function stopWatchingExport(): void {
  if (exportPoll !== undefined) clearInterval(exportPoll);
  exportPoll = undefined;
}

/**
 * The panels `wireQueuePanel` has handed its callbacks to.
 *
 * Weak, and keyed by element, because the dock makes a *new* element each time the panel is
 * reopened (`main.ts`'s `resolveElements` says why) — and a new one has neither the callbacks
 * nor a view, while one that survived a rearrange has both and must not be asked again.
 */
const wiredQueuePanels = new WeakSet<QueuePanel>();

/**
 * The local queue panel (TYTO-45): its buttons, and its first answer.
 *
 * Asked once when the element is born and then only on `queue:changed`, never on a timer —
 * main already sweeps the inbox, and one push per change is what keeps a panel docked all day
 * current without the window polling behind it.
 */
function wireQueuePanel(): void {
  const panel = elements.queuePanel;
  if (panel === null || wiredQueuePanels.has(panel)) return;
  wiredQueuePanels.add(panel);

  const answer = (ask: (bridge: TytoBridge) => Promise<QueuePanel['view']>): void => {
    void withBridge(async (bridge) => {
      try {
        panel.view = await ask(bridge);
      } catch {
        panel.view = 'failed';
      }
    });
  };

  panel.actions = {
    chooseFolder: () => {
      answer((bridge) => bridge['queue:set-folder']({ choose: true }));
    },
    clearFolder: () => {
      answer((bridge) => bridge['queue:set-folder']({ choose: false }));
    },
    setAutoRun: (on) => {
      answer((bridge) => bridge['queue:set-auto-run']({ on }));
    },
    setKinds: (kinds) => {
      answer((bridge) => bridge['queue:set-kinds']({ kinds: [...kinds] }));
    },
    run: (taskId) => {
      void withBridge(async (bridge) => {
        await bridge['queue:run']({ taskId });
      });
    },
    // The same `adopt` a picked file goes through, so a brief already open in a tab is that
    // tab, and the fixed brief is saved over the task's own file by the ordinary Save.
    openBrief: (taskId) => {
      void withBridge(async (bridge) => {
        const wanted = nextDocumentId();
        const opened = await bridge['queue:open-brief']({ documentId: wanted, taskId });
        adopt(opened.document, opened.documentId, wanted);
      });
    },
    openOutput: (taskId) => {
      void withBridge(async (bridge) => {
        await bridge['queue:reveal-output']({ taskId });
      });
    },
  };

  void refreshQueue();
  void refreshQueueKinds();
}

/** What a queue folder can be asked to produce, the export dialog's list (ADR 0044). */
async function refreshQueueKinds(): Promise<void> {
  await withBridge(async (bridge) => {
    const panel = elements.queuePanel;
    if (panel === null) return;
    const answer = await bridge['export:kinds']({});
    panel.available = [...new Set(answer.kinds.map((item) => item.kind))];
  });
}

/** Asks main for the queue and hands it to the panel, if the panel is open. */
async function refreshQueue(): Promise<void> {
  await withBridge(async (bridge) => {
    const panel = elements.queuePanel;
    if (panel === null) return;
    try {
      panel.view = await bridge['queue:list']({});
    } catch {
      panel.view = 'failed';
    }
  });
}

/**
 * The plugins screen (TYTO-47): opened empty and filled when main answers, so a slow disk
 * shows the notice at once rather than nothing. Asked on every open, never cached — a plugin
 * installed from a terminal beside the window is the ordinary way one arrives.
 */
function openPluginsDialog(): void {
  const dialog = elements.pluginsDialog;
  if (dialog === null || dialog === undefined) return;

  dialog.locale = state.locale;
  dialog.view = undefined;
  dialog.open = true;
  // A set or a clear goes to main, and the list is asked again for what changed: the screen
  // never learns the value, only that the key is now set or not (TYTO-187). A refusal is
  // rethrown so the row can say so.
  dialog.onCredential = async ({ plugin, key, secret }) => {
    const bridge = window.tyto;
    if (bridge === undefined) throw new Error('no bridge');
    if (secret === undefined) await bridge['credentials:delete']({ plugin, key });
    else await bridge['credentials:set']({ plugin, key, secret });
    dialog.view = await bridge['plugins:list']({});
  };
  void withBridge(async (bridge) => {
    try {
      dialog.view = await bridge['plugins:list']({});
    } catch {
      dialog.view = 'failed';
    }
  });
}

function openExportDialog(): void {
  const dialog = elements.exportDialog;
  if (dialog === null || dialog === undefined) return;

  // Asked each time, so an installed exporter's kind is offered beside Tyto's (ADR 0044).
  // Unique and in main's order; the built-in four until the answer lands.
  void withBridge(async (bridge) => {
    const answer = await bridge['export:kinds']({});
    dialog.available = [...new Set(answer.kinds.map((item) => item.kind))];
  });

  dialog.chooseDirectory = () => {
    void withBridge(async (bridge) => {
      const answer = await bridge['export:choose-directory']({});
      // A dismissed picker leaves the previous folder alone, the way a dismissed save
      // dialog leaves the path alone.
      if (answer.directory === undefined) return;
      exportDirectory = answer.directory;
      paintExport(dialog.progress);
    });
  };

  dialog.start = (request) => {
    void withBridge(async (bridge) => {
      const answer = await bridge['export:start']({
        documentId: active().id,
        // The buffer, not the file: an unsaved edit is still what the person is looking at.
        brief: activeText(),
        directory: request.directory,
        outputs: request.outputs.map((output) => ({
          kind: output.kind,
          ...(output.quality === undefined ? {} : { quality: output.quality }),
          ...(output.scale === undefined ? {} : { scale: output.scale }),
        })),
        // Absent when every format is wanted, which is what the channel already reads as
        // "all of them" and what this window sent before TYTO-137.
        ...(request.formats === undefined ? {} : { formats: [...request.formats] }),
      });
      exportId = answer.exportId;
      // Painted before the first poll answers, so the dialog switches to Cancel on the
      // click rather than a beat later.
      paintExport({
        status: 'running',
        total: 0,
        done: 0,
        failed: 0,
        directory: request.directory,
        diagnostics: [],
      });
      watchExport();
    });
  };

  dialog.cancel = () => {
    void withBridge(async (bridge) => {
      if (exportId === undefined) return;
      await bridge['export:cancel']({ exportId });
    });
  };

  dialog.reveal = (directory) => {
    void withBridge(async (bridge) => {
      await bridge['export:reveal']({ directory });
    });
  };

  dialog.close = () => {
    stopWatchingExport();
    dialog.open = false;
  };

  // **Read on the way in, not watched** (TYTO-137). The brief behind an open dialog cannot
  // be typed in — the panel is modal — so the formats cannot go stale while it is up, and a
  // checklist that rebuilt itself under somebody's hand would be worse than one that does
  // not. Opening it again on another tab reads again, and the dialog re-ticks everything.
  dialog.formats = formatsOfActiveBrief();

  paintExport(dialog.progress);
  dialog.open = true;
}

/**
 * Whether `id` is offered with the tab in front: the one question every door asks (TYTO-283).
 * Lazy, so it reads the workspace at the moment a command is listed or run.
 */
const offeredNow = (id: string): boolean => commandOffered(activeKind(), id);

const registry: CommandRegistry = withCommandGate(
  createDesktopRegistry({
    stepZoom: (direction) => {
      // A step from whatever is on screen, the same as the buttons: the first step after
      // `fit` moves from the size the user is looking at — in the preview showing this brief,
      // the focused one first (TYTO-287).
      const current = active();
      const from = shownZoomOf(current.id) ?? (current.zoom === 'fit' ? 1 : current.zoom);
      updateActive((document_) => ({ ...document_, zoom: stepZoom(from, direction) }));
      repaint();
    },

    openPreview: (side) => {
      openPreview(side, false);
    },

    togglePreviewLock: () => {
      // The preview in front, or else the window's following one, as VS Code's command acts on
      // the preview a person is looking at.
      const target = focusedPreview() ?? followingPreview(groups);
      if (target === undefined || !sessionRead) return;
      groups = toggleLock(groups, target.id);
      showGroups();
    },

    zoomToFit: () => {
      updateActive((document_) => ({ ...document_, zoom: 'fit' as Zoom }));
      repaint();
    },

    stepFormat: (direction) => {
      updateActive((document_) => ({
        ...document_,
        selection: {
          ...document_.selection,
          format: cycle(formatsOf(document_.frames), document_.selection.format, direction),
        },
      }));
      repaint();
    },

    stepSlide: (direction) => {
      const current = active();
      const artwork = cycle(artworksOf(current.artworks), current.selection.artwork, direction);
      updateActive((document_) => ({
        ...document_,
        selection: { ...document_.selection, artwork },
      }));
      repaint();
      // The editor follows, the same as choosing from the picker does. A command that moved
      // the picture and left the text behind would be a different feature wearing the same
      // name.
      const at = rangeOfArtwork(current.artworks, artwork);
      if (at !== undefined) reveal(at);
    },

    toggleLocale: () => {
      // The only way to switch language since the footer's picker left (TYTO-248, ADR 0076).
      applyLocale(state.locale === 'pt-BR' ? 'en' : 'pt-BR');
    },

    chooseTemplateFolder: () => {
      void setTemplateFolder(true);
    },
    clearTemplateFolder: () => {
      void setTemplateFolder(false);
    },
    openExport: () => {
      openExportDialog();
    },
    showPlugins: () => {
      openPluginsDialog();
    },
    openSettings: () => {
      openAppFile('settings');
    },
    openKeybindings: () => {
      openAppFile('keybindings');
    },
    openSnippets: () => {
      openAppFile('snippets');
    },
    reloadWindow: () => {
      // The session first, so every tab comes back; a reload that could not keep the drafts
      // does not happen while there are any (TYTO-113, ADR 0080).
      void keepSession(false).then((written) => {
        if (written || !workspace.documents.some(isUnsaved)) window.location.reload();
      });
    },
    pickTheme: () => {
      void pickTheme();
    },
    zoomWindow: (step) => {
      // Main steps, applies and writes the `zoom` setting (TYTO-272). A file that does not parse
      // refuses the write, and main's `settings:changed` push opens it where the error is.
      void withBridge(async (bridge) => {
        await bridge['window:zoom']({ step });
      });
    },
    openDocumentation: () => {
      // TYTO-318. Names nothing: main opens one of its two literals, by the menu's language.
      void withBridge(async (bridge) => {
        await bridge['help:open-documentation']({});
      });
    },
    showQueue: () => {
      void changeLayout(withPanelOpen(layout, QUEUE_PANEL, true)).then(() => {
        // Brought forward: the panel may have been open all along, behind the editor's focus.
        elements.queuePanel?.querySelector<HTMLButtonElement>('button')?.focus();
      });
    },

    editTemplate: () => {
      void loadTemplateMode().then((mode) => mode?.openFolder(null));
    },
    newTemplate: () => {
      void loadTemplateMode().then(async (mode) => {
        if (mode === undefined) return;
        mode.open = true;
        // Straight to the name, which is the only thing a New needs from the person.
        await mode.updateComplete;
        mode.querySelector<HTMLInputElement>('.template-mode__new-name')?.focus();
      });
    },

    newDocumentFromTemplate: () => {
      pickTemplate();
    },

    openInsertMenu: () => {
      const target = focusedPane();
      if (target === undefined) return;
      // Focus first: the list closes when the editor loses focus, and the command may have
      // come from the bar, which held it.
      target.view.focus();
      openSlashMenu(target.view);
    },

    goToBlock: () => {
      pickBlock();
    },

    formatBrief: () => {
      const target = focusedPane();
      if (target === undefined) return;
      // Focus back on the text: the command may have come from the bar, which held it.
      target.view.focus();
      formatPane(target);
    },

    newDocument: () => {
      // **Added and never substituted, which is the whole of the card's second criterion.**
      // `adopt` replaces the tab in front when `isDisposable` says it holds nothing — right for
      // opening a file, wrong here: a New pressed on an empty tab would open no tab at all, and
      // the person who asked for a blank page would watch nothing happen. So `isDisposable`'s
      // rule is not consulted and not changed.
      workspace = addDocument(workspace, newDocument(nextDocumentId(), editor?.blank('')));
      followWorkspace();
    },

    openDocument: () => {
      void withBridge(async (bridge) => {
        const wanted = nextDocumentId();
        const answer = await bridge['file:open']({ documentId: wanted });
        adopt(answer.document, answer.documentId, wanted);
      });
    },

    saveDocument: (saveAs) => {
      void withBridge(async (bridge) => {
        // Still the pane, and deliberately: the guard asks whether the window is up, not
        // where the text comes from. A save fired in the paint before CodeMirror is mounted
        // would write the empty string over a file.
        if (editor === undefined) return;
        // Format on save (TYTO-297): a brief only, in the pane holding its record, before the
        // text is read — `onUpdate` writes the workspace in the same transaction, so the save
        // below sends the formatted text. A brief that refuses is saved as it is, and says so.
        if (formatBriefOnSave && active().kind === undefined) {
          const pane = primaryPaneOf(active().id);
          if (pane !== undefined) formatPane(pane);
        }
        await saveOneDocument(bridge, active().id, saveAs);
      });
    },

    restoreLayout: () => {
      void changeLayout(DEFAULT_LAYOUT);
    },

    toggleDock: (dock) => {
      void changeLayout(withDockToggled(layout, dock));
    },

    closeDocument: () => {
      // The focused group's tab in front (TYTO-286): `Mod-w` acts within the group.
      const tab = activeTabOf(focusedGroup(groups));
      if (tab !== undefined) void requestCloseTab(tab.id);
    },

    stepDocument: (direction) => {
      const group = focusedGroup(groups);
      const at = group.tabs.findIndex((tab) => tab.id === group.activeTabId);
      const next = group.tabs[(at + direction + group.tabs.length) % group.tabs.length];
      if (next !== undefined) selectTab(next.id);
    },

    splitGroup: (direction) => {
      // The same document in the new group, which takes the focus (ADR 0083). Refused until
      // the last session is read, as a write is: the groups it brings back replace these.
      if (editor === undefined || !sessionRead) return;
      groups = splitGroup(groups, direction);
      showGroups();
    },

    focusGroup: (direction) => {
      groups = focusNeighbour(groups, direction);
      showGroups();
    },

    moveTabToNextGroup: () => {
      if (editor === undefined || !sessionRead) return;
      groups = moveTabToNextGroup(groups);
      showGroups();
    },

    stepTabInGroup: (direction) => {
      if (editor === undefined || !sessionRead) return;
      groups = stepTabInGroup(groups, direction);
      showGroups();
    },

    closeGroup: () => {
      if (!sessionRead) return;
      void closeFocusedGroup();
    },

    toggleVimMode: () => {
      if (editor === undefined) return;
      editor.setVimMode(!editor.isVimMode());
      // The bindings change with the mode — vim has no `Mod-z`, because undo is `u` and
      // belongs to the vim engine — so the bar has to be told what it now shows.
      paintCommandBar();
    },
  }),
  offeredNow,
);

/**
 * The next value in a ring, or the first one when nothing is selected yet.
 *
 * Wrapping rather than stopping: two formats and a "next" that refused at the end would be
 * a control that does nothing every other press.
 */
function cycle(
  values: readonly string[],
  current: string | undefined,
  direction: 1 | -1,
): string | undefined {
  if (values.length === 0) return undefined;
  const at = current === undefined ? -1 : values.indexOf(current);
  const next = (at + direction + values.length) % values.length;
  return values[next];
}

/** Runs `use` with the bridge, or does nothing. The bridgeless window is the test's. */
async function withBridge(use: (bridge: TytoBridge) => Promise<void>): Promise<void> {
  const bridge = window.tyto;
  if (bridge !== undefined) await use(bridge);
}

/**
 * The editor groups on screen (TYTO-286, ADR 0083): each group's element, the CodeMirror pane
 * in it, and which document that pane is showing right now.
 *
 * **One editor and several panes**, not one editor per group: every pane is made by the one
 * `createEditor` handle, so they share its compartments, its command registry and the listener
 * that tells this file about a transaction. A document shown in two groups has one **primary**
 * pane, holding the record the workspace keeps (with its undo history), and a **follower** in
 * every other: same text, own selection, no history, edits copied both ways by the editor.
 */
const groupElements = new Map<string, EditorGroupElement>();
const panes = new Map<string, EditorPane>();
/** Group id to the document its pane shows: the truth `onUpdate` writes by, never `active()`. */
const shownIn = new Map<string, string>();
/** Group id to the tab its pane shows, so a pane that lets go can say where that tab was. */
const shownTab = new Map<string, string>();

/** Where a tab was looking: its selection and the offset of the line at the top of its pane. */
type TabPlace = NonNullable<RestoredTab['place']>;

/**
 * Where each tab was looking when its pane last let go of it (TYTO-286). A document has one
 * selection, its primary's; a tab of it in another group has its own, and the session keeps
 * each (ADR 0080 decision 8), so a tab behind another one in its group is written from here.
 */
const tabPlaces = new Map<string, TabPlace>();

/**
 * Where a restored tab goes the first time a pane shows it (TYTO-286): read from the session,
 * used once, so the cursor of each occurrence comes back to its own pane.
 */
const pendingPlaces = new Map<string, TabPlace>();
/**
 * The tree's shape when it was last laid out, so a repaint that changed no split moves nothing.
 * The shares are not part of it (TYTO-289): a resize only changes grow factors, so the splitter
 * being dragged or focused stays the element it was.
 */
let arrangedShape = '';

const shapeOf = (node: GroupNode): string =>
  node.kind === 'group'
    ? node.id
    : `${node.direction}:${node.id}(${node.children.map(shapeOf).join(',')})`;

let groupSplittersWired = false;

/**
 * A splitter between groups moved (TYTO-289). While the pointer is down only the boxes change;
 * the settled shares go into the groups, and from there into the session, like a dock's size.
 */
function resizeGroups(splitId: string, sizes: readonly number[], settled: boolean): void {
  const container = document.querySelector<HTMLElement>('[data-editor-groups]');
  if (container === null) return;
  if (!settled) {
    showShares(container, groups, splitId, sizes);
    return;
  }
  groups = resizeSplit(groups, splitId, sizes);
  applyShares(container, groups);
  keepSessionSoon();
}

/**
 * A tab let go on a strip (TYTO-288): before `beforeTabId` there, or at the strip's end. Refused
 * until the last session is read, as a move by command is: the groups it brings back replace
 * these. The session follows from the repaint, as it does for every change of the groups.
 */
function dropTab(tabId: string, groupId: string, beforeTabId: string | undefined): void {
  if (editor === undefined || !sessionRead) return;
  const target = groupById(groups, groupId);
  if (target === undefined) return;
  const before = target.tabs.findIndex((tab) => tab.id === beforeTabId);
  groups = placeTab(groups, tabId, groupId, before === -1 ? target.tabs.length : before);
  showGroups();
}

/** The group whose pane is `view`, with that pane. */
function paneOfView(view: object | undefined): [string, EditorPane] | undefined {
  for (const entry of panes) if (entry[1].view === view) return entry;
  return undefined;
}

/** The document a pane is showing, by its view: what the analysis and `onUpdate` key by. */
function documentShownBy(view: object | undefined): string | undefined {
  const found = paneOfView(view);
  return found === undefined ? undefined : shownIn.get(found[0]);
}

/** The focused group's pane: where a command, a reveal or the caret goes. */
const focusedPane = (): EditorPane | undefined => panes.get(groups.focusedGroupId);

/**
 * The pane a command runs in and a reveal scrolls: the focused one, or — with a preview focused,
 * whose group's pane is hidden — the pane holding the brief it shows, if any shows it (TYTO-287).
 */
const commandPane = (): EditorPane | undefined =>
  focusedPreview() === undefined ? focusedPane() : (primaryPaneOf(active().id) ?? focusedPane());

/** The pane holding a document's record, if any pane shows it: the one to dispatch into. */
function primaryPaneOf(documentId: string): EditorPane | undefined {
  for (const [groupId, shown] of shownIn) {
    const candidate = panes.get(groupId);
    if (shown === documentId && candidate !== undefined && !isFollower(candidate.state())) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Lays the groups out when the tree changed shape, and makes or takes away their panes.
 *
 * A group that went away first lets go of its document ({@link leave}), so a record it held
 * passes to another pane before the view is destroyed. A new group gets a pane at once, since
 * its element is connected and its mount exists the moment `arrangeGroups` returns.
 */
function arrangeEditorGroups(): void {
  const container = document.querySelector<HTMLElement>('[data-editor-groups]');
  if (container === null) return;
  if (!groupSplittersWired) {
    groupSplittersWired = true;
    wireGroupSplitters(container, { groups: () => groups, onResize: resizeGroups });
    wireTabDrag(container, { onDrop: dropTab });
  }
  const shape = shapeOf(groups.root);
  if (shape === arrangedShape && container.firstElementChild !== null) return;
  arrangedShape = shape;

  const live = new Set(groupList(groups).map((group) => group.id));
  for (const id of [...panes.keys()]) if (!live.has(id)) leave(id);

  const { created, removed } = arrangeGroups(container, groups, groupElements);
  for (const id of removed) {
    panes.get(id)?.destroy();
    panes.delete(id);
    shownIn.delete(id);
  }
  if (editor !== undefined) {
    for (const element of created) {
      if (!panes.has(element.groupId)) panes.set(element.groupId, editor.createPane(element.mount));
    }
  }
  // A view that was moved measures again: its box is another size now.
  for (const each of panes.values()) each.view.requestMeasure();

  // Focus follows the person into a group: a click in its pane, on its tabs or in a preview tab
  // it shows (ADR 0083, changed by ADR 0084). A click in the problems panel is outside every
  // group and changes nothing.
  once(container, 'focusin', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const groupId = target?.closest<HTMLElement>('[data-editor-group]')?.dataset['editorGroup'];
    if (groupId === undefined || groupId === groups.focusedGroupId) return;
    if (groupById(groups, groupId) === undefined) return;
    groups = focusGroup(groups, groupId);
    syncActiveDocument();
    repaint();
  });
}

/**
 * A pane stops showing its document. If it held the record and another pane still shows the
 * document, that pane is promoted: it takes the record with its own selection, and every other
 * follower is rebuilt to follow it. Where the pane was scrolled is kept for the document.
 */
function leave(groupId: string): void {
  const pane_ = panes.get(groupId);
  const documentId = shownIn.get(groupId);
  const tabId = shownTab.get(groupId);
  shownIn.delete(groupId);
  shownTab.delete(groupId);
  if (pane_ === undefined || documentId === undefined) return;
  if (tabId !== undefined) {
    const measured = pane_.view.scrollDOM.clientHeight > 0;
    tabPlaces.set(tabId, {
      ...selectionOf(pane_.state()),
      top: measured ? pane_.scroll().top : (tabPlaces.get(tabId)?.top ?? 0),
    });
  }
  const current = documentOf(workspace, documentId);
  if (current === undefined || isFollower(pane_.state())) return;
  if (pane_.view.scrollDOM.clientHeight > 0) {
    const scroll = pane_.scroll();
    workspace = updateDocument(workspace, documentId, (document_) => ({ ...document_, scroll }));
  }
  const others = [...shownIn].filter(([, shown]) => shown === documentId).map(([id]) => id);
  const [heir, ...rest] = others.map((id) => panes.get(id));
  const record = current.state;
  if (heir === undefined || record === undefined) return;
  heir.restore(withSelection(record, selectionOf(heir.state())), heir.scroll());
  for (const follower of rest)
    follower?.restore(editor?.followerOf(heir) ?? record, follower.scroll());
}

/**
 * A pane starts showing a document: as its primary, or as a follower of the pane that is. A tab
 * the session just brought back is put where it was looking (TYTO-286), primary or follower.
 */
function enter(groupId: string, tabId: string, documentId: string): void {
  const pane_ = panes.get(groupId);
  const target = documentOf(workspace, documentId);
  if (pane_ === undefined || editor === undefined || target?.state === undefined) return;
  const primary = primaryPaneOf(documentId);
  const place = pendingPlaces.get(tabId);
  pendingPlaces.delete(tabId);
  // Set before the restore: its reconfigure transactions reach `onUpdate`, which must already
  // know which document this pane holds.
  shownIn.set(groupId, documentId);
  shownTab.set(groupId, tabId);
  if (primary === undefined) {
    if (place === undefined) {
      pane_.restore(target.state, target.scroll);
      return;
    }
    const state = withSelection(target.state, place);
    const scroll = { top: place.top };
    workspace = updateDocument(workspace, documentId, (document_) => ({
      ...document_,
      state,
      scroll,
    }));
    pane_.restore(state, scroll);
    return;
  }
  const follower = editor.followerOf(primary);
  if (place === undefined) pane_.restore(follower, target.scroll);
  else pane_.restore(withSelection(follower, place), { top: place.top });
}

/**
 * Puts every pane on its group's tab in front: what the groups say, the panes now show.
 *
 * Nothing is read out of a pane here except at a hand-off ({@link leave}), which is the
 * direction TYTO-115 removed: the workspace holds the state and this only points views at it.
 */
function present(): void {
  arrangeEditorGroups();
  if (editor === undefined) return;
  for (const group of groupList(groups)) {
    const wanted = activeTabOf(group);
    // A preview in front shows no text: the pane lets go of its document, so the record passes
    // to another pane that shows it, and stays hidden until a text tab comes back (TYTO-287).
    if (wanted !== undefined && isPreview(wanted)) {
      leave(group.id);
      continue;
    }
    if (shownTab.get(group.id) === wanted?.id && shownIn.get(group.id) === wanted?.documentId) {
      continue;
    }
    leave(group.id);
    if (wanted !== undefined) enter(group.id, wanted.id, wanted.documentId);
  }
  // A tab that closed has nowhere to be looking.
  const live = new Set(groupList(groups).flatMap((group) => group.tabs.map((tab) => tab.id)));
  for (const id of [...tabPlaces.keys()]) if (!live.has(id)) tabPlaces.delete(id);
}

/** `workspace.activeId` brought to the focused group's document, the one {@link active} reads. */
function syncActiveDocument(): void {
  const id = focusedDocumentId(groups);
  if (id !== undefined && id !== workspace.activeId) workspace = selectDocument(workspace, id);
  followActiveBrief();
}

/**
 * Points the following preview at the brief it should show (TYTO-287, ADR 0084): the brief
 * whose own tab is in front of the focused group, else the one it showed while that is still
 * open, else the first brief in front of any group, else any open brief, else none.
 */
function followActiveBrief(): void {
  const isBrief = (id: string | undefined): id is string => {
    const document_ = id === undefined ? undefined : documentOf(workspace, id);
    return document_ !== undefined && document_.kind === undefined;
  };
  const textInFront = (group: EditorGroup): string | undefined => {
    const tab = activeTabOf(group);
    return tab === undefined || isPreview(tab) ? undefined : tab.documentId;
  };
  const focused = textInFront(focusedGroup(groups));
  if (isBrief(focused)) followedBrief = focused;
  else if (!isBrief(followedBrief)) {
    followedBrief =
      groupList(groups).map(textInFront).find(isBrief) ??
      workspace.documents.find((document_) => document_.kind === undefined)?.id ??
      '';
  }
  groups = followBrief(groups, followedBrief);
}

/**
 * The groups changed — a tab chosen, a split, a close, focus moved: the panes follow, the
 * caret goes into the focused one, and the window is painted.
 *
 * And the caret goes back in. Clicking a tab moves focus to the tab's own button, and a person
 * who has just chosen a document wants to type into it — every editor does this, and without
 * it the first keystroke after a switch goes nowhere a person can see.
 */
function showGroups(): void {
  syncActiveDocument();
  present();
  // A preview in front takes the focus itself: its group's pane is hidden (TYTO-287).
  const focusFront = (): void => {
    if (focusedPreview() === undefined) focusedPane()?.view.focus();
    else groupElements.get(groups.focusedGroupId)?.preview.focus();
  };
  focusFront();
  repaint();
  // And again once the group has drawn what the repaint handed it: when what is in front
  // changed kind, the pane or the preview was still hidden, and a hidden element takes no
  // focus. Measured in TYTO-288: a text tab chosen over a preview left the focus on the tab's
  // button, so the editor's keys went nowhere, and a preview dropped into a group left it on
  // the body.
  void groupElements.get(groups.focusedGroupId)?.updateComplete.then(focusFront);
}

/**
 * Opens the following preview beside the brief in front (`side`) or in the focused group, or
 * brings it forward when there is one (TYTO-287). Refused until the last session is read, as a
 * split is: the groups the session brings back replace these.
 */
function openPreview(side: boolean, focus: boolean): void {
  if (editor === undefined || !sessionRead) return;
  const current = active();
  const brief = current.kind === undefined ? current.id : followedBrief;
  groups = side ? openPreviewToSide(groups, brief, focus) : openPreviewHere(groups, brief);
  showGroups();
}

/**
 * The workspace gained or lost documents — a file opened, a new tab, a close, a session read:
 * the groups follow. A document no tab shows goes into the focused group; a tab whose document
 * is gone closes, and a group left with none closes with it. The focused group then shows the
 * workspace's active document.
 */
function followWorkspace(): void {
  const open = new Set(workspace.documents.map((document_) => document_.id));
  for (const id of shownDocumentIds(groups)) {
    if (!open.has(id)) groups = closeDocumentTabs(groups, id);
  }
  const shown = shownDocumentIds(groups);
  for (const document_ of workspace.documents) {
    if (!shown.has(document_.id)) groups = openDocument(groups, document_.id);
  }
  groups = revealDocument(groups, workspace.activeId);
  showGroups();
}

/**
 * The tab a document already has — in the focused group first, then in any — brought to the
 * front; a new tab in the focused group when it has none. Opening a file another group holds
 * goes there rather than making a second tab of it.
 */
function revealDocument(current: EditorGroups, documentId: string): EditorGroups {
  // A document's own tabs only: opening a file goes to its text, never to its preview.
  const tabs = [focusedGroup(current), ...groupList(current)].flatMap((group: EditorGroup) =>
    group.tabs.filter((tab) => !isPreview(tab)),
  );
  const existing = tabs.find((tab) => tab.documentId === documentId);
  return existing === undefined
    ? openDocument(current, documentId)
    : activateTab(current, existing.id);
}

/** Puts a document in front of every panel, wherever its tab is. */
function activate(id: string): void {
  if (documentOf(workspace, id) === undefined) return;
  groups = revealDocument(groups, id);
  showGroups();
}

/** A tab clicked, a slot key, a step: that tab in front of its group, and its group focused. */
function selectTab(tabId: string): void {
  groups = activateTab(groups, tabId);
  showGroups();
}

/**
 * Takes the state CodeMirror was born holding into the document the window opened on, and
 * says the first group's pane shows it.
 *
 * The one seam where the store is *behind* the pane, and it lasts one statement: the
 * workspace is built at module load and the editor is created after the dock has arranged,
 * so the first document exists for a paint with no state in it. Called the moment there is
 * one, before any listener or any compile, so that every later read finds a document the
 * store can answer for.
 */
function adoptEditorState(handle: EditorHandle): void {
  const first = groupList(groups)[0];
  updateActive((document_) => ({ ...document_, state: handle.state() }));
  if (first !== undefined) {
    panes.set(first.id, handle.firstPane);
    shownIn.set(first.id, active().id);
    const tab = activeTabOf(first);
    if (tab !== undefined) shownTab.set(first.id, tab.id);
  }
}

/**
 * Takes on a document main just opened, in the tab main says is holding it.
 *
 * `wanted` is the tab the renderer offered. Main answers with a different one when the file
 * was **already open**, and the window goes there instead of making a second buffer over one
 * file — with the text it already has, not the disk's, because the tab may hold edits
 * somebody has not saved yet and reading over them is the one unrecoverable thing here.
 *
 * `blank` and then `restore`, never `setValue`: a new tab needs its own undo history, and
 * rebuilding a state from a string is exactly what throws one away.
 */
function adopt(
  opened: { name: string; pathLabel: string; text: string } | null,
  documentId: string | null,
  wanted: string,
  kind?: AppFile,
): void {
  if (opened === null || documentId === null) return;

  if (documentId !== wanted) {
    activate(documentId);
    return;
  }
  if (editor === undefined) return;

  // The app's own files are not briefs: no brief colouring, and no brief lint reading JSON
  // (TYTO-206, TYTO-207). Their checks arrive as markers instead (`setFileDiagnostics`).
  const born = newDocument(
    documentId,
    editor.blank(opened.text, languageOf(kind), assistOf(kind, appFileAssists)),
  );
  const created: DocumentState = {
    ...born,
    ...(kind === undefined ? {} : { kind }),
    name: opened.name,
    pathLabel: opened.pathLabel,
    // Born saved, because it was just read: the buffer and the file say the same thing and
    // the comparison that paints the dot says so without anybody writing `dirty: false`.
    //
    // **Read back out of the buffer, and not the string main handed over.** CodeMirror
    // normalises line endings when it builds a document, so a file whose lines end in CR LF
    // becomes a buffer whose lines end in LF — asserted against the real editor in
    // `packages/editor/src/editor.test.ts` — and such a brief is a supported input (TYTO-64,
    // `tools/contract-test/src/fixture/line-endings/`). So comparing the buffer against the
    // bytes would put the dot on every one of those files the instant it opened, and a
    // discard dialog in front of closing it, for a difference this app cannot keep anyway: a
    // save writes the buffer. The dot means "text you would lose", and there is none.
    savedText: contentOf(born),
  };

  const current = active();
  // The tab nobody typed in becomes the file in every group that shows it (TYTO-286).
  if (isDisposable(current)) groups = replaceDocument(groups, current.id, created.id);
  workspace = isDisposable(current)
    ? {
        // A tab in no file that nobody has typed in is replaced rather than pushed aside,
        // and only that: `isDisposable` is false the moment there is a character in it, a
        // name on it or an edit on its undo stack. That is the tab the window opened on;
        // one typed in and then emptied keeps its history beside the new file (TYTO-120).
        documents: workspace.documents.map((document_) =>
          document_.id === current.id ? created : document_,
        ),
        activeId: created.id,
      }
    : addDocument(workspace, created);

  followWorkspace();
  void withBridge((bridge) =>
    kind === undefined
      ? request(bridge, created.id, opened.text)
      : validateAppFile(bridge, created.id),
  );
  void refreshRecent();
}

/** The files of the app's own a tab can hold (TYTO-206, TYTO-207, TYTO-277). */
type AppFile = NonNullable<DocumentState['kind']>;

/** Asks main to open one of the app's files into the tab `documentId`. */
const openAppFileIn = (bridge: TytoBridge, kind: AppFile, documentId: string) => {
  switch (kind) {
    case 'settings':
      return bridge['settings:open']({ documentId });
    case 'keybindings':
      return bridge['keybindings:open']({ documentId });
    case 'snippets':
      return bridge['snippets:open']({ documentId });
  }
};

const isSettings = (document_: DocumentState): boolean => document_.kind === 'settings';

/**
 * Opens `settings.json`, `keybindings.json` or `snippets.json` in a tab. One tab each: asking
 * again brings it forward rather than opening a second buffer over the same file.
 */
function openAppFile(kind: AppFile): void {
  void withBridge(async (bridge) => {
    const open = workspace.documents.find((document_) => document_.kind === kind);
    if (open !== undefined) {
      activate(open.id);
      return;
    }
    const wanted = nextDocumentId();
    const answer = await openAppFileIn(bridge, kind, wanted);
    adopt(answer.document, answer.documentId, wanted, kind);
  });
}

/** Checks an app file's tab: settings by main, keybindings and snippets here. */
function validateAppFile(bridge: TytoBridge, documentId: string): Promise<void> {
  const target = documentOf(workspace, documentId);
  if (target?.kind === 'keybindings') {
    validateKeybindings(documentId);
    return Promise.resolve();
  }
  if (target?.kind === 'snippets') {
    validateSnippets(documentId);
    return Promise.resolve();
  }
  return validateSettings(bridge, documentId);
}

/**
 * A document's diagnostics replaced; the status bar counts them with the window's own rows.
 *
 * And underlined in the buffer since TYTO-256, as a brief's are. The tab has no linter of its
 * own — settings are checked in main — so the markers are pushed: into the pane when the tab is
 * in front, into its stored state when it is not. Only while the buffer still holds the text
 * that was checked: an answer about older text would land on the wrong characters, and the
 * check of the newer text is already on its way.
 */
function setFileDiagnostics(
  documentId: string,
  text: string,
  diagnostics: readonly Diagnostic[],
): void {
  workspace = updateDocument(workspace, documentId, (document_) => ({
    ...document_,
    diagnostics,
    brief: text,
  }));
  const target = documentOf(workspace, documentId);
  if (target?.state !== undefined && contentOf(target) === text) {
    // Every pane that shows it, in any group (TYTO-286): the primary's tells the store in
    // `onUpdate`; not `onChange`, so no loop. A follower's markers are its own to draw.
    const showing = [...shownIn]
      .filter(([, shown]) => shown === documentId)
      .flatMap(([groupId]) => panes.get(groupId) ?? []);
    for (const each of showing) each.showDiagnostics(diagnostics);
    if (showing.length === 0) {
      const marked = withDiagnostics(target.state, diagnostics);
      workspace = updateDocument(workspace, documentId, (document_) => ({
        ...document_,
        state: marked,
      }));
    }
  }
  if (documentId === active().id) repaint();
}

/**
 * The keybindings tab's buffer, checked by the same resolver the table is built with
 * (TYTO-207, ADR 0074): its syntax, and every entry against the registry, the contexts and the
 * layers under it. Shown as the tab's own problems, at each entry's range. Nothing here
 * applies the buffer: only a save does, through the watcher.
 */
function validateKeybindings(documentId: string): void {
  const target = documentOf(workspace, documentId);
  if (target === undefined) return;
  const text = contentOf(target);
  const read = readKeybindingsText(text);
  const found = [...read.syntax, ...userKeybindingProblems(read.entries)];
  setFileDiagnostics(
    documentId,
    text,
    found.map((item) => ({
      severity: item.severity,
      code: item.code,
      message: item.message,
      ...(item.range === undefined ? {} : { range: item.range }),
      ...(item.hint === undefined ? {} : { hint: item.hint }),
    })),
  );
}

/** The table as it stands, with `user` as the person's layer. */
function resolveWith(user: readonly KeybindingEntry[]) {
  return resolveKeybindings({
    builtIn: builtInKeybindings,
    plugins: pluginKeybindings,
    user,
    commands: new Set(registry.list().map((command) => command.id)),
    platform: state.platform,
  });
}

/**
 * What the resolver says about the person's entries alone. The plugin layers resolve first
 * and the same way whatever the user layer holds, so their diagnostics are the leading ones
 * and the rest are the person's.
 */
function userKeybindingProblems(entries: readonly KeybindingEntry[]) {
  const below = resolveWith([]).diagnostics.length;
  return resolveWith(entries).diagnostics.slice(below);
}

/**
 * `keybindings.json`'s text, at load and on every change on disk, as the user layer.
 *
 * A text with a syntax error changes nothing: the last layer that read stays in effect (or
 * none), so a file saved half-way through an edit cannot take every key the person had
 * bound away. The error goes to the log, and to the problems panel when the tab is open.
 */
function readUserKeybindings(bridge: TytoBridge, text: string): void {
  const read = readKeybindingsText(text);
  if (read.syntax.length > 0) {
    for (const problem of read.syntax) {
      void bridge['log:write']({
        level: 'warn',
        message: `keybindings.json: ${problem.message}`.slice(0, 200),
      });
    }
    return;
  }
  userKeybindings = read.entries;
  applyKeybindings(bridge);
}

/** `keybindings:changed`: the file moved on disk, saved from its tab or from anywhere. */
function keybindingsChanged(bridge: TytoBridge, text: string): void {
  readUserKeybindings(bridge, text);
  const tab = workspace.documents.find((document_) => document_.kind === 'keybindings');
  if (tab === undefined) return;
  // A clean tab follows the disk, as the settings tab does; unsaved typing is kept.
  if (!isUnsaved(tab) && contentOf(tab) !== text) {
    replaceSettingsText(tab.id, text, undefined);
    workspace = updateDocument(workspace, tab.id, (document_) => ({
      ...document_,
      savedText: contentOf(document_),
    }));
  }
  validateKeybindings(tab.id);
}

/**
 * The snippets tab's buffer, read as the file would be (TYTO-277, ADR 0082): its syntax, every
 * entry left out or flattened, and each template filter against the window's template list.
 * Shown as the tab's own problems at their ranges; only a save applies it, through the watcher.
 */
function validateSnippets(documentId: string): void {
  const target = documentOf(workspace, documentId);
  if (target === undefined) return;
  const text = contentOf(target);
  const read = readSnippetsText(text, state.templates);
  setFileDiagnostics(
    documentId,
    text,
    [...read.syntax, ...read.problems].map((item) => ({
      severity: item.severity,
      code: item.code,
      message: item.message,
      ...(item.range === undefined ? {} : { range: item.range }),
      ...(item.hint === undefined ? {} : { hint: item.hint }),
    })),
  );
}

/**
 * `snippets.json`'s text, at load and on every change on disk. A text with a syntax error
 * changes nothing, as `keybindings.json`'s does not: the snippets that last read stay offered.
 */
function readUserSnippets(bridge: TytoBridge, text: string): void {
  const read = readSnippetsText(text);
  if (read.syntax.length > 0) {
    for (const problem of read.syntax) {
      void bridge['log:write']({
        level: 'warn',
        message: `snippets.json: ${problem.message}`.slice(0, 200),
      });
    }
    return;
  }
  userSnippets = read.snippets;
}

/** `snippets:changed`: the file moved on disk; a clean tab follows it, as keybindings' does. */
function snippetsChanged(bridge: TytoBridge, text: string): void {
  readUserSnippets(bridge, text);
  const tab = workspace.documents.find((document_) => document_.kind === 'snippets');
  if (tab === undefined) return;
  if (!isUnsaved(tab) && contentOf(tab) !== text) {
    replaceSettingsText(tab.id, text, undefined);
    workspace = updateDocument(workspace, tab.id, (document_) => ({
      ...document_,
      savedText: contentOf(document_),
    }));
  }
  validateSnippets(tab.id);
}

/**
 * The settings tab's buffer, checked by main against what the plugins declared (TYTO-206).
 *
 * Its problems go where a brief's go — the document's own diagnostics, shown in the problems
 * panel with the text their ranges index. Whether the tab is unsaved travels with it, which is
 * how main knows to put a screen's change into this buffer rather than onto the disk.
 */
async function validateSettings(bridge: TytoBridge, documentId: string): Promise<void> {
  const target = documentOf(workspace, documentId);
  if (target === undefined) return;
  const text = contentOf(target);
  const { diagnostics } = await bridge['settings:validate']({
    documentId,
    text,
    dirty: isUnsaved(target),
  });
  setFileDiagnostics(documentId, text, diagnostics);
}

/** {@link validateAppFile} on the pause the preview compiles on. */
function askAppFile(bridge: TytoBridge, documentId: string): void {
  const existing = pending.get(documentId);
  if (existing !== undefined) clearTimeout(existing);
  pending.set(
    documentId,
    setTimeout(() => {
      pending.delete(documentId);
      void validateAppFile(bridge, documentId);
    }, PREVIEW_DELAY),
  );
}

/**
 * Puts text main sent into the settings tab: a screen's change while it had unsaved typing,
 * or the disk followed while it had none (ADR 0073, decision 8).
 *
 * One change over the span that differs, so the caret and the undo history survive it and an
 * undo takes the screen's change back out. `base` is the buffer main edited, which keystrokes
 * since its last check are moved past (`rebaseEdit`).
 */
function replaceSettingsText(documentId: string, text: string, base: string | undefined): void {
  const target = documentOf(workspace, documentId);
  if (target?.state === undefined) return;
  const current = contentOf(target);
  if (current === text) return;
  const changes = rebaseEdit(base ?? current, current, text);
  // Through the pane holding the record when any group shows it (TYTO-286), so a follower is
  // given the change too.
  const primary = primaryPaneOf(documentId);
  if (primary !== undefined) {
    primary.view.dispatch({ changes });
    return;
  }
  workspace = updateDocument(workspace, documentId, (document_) => ({
    ...document_,
    state: document_.state?.update({ changes }).state,
  }));
}

/** `settings:changed`: the file moved, a screen wrote it, or a screen's change was refused. */
async function settingsChanged(
  bridge: TytoBridge,
  change: IpcEventPayload<'settings:changed'>,
): Promise<void> {
  const tab = workspace.documents.find(isSettings);
  if (tab !== undefined && change.text !== undefined) {
    if (!(change.saved && isUnsaved(tab))) {
      replaceSettingsText(tab.id, change.text, change.base);
      if (change.saved) {
        workspace = updateDocument(workspace, tab.id, (document_) => ({
          ...document_,
          savedText: contentOf(document_),
        }));
      }
    } else if (change.text !== tab.savedText) {
      // New text on disk under typing: a screen's write main made before it heard the tab
      // was dirty, or another editor's save. The typing moves onto it rather than either
      // being dropped, and the tab stays unsaved over the new disk text (TYTO-255). Equal to
      // `savedText` is this tab's own save coming back through the watcher: nothing moved.
      replaceSettingsText(tab.id, change.text, change.base ?? tab.savedText);
      const onDisk = change.text;
      workspace = updateDocument(workspace, tab.id, (document_) => ({
        ...document_,
        savedText: onDisk,
      }));
    }
    void validateSettings(bridge, tab.id);
  }
  // Refused because the file does not parse: the tab is where that is shown, at the error.
  if (change.refused) runCommand(SETTINGS_OPEN);
  // The `theme` setting may be what moved (TYTO-208); main has already set the mode.
  showTheme(bridge, () => bridge['theme:current']({}));
  const chosen = await bridge['templates:folder']({});
  state.templatesFolder = chosen.folder;
  state.templatesFound = chosen.found;
  await refreshTemplates(bridge);
  repaint();
}

/**
 * Rebuilds the recent list as commands, which is the whole of its user interface.
 *
 * A palette entry per file rather than a menu or a panel: E9.12 already built the list a
 * person types into, the entries are ten strings, and a second surface for them would be a
 * second place to keep in step. It also means the list is reachable with no panel open,
 * which is the property a recent list most needs on an app that opens empty.
 */
async function refreshRecent(): Promise<void> {
  await withBridge(async (bridge) => {
    const answer = await bridge['files:recent']({});

    for (const dispose of recentCommands) dispose();
    recentCommands = answer.files.map((file) =>
      registry.register({
        id: recentCommandId(file.path),
        // The file's own name, untranslated. `commandEntries` puts the catalogue's word in
        // front of it at display time, so switching language does not need a re-register.
        label: file.name,
        run: () => {
          // The name travels with the call rather than being cut out of the path here.
          // Splitting a path is the one thing this renderer must never learn to do — it is
          // the reason main holds the path at all — and the name is already in hand.
          void reopen(file.path, file.name);
        },
      }),
    );

    paintCommandBar();
  });
}

/**
 * Reopens a recent entry, and says so in the panel when the file has moved.
 *
 * The diagnostic goes where every other "why is this not working" goes — the problems panel
 * — rather than into a dialog. It is the same question as an unreadable template folder and
 * it belongs beside it, which is what `panel.installation` already is.
 */
async function reopen(path: string, name: string): Promise<void> {
  await withBridge(async (bridge) => {
    const wanted = nextDocumentId();
    const answer = await bridge['file:reopen']({ documentId: wanted, path });

    if (answer.missing) {
      // Minted in the window and not in main because the window owns the locale. A code
      // minted here is not in core's catalogue, so it goes in the "Codes the desktop window
      // mints" section of docs/diagnostic-codes.md (tools/docs-gen/src/desktop-codes.ts);
      // tools/repo-checks fails until it does (TYTO-141).
      const row: Diagnostic = {
        severity: 'error',
        code: FILE_NOT_FOUND,
        message: `${translate(state.locale, 'file.missing')}: ${name}`,
      };
      rowSubjects.set(row, path);
      panel.installation = [
        row,
        ...panel.installation.filter((item) => item.code !== FILE_NOT_FOUND),
      ];
      raiseWindowProblem();
      repaint();
      // Listed again, so an entry that is gone is marked gone rather than looking untried.
      void refreshRecent();
      return;
    }

    // The file is back where the recent list says, so the row saying it was gone is not true
    // any more (TYTO-260). Only a row raised here knows its path: the session's missing rows
    // name a file the window was never told the path of (ADR 0080).
    clearWindowProblem(FILE_NOT_FOUND, path);
    adopt(answer.document, answer.documentId, wanted);
    repaint();
  });
}

/** The faces and sizes the window last applied (TYTO-272); the defaults until main answers. */
let typography: Typography = DEFAULT_TYPOGRAPHY;

/**
 * After the sheet carries a new `typography`: every editor pane, and the template mode's two
 * once it is loaded, re-reads its line height and character width — the indent guides and the
 * pinned head lines are drawn from them — and the problems panel gets a row per family the
 * machine lacks. Nothing happens when the answer did not move them, which is most answers.
 */
function showTypography(next: Typography): void {
  const moved = JSON.stringify(next) !== JSON.stringify(typography);
  typography = next;
  if (moved) {
    editor?.remeasure();
    if (customElements.get(TEMPLATE_MODE_TAG) !== undefined && elements.templateMode) {
      elements.templateMode.remeasureText();
    }
  }
  panel.installation = withFontRows(
    panel.installation,
    missingFamilyRows(next, canvasMeasure(), translate(state.locale, 'typography.familyMissing')),
  );
}

/** Theme answers apply in the order they were asked: one that arrives late is dropped. */
let themeTurn = 0;
/** The themes on show, as main last answered: what the theme picker highlights first. */
let themeShown: IpcResponse<'theme:current'> | undefined;

/**
 * Applies a theme answer from main (TYTO-208): the colours, and the problems reading the
 * themes raised, which replace the previous answer's rows in the problems panel. The picker
 * asks on every move, so an older answer arriving after a newer one is not applied.
 */
function showTheme(bridge: TytoBridge, ask: () => Promise<IpcResponse<'theme:current'>>): void {
  themeTurn += 1;
  const turn = themeTurn;
  void ask().then(
    (applied) => {
      if (turn !== themeTurn) return;
      themeShown = applied;
      applyTheme(applied);
      // The bar's items ride on the theme answer, so a save of the setting repaints it live.
      statusBarItems = applied.statusBarItems;
      // And so does how vim's mode is drawn (TYTO-301).
      vimModeStyle = applied.vimModeStyle;
      // And whether the editors draw indent guides (TYTO-293): every tab, and the template mode.
      indentGuides = applied.indentGuides;
      editor?.setIndentGuides(indentGuides);
      // And whether they pin the head line of the block at the top (TYTO-295), the same way.
      stickyScroll = applied.stickyScroll;
      editor?.setStickyScroll(stickyScroll);
      // And the indent width (TYTO-297): what Tab inserts, the guides' step and Format Brief's
      // indent, in every tab and the template mode. Format-on-save is read at the next save.
      tabSize = applied.tabSize;
      editor?.setTabSize(tabSize);
      formatBriefOnSave = applied.formatBriefOnSave;
      // And how a brief's `|` columns are drawn (TYTO-298), in every tab. The template mode holds
      // no brief buffer, so it is not told.
      briefColumns = applied.briefColumns;
      editor?.setBriefColumns(briefColumns);
      // And the faces and sizes (TYTO-272), which the sheet above already holds: CodeMirror
      // watches no custom property, so every pane re-reads its text's size, and a face this
      // machine does not have is said in the problems panel.
      showTypography(applied.typography);
      // Only once it is loaded, as with the locale: `loadTemplateMode` hands it the value then.
      if (customElements.get(TEMPLATE_MODE_TAG) !== undefined && elements.templateMode) {
        elements.templateMode.showIndentGuides(indentGuides);
        elements.templateMode.showStickyScroll(stickyScroll);
        elements.templateMode.showTabSize(tabSize);
      }
      panel.installation = withThemeRows(panel.installation, applied.diagnostics);
      repaint();
    },
    (cause: unknown) => {
      // A window whose theme never arrives keeps the colours it has, which are a theme's.
      void bridge['log:write']({
        level: 'warn',
        message: 'The colour theme could not be applied; the colours on screen stay.',
        detail: String(cause).slice(0, 4000),
      });
    },
  );
}

const THEME_KIND_LABEL = { light: 'theme.kind.light', dark: 'theme.kind.dark' } as const;
const THEME_VARIANT_LABEL = {
  original: 'theme.variant.original',
  adjusted: 'theme.variant.adjusted',
} as const;

/**
 * "Preferences: Color Theme" (TYTO-208): every theme in the bar, the one on show highlighted.
 * Moving the selection previews the highlighted theme, Enter writes it to the `theme` setting
 * through main, and Escape goes back to the setting — all three answered by main with the
 * colours that now apply.
 */
async function pickTheme(): Promise<void> {
  await withBridge(async (bridge) => {
    const bar = elements.commandBar;
    if (bar === null) return;
    const { themes } = await bridge['theme:list']({});
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    const selected = dark ? themeShown?.dark.id : themeShown?.light.id;
    bar.pick({
      entries: themes.map((theme) => ({
        id: theme.id,
        label: theme.label,
        // ADR 0089: the pack's original and adjusted twins share a name but for the suffix,
        // so the detail line says which colours each one is, beside its kind.
        detail: [
          translate(state.locale, THEME_KIND_LABEL[theme.kind]),
          ...(theme.variant === undefined
            ? []
            : [translate(state.locale, THEME_VARIANT_LABEL[theme.variant])]),
        ].join(' · '),
      })),
      placeholder: translate(state.locale, 'theme.pick.placeholder'),
      ...(selected === undefined ? {} : { selected }),
      highlight: (id) => {
        showTheme(bridge, () => bridge['theme:preview']({ id }));
      },
      choose: (id) => {
        showTheme(bridge, () => bridge['theme:choose']({ id }));
      },
      cancel: () => {
        showTheme(bridge, () => bridge['theme:preview']({ id: null }));
      },
    });
  });
}

/**
 * "New brief from template…" (TYTO-275): every template in the bar, with the folder it came from
 * and its description beside the name, and the chosen one's skeleton in a new tab.
 *
 * The rows are the template picker's, as `templates:list` last answered — on load and on every
 * folder change — so the bar and the picker cannot list different templates, and nothing is
 * asked of main while the bar is open. Nothing is previewed while the selection moves: a
 * skeleton is text, and the tab it would go in does not exist until the choice.
 */
function pickTemplate(): void {
  const bar = elements.commandBar;
  if (bar === null) return;
  bar.pick({
    entries: panel.templates.map((template) => ({
      id: template.name,
      label: template.name,
      detail: [
        template.root ?? translate(state.locale, 'template.root.builtIn'),
        template.description,
      ]
        .filter((part): part is string => part !== undefined)
        .join(' · '),
    })),
    placeholder: translate(state.locale, 'template.pick.placeholder'),
    highlight: () => undefined,
    choose: (name) => {
      openSkeleton(name);
    },
    cancel: () => undefined,
  });
}

/**
 * Format Brief in one pane (TYTO-297, ADR 0096): one undoable change, the caret kept on its
 * text. A brief with a syntax error is left as it is and the status bar says why for a few
 * seconds — the problems panel already lists where. `false` when it refused.
 */
function formatPane(pane: EditorPane): boolean {
  const result = formatBriefInView(pane.view);
  if (result.ok) return true;
  showNotice('formatBrief.refused');
  return false;
}

/** How long a notice stays in the status bar (TYTO-297). */
const NOTICE_MS = 6000;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A sentence in the status bar for a few seconds (TYTO-297): what a command that did nothing
 * has to say. `role="status"`, so a screen reader hears it without the focus moving.
 */
function showNotice(key: CatalogueKey): void {
  const notice = elements.statusNotice;
  if (notice === null) return;
  notice.textContent = translate(state.locale, key);
  notice.hidden = false;
  if (noticeTimer !== undefined) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.hidden = true;
    notice.textContent = '';
    noticeTimer = undefined;
  }, NOTICE_MS);
}

/**
 * "Go to Block…" (TYTO-296): the focused pane's blocks in the bar, in document order, VS Code's
 * "Go to Symbol in Editor". The highlighted block is shown as the selection moves, Enter leaves
 * the caret on its `::`, and Escape puts back the selection and the scroll the pane had.
 *
 * The ids are offsets, so the bar matches the labels alone (`matchIds: false`): "2" finds
 * `::lamina 2` and not the block at 1234. The list opens on the block the caret is in, or the
 * last one above it, which is already on screen and is not previewed again.
 */
function pickBlock(): void {
  const bar = elements.commandBar;
  const target = focusedPane();
  if (bar === null || target === undefined) return;
  const view = target.view;
  const blocks = blocksOf(view.state);
  const before = view.state.selection;
  const scroll = view.scrollSnapshot();
  const caret = before.main.head;
  const current =
    blockAt(blocks, caret) ?? [...blocks].reverse().find((block) => block.from <= caret);
  const show = (id: string, focus: boolean): void => {
    const from = Number(id);
    if (focus) revealRange(view, { start: from, end: from });
    else previewBlock(view, from);
  };
  bar.pick({
    entries: blocks.map((block) => ({
      id: String(block.from),
      label: blockLabel(block),
      ...(block.firstText === undefined ? {} : { detail: block.firstText }),
    })),
    placeholder: translate(state.locale, 'goToBlock.placeholder'),
    ...(current === undefined ? {} : { selected: String(current.from) }),
    matchIds: false,
    highlight: (id) => {
      show(id, false);
    },
    choose: (id) => {
      show(id, true);
    },
    cancel: () => {
      view.dispatch({ selection: before, effects: scroll });
      view.focus();
    },
  });
}

/** `::lamina 2`, `::ai/caption`, or the frontmatter's word in the window's language. */
function blockLabel(block: BriefBlock): string {
  if (block.kind === 'frontmatter') return translate(state.locale, 'goToBlock.header');
  return directiveLabel(block);
}

/** Between the parts of a breadcrumb, as VS Code's: `cabeçalho › template`. */
const BREADCRUMB_SEPARATOR = ' › ';

/**
 * What a group's header row says (TYTO-273, ADR 0098): the block the caret of **that group's
 * pane** is in — each group its own, a follower's caret too, as VS Code does. Empty for a
 * preview in front, for the app's own files (a JSON tab is no brief) and with the caret outside
 * every block. Template mode has its own editors and no groups, so it never asks.
 */
function breadcrumbText(groupId: string): string {
  const group = groupById(groups, groupId);
  const front = group === undefined ? undefined : activeTabOf(group);
  if (front === undefined || isPreview(front)) return '';
  if (documentOf(workspace, front.documentId)?.kind !== undefined) return '';
  const pane_ = panes.get(groupId);
  // A pane that has not taken the tab in front yet still holds the last one's state.
  if (pane_ === undefined || shownIn.get(groupId) !== front.documentId) return '';
  const crumb = breadcrumbOf(pane_.state());
  if (crumb === undefined) return '';
  if (crumb.kind === 'directive') return crumb.label;
  const word = translate(state.locale, 'breadcrumb.frontmatter');
  return crumb.key === undefined ? word : `${word}${BREADCRUMB_SEPARATOR}${crumb.key}`;
}

/**
 * Writes a group's breadcrumb, only when its text changed: this runs on every transaction of
 * every pane, and a caret move inside one block changes nothing on screen.
 */
function paintBreadcrumb(groupId: string): void {
  const element = groupElements.get(groupId);
  if (element === undefined) return;
  const text = breadcrumbText(groupId);
  if (element.breadcrumb !== text) element.breadcrumb = text;
}

/**
 * A new tab holding `name`'s skeleton, with its first field selected (TYTO-275).
 *
 * The tab is added the way New adds one — never substituted, for New's reason — and the skeleton
 * goes in as an edit once the tab is in front, so the fields are a live snippet in that tab's own
 * state and Ctrl+Z takes the whole skeleton back to the empty tab.
 */
function openSkeleton(name: string): void {
  if (editor === undefined || !panel.templates.some((template) => template.name === name)) return;
  workspace = addDocument(workspace, newDocument(nextDocumentId(), editor.blank('')));
  followWorkspace();
  insertSkeleton(name);
}

/**
 * Replaces the text in the editor with `name`'s skeleton and focuses its first field. The
 * manifest is the picker's row: the formats go by id, which is what a brief writes.
 */
function insertSkeleton(name: string): void {
  const template = panel.templates.find((candidate) => candidate.name === name);
  const target = focusedPane();
  if (template === undefined || target === undefined) return;
  insertBriefSkeleton(target.view, {
    name: template.name,
    formats: template.formats.map((format) => format.id),
    slots: template.slots,
  });
  target.view.focus();
}

/**
 * The templates in the "/" menu (TYTO-276): the picker's rows as `templates:list` last answered,
 * each saying what choosing it does to the brief in front. On a brief with nothing but the "/"
 * the skeleton goes in, as the picker does; on one with content, `template:` switches and the
 * "/" goes in the same transaction, so one Ctrl+Z takes both back.
 */
const templatesSlashSource = (): SlashSource => ({
  // A getter, so the heading is in the window's language each time the menu opens.
  get section() {
    return translate(state.locale, 'slash.section.templates');
  },
  items: (editorState, from, to) => {
    const text = editorState.doc.toString();
    return panel.templates.map((template) => ({
      label: template.name,
      detail: slashNoteText(slashTemplateNote(text, from, to, template.name)),
      apply: (view, start, end) => {
        const choice = slashTemplateChoiceFor(
          active().kind,
          view.state.doc.toString(),
          start,
          end,
          template.name,
        );
        if (choice === undefined) return;
        if (choice.kind === 'skeleton') {
          insertSkeleton(template.name);
          return;
        }
        view.dispatch({ changes: choice.changes, userEvent: 'input.complete' });
      },
    }));
  },
});

const slashNoteText = (note: SlashTemplateNote): string => {
  const text = translate(state.locale, note.key);
  return note.key === 'slash.template.switch' ? text.replace('{current}', note.current) : text;
};

/**
 * The picker's rows and the installation problems, from one answer (TYTO-122).
 *
 * Lifted out of {@link load} so that opening the window and changing the folder are the same
 * code rather than two that have to be kept in step — the second is exactly where a list that
 * silently did not reload would have hidden.
 *
 * `panel.installation` is **rebuilt and never appended to**, which is the card's fifth
 * criterion in its literal form: clearing the folder has to make the "this folder has no
 * templates" row go away without a restart, and a list that accumulated could not. **Except
 * the rows a person's own action raised** — a failed save, a recent file gone — which this
 * read knows nothing about and must not drop (TYTO-143): dropping them left the "new" dot
 * pointing at nothing.
 *
 * `raise` is false only for the read at startup: nobody did anything yet, the layout that
 * says whether the panel is on screen has not been read, and a folder that was empty last
 * session is not news.
 */
async function refreshTemplates(bridge: TytoBridge, raise = true): Promise<void> {
  const answer = await bridge['templates:list']({});
  panel.templates = answer.templates;
  state.templates = answer.templates.map((template) => template.name);

  // A folder that meant to be a template and is broken is why a template is missing from the
  // picker, and nothing else in the app would ever say so: the preview service replays the
  // registry's warnings and these are not among them.
  const wasEmpty = panel.installation.some((item) => item.code === TEMPLATE_FOLDER_EMPTY);
  panel.installation = [
    ...carriedAcrossTemplateRead(panel.installation),
    ...answer.failures.flatMap((failure) => failure.diagnostics),
    // Minted here and not in main, the way `E_FILE_NOT_FOUND` is: main can tell that a folder
    // produced nothing, and only the window knows which language to say it in. Listed under
    // "Codes the desktop window mints" in docs/diagnostic-codes.md, as every code minted in
    // this window must be (TYTO-141).
    ...(state.templatesFolder !== null && state.templatesFound === 0
      ? [
          {
            severity: 'warning' as const,
            code: TEMPLATE_FOLDER_EMPTY,
            message: `${translate(state.locale, 'templates.folder.empty')}: ${state.templatesFolder}`,
          },
        ]
      : []),
  ];
  // The empty-folder row is made again on every read, so only its first appearance is new.
  const isEmpty = panel.installation.some((item) => item.code === TEMPLATE_FOLDER_EMPTY);
  if (raise && isEmpty && !wasEmpty) raiseWindowProblem();
}

/**
 * Points the app at a folder of templates, or clears the choice (TYTO-122).
 *
 * The picker and the disk are main's — every read still happens there (ADR 0010) — so what
 * this does is ask, remember what came back, and then re-ask the one channel that already
 * feeds both the picker and the problems panel.
 */
async function setTemplateFolder(choose: boolean): Promise<void> {
  await withBridge(async (bridge) => {
    const answer = await bridge['templates:set-folder']({ choose });
    state.templatesFolder = answer.folder;
    state.templatesFound = answer.found;
    await refreshTemplates(bridge);
    repaint();
  });
}

/**
 * Closing a tab, which is the one thing in this window that asks before it acts.
 *
 * The question is main's dialog and not the renderer's `confirm()`: the buttons have to be
 * in the language the window is in (`shared/ipc.ts`). With no bridge there is no disk to
 * lose anything to, so the answer is yes — a unit test driving this must not hang on a
 * dialog that cannot appear.
 */
async function requestClose(id: string): Promise<void> {
  const target = documentOf(workspace, id);
  if (target === undefined) return;

  if (isUnsaved(target)) {
    const bridge = window.tyto;
    if (bridge !== undefined) {
      const answer = await bridge['dialog:confirm']({
        message: translate(state.locale, 'document.discard.message'),
        // The settings tab loses only its typing: a screen's change it held reaches the file
        // when it closes (TYTO-255).
        detail: `${labelOf(target)}: ${translate(
          state.locale,
          isSettings(target) ? 'document.discard.settingsDetail' : 'document.discard.detail',
        )}`,
        confirm: translate(state.locale, 'document.discard.confirm'),
        cancel: translate(state.locale, 'document.discard.cancel'),
      });
      if (!answer.confirmed) return;
    }
  }

  closeTab(id);
}

/**
 * Writes one tab, asking for a name when it has none, and says how it went (TYTO-124, TYTO-153).
 *
 * **Taken out of the Save command and given a document id**, because the quit question now
 * saves tabs that are not in front: `contentOf` answers for any document in the workspace —
 * the state is the store's since TYTO-115 — so nothing has to be activated first, and nobody
 * watches the app flick through three tabs on its way out.
 *
 * **It answers rather than throwing, which is the one behaviour this card changed here.** The
 * rejection used to be re-thrown so `installErrorReporting` would file it; a failed save is an
 * *answer* now — it cancels the quit — and a caller that has to know cannot be handed an
 * exception to let past. The log line is still written, by `reportToLog` and directly.
 */
async function saveOneDocument(
  bridge: TytoBridge,
  documentId: string,
  saveAs: boolean,
): Promise<SaveOutcome> {
  const target = documentOf(workspace, documentId);
  if (target === undefined) return 'failed';

  // **The one call in this file that is caught** (TYTO-124). A full disk, a folder gone
  // read-only, a path that vanished under a save-as: `file:save` rejects, and until that
  // card the rejection went to `installErrorReporting`, which writes it to a log file the
  // person has no reason to open. The unsaved marker stayed lit — true, and silent.
  //
  // Caught here rather than in `withBridge` on purpose. The other twelve callers reject
  // for reasons a person did not ask for and cannot act on; this one is the answer to a
  // key somebody just pressed about text they would lose.
  let answer: IpcResponse<'file:save'>;
  try {
    answer = await bridge['file:save']({
      documentId,
      // The workspace's text and not the pane's, which is what makes this a call about a tab
      // that need not be in front — and what the quit question relies on.
      text: contentOf(target),
      saveAs,
    });
  } catch (cause) {
    // Rebuilt and not appended to, the way `E_FILE_NOT_FOUND` above is: a second failed
    // save is the same problem said again, not a second problem.
    const row = saveFailureDiagnostic(state.locale, target.name, cause);
    // Keyed by the tab and not by a path: a save-as that failed has no path, and the row means
    // "this tab's text is not on disk", which is what the next good save of this tab undoes.
    rowSubjects.set(row, documentId);
    panel.installation = [row, ...panel.installation.filter((item) => item.code !== SAVE_FAILED)];
    // A second identical failure lights the dot again: it answers a second key press.
    raiseWindowProblem();
    repaint();
    // The sentence on screen is for the person, and the line in the log is for whoever reads
    // their report. Both, and no exception left travelling.
    reportToLog(bridge, cause, 'save failed');
    return 'failed';
  }

  // A dismissed dialog leaves everything alone, the unsaved marker included. There is
  // nothing to clear now — the marker is a comparison — but there is something not to
  // move: taking `savedText` forward here would tell somebody their text was written
  // when it was not.
  if (answer.document === null) return 'dismissed';

  const { name, pathLabel, text: written } = answer.document;
  workspace = updateDocument(workspace, documentId, (document_) => ({
    ...document_,
    name,
    // A save-as can put the file somewhere else, so the tooltip follows the answer.
    pathLabel,
    // **What main says it wrote**, and not the string sent up or the buffer as it now
    // stands. A save-as puts a dialog in front of somebody who can go on typing behind
    // it, so the text at the end of this round trip is not always the text at the start
    // of it; taking the buffer here would call those extra characters saved. The old
    // `dirty: false` did exactly that (TYTO-112).
    savedText: written,
  }));

  // A save-as onto a file another tab had open: main gave the path to this tab and took
  // it off that one, and the strip has to say so (TYTO-104). What that costs the other
  // tab is `releaseDocument`'s to say.
  //
  // The `!== documentId` guard is defence and not logic: main already answers with the
  // tab that let go, never with the one that asked. Were it ever to answer with this
  // one, the two lines above would name the tab and this one would immediately take the
  // name back off it — a bug that looks like a repaint.
  if (answer.released !== null && answer.released !== documentId) {
    workspace = releaseDocument(workspace, answer.released);
  }

  // Written, so a failure this tab's last save left in the panel is not true any more
  // (TYTO-260). Before, it stayed — and counted — until the next failure or a restart.
  clearWindowProblem(SAVE_FAILED, documentId);
  repaint();
  void refreshRecent();
  // Saved, so main stops routing a screen's change into this buffer (TYTO-206).
  if (isSettings(target)) void validateSettings(bridge, documentId);
  return 'saved';
}

/**
 * The same question about the whole window, asked because main asked first (TYTO-123).
 *
 * This is the only thing in the renderer that main starts, and the shape is the reason it
 * reads so much like `requestClose` above: main cannot count the unsaved tabs — `isUnsaved`
 * is a comparison over a workspace that lives here (ADR 0026) — and it cannot pick the
 * language, which the footer picker changes at runtime and main was told once at startup. So
 * it pushes `app:exit-requested` and this answers on `app:exit-answer` (ADR 0029).
 *
 * **The `try`/`finally` is load-bearing, and it is more so since TYTO-147.** The
 * acknowledgement its caller already sent bought this function unlimited time, which means an
 * answer that never goes back now leaves main holding a prevented quit **with no deadline at
 * all** — until the window dies (ADR 0031). So a throw anywhere above — a dialog that rejects,
 * a locale key that is missing — must still release the app. The default is `false`: a failure
 * to ask is not permission to discard.
 */
async function answerExitRequest(bridge: TytoBridge, askId: number): Promise<void> {
  let allow = false;
  try {
    allow = await resolveExit({
      // Hot exit (TYTO-113, ADR 0080): the drafts are kept for the next launch — the template
      // mode's too since TYTO-266 — and the box is left for a session the disk refused.
      keep: () => keepSession(true),
      unsaved: (kept) =>
        kept
          ? []
          : [
              ...workspace.documents.filter(isUnsaved).map((document_) => document_.id),
              // The template mode's two buffers, as one entry: the box counts things a person
              // would lose, and a template is one thing (TYTO-44).
              ...(elements.templateMode?.unsaved === true ? [TEMPLATE_MODE_ID] : []),
            ],

      ask: async (count) => {
        const detail = translate(
          state.locale,
          count === 1 ? 'exit.save.detail.one' : 'exit.save.detail.many',
        ).replace('{n}', String(count));

        // A channel of its own and not `dialog:confirm`, because the answer is not a boolean
        // and the two boxes disagree about which button is safe (`shared/ipc.ts`, TYTO-153).
        const answer = await bridge['dialog:save-changes']({
          message: translate(state.locale, 'exit.save.message'),
          detail,
          save: translate(state.locale, 'exit.save.confirm'),
          discard: translate(state.locale, 'exit.save.discard'),
          cancel: translate(state.locale, 'exit.save.cancel'),
        });
        return answer.answer;
      },

      // `saveAs: false`, so a tab that already has a file is written where it lives and only
      // a tab with no path gets a picker. `documents.save` is where that fallback is, and it
      // has been there since E9.8 — which is most of why this card is an M.
      save: async (documentId) => {
        if (documentId !== TEMPLATE_MODE_ID) return saveOneDocument(bridge, documentId, false);
        // A manifest that does not parse is refused, and a refused save is a failed one: the
        // quit is cancelled with the reason on screen, which is ADR 0034's rule for any save.
        const saved = (await elements.templateMode?.save()) ?? false;
        return saved ? 'saved' : 'failed';
      },
    });
  } finally {
    // Before the yes is sent: main closes the window the moment it arrives (TYTO-250).
    if (allow) pageClose?.release();
    await bridge['app:exit-answer']({ askId, allow });
  }
}

/** The veto on this page's own close, released by a yes above (TYTO-250). */
let pageClose: { readonly release: () => void } | undefined;

/**
 * The two fields of a Navigation API `NavigateEvent` that `holdPageClose` reads (TYTO-250).
 * Written out because the DOM lib this package compiles against does not declare the API yet,
 * though Electron's Chromium has shipped it.
 */
interface NavigateEventFields {
  readonly destination: { readonly sameDocument: boolean };
  readonly downloadRequest: string | null;
}

/** `window.navigation`, or undefined where it is absent — jsdom, for one. */
function navigationOf(target: Window): EventTarget | undefined {
  return (target as Window & { navigation?: EventTarget }).navigation;
}

/**
 * How long the window waits after a change before it keeps the session (TYTO-113).
 *
 * A pause and not every keystroke: the record is the whole strip, drafts included, and what a
 * crash costs is at most this much typing. A quit and a reload write it at once.
 */
const SESSION_DELAY = 1000;
let sessionTimer: ReturnType<typeof setTimeout> | undefined;
/** False until the last session was read back: a write before that would erase it. */
let sessionRead = false;

function keepSessionSoon(): void {
  if (!sessionRead) return;
  if (sessionTimer !== undefined) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    sessionTimer = undefined;
    void keepSession(false);
  }, SESSION_DELAY);
}

/** Writes the session now, and says whether it reached the disk (ADR 0080). */
async function keepSession(final: boolean): Promise<boolean> {
  const bridge = window.tyto;
  if (bridge === undefined || !sessionRead) return false;
  if (sessionTimer !== undefined) clearTimeout(sessionTimer);
  sessionTimer = undefined;
  try {
    const kept = sessionOf(withLiveScroll(workspace), templateSnapshot(), groupsForSession());
    return (await bridge['session:write']({ ...kept, final })).written;
  } catch (cause) {
    reportToLog(bridge, cause, 'session not written');
    return false;
  }
}

/**
 * The workspace with the tab in front scrolled where its pane is now (TYTO-265).
 *
 * Measured here and not kept live, for `leave`'s reason: a scroll is a layout read, and
 * the wheel moves it without a transaction. Not written back into the workspace either, since
 * that is a repaint and a repaint asks for another write. A pane with no height — hidden behind
 * the template mode — measures the top whatever it shows, so the last capture stands then.
 */
function withLiveScroll(current: Workspace): Workspace {
  // Every group's primary pane, for the document it shows (TYTO-286); a follower's scroll is
  // its own and the document keeps one.
  const scrolls = new Map<string, ReturnType<EditorPane['scroll']>>();
  for (const [groupId, documentId] of shownIn) {
    const shown = panes.get(groupId);
    if (shown === undefined || isFollower(shown.state())) continue;
    if (shown.view.scrollDOM.clientHeight === 0) continue;
    scrolls.set(documentId, shown.scroll());
  }
  if (scrolls.size === 0) return current;
  return {
    ...current,
    documents: current.documents.map((document_) => {
      const scroll = scrolls.get(document_.id);
      return scroll === undefined ? document_ : { ...document_, scroll };
    }),
  };
}

/**
 * The editor groups for the session (TYTO-286): the tree, and per tab where **that** tab is
 * looking. The tab in front of a group is read off its pane — the scroll only when the pane has
 * a height, as {@link withLiveScroll} does — and a tab behind is where it was when its pane last
 * let go of it, or, for one no pane has shown here, where its document says.
 */
function groupsForSession(): SessionGroups {
  return layoutOf(groups, (tab, group): SessionGroupItem => {
    // A preview keeps no place (TYTO-287): a following one names nothing, since it shows the
    // brief in front when the window opens again, and a locked one names its brief.
    if (isPreview(tab)) {
      return tab.locked === true
        ? { documentId: tab.documentId, view: 'preview', locked: true }
        : { view: 'preview' };
    }
    const pane_ = panes.get(group.id);
    const remembered = tabPlaces.get(tab.id) ?? pendingPlaces.get(tab.id);
    if (pane_ !== undefined && shownTab.get(group.id) === tab.id) {
      const measured = pane_.view.scrollDOM.clientHeight > 0;
      const top = measured
        ? pane_.scroll().top
        : (remembered?.top ?? documentOf(workspace, tab.documentId)?.scroll?.top ?? 0);
      return { documentId: tab.documentId, place: { ...selectionOf(pane_.state()), top } };
    }
    if (remembered !== undefined) return { documentId: tab.documentId, place: remembered };
    const document_ = documentOf(workspace, tab.documentId);
    const place =
      document_?.state === undefined
        ? null
        : { ...selectionOf(document_.state), top: document_.scroll?.top ?? 0 };
    return { documentId: tab.documentId, place };
  });
}

/** One tab of {@link SessionGroups}, as the window sends it. */
type SessionGroupItem = SessionGroups['root'] extends SessionGroupNode<infer Item> ? Item : never;

/**
 * The template mode's part of the session (TYTO-266), or null before the mode was ever loaded:
 * until then the element is not upgraded and has no buffers to keep.
 */
function templateSnapshot(): TemplateSnapshot {
  const mode = elements.templateMode;
  if (mode === null || mode === undefined) return null;
  if (customElements.get(TEMPLATE_MODE_TAG) === undefined) return null;
  return mode.snapshot();
}

/** One tab as main answered it, or the app file opened by its own command. */
type RestoredTab = IpcResponse<'session:read'>['tabs'][number];

/**
 * A restored document put back where it was looking (TYTO-265): the selection on its state,
 * clamped to whichever text it opened with — the file may have changed on disk, or the draft
 * be the stale one beside it — and the scroll as a position the editor clamps when it shows it.
 */
function placed(document_: DocumentState, place: RestoredTab['place']): DocumentState {
  if (place === null || document_.state === undefined) return document_;
  return {
    ...document_,
    state: withSelection(document_.state, place),
    scroll: { top: place.top },
  };
}

/** The file a restored tab holds: main's answer for a brief, the open command's for the rest. */
async function fileOf(
  bridge: TytoBridge,
  tab: RestoredTab,
): Promise<{
  document: { name: string; pathLabel: string; text: string } | null;
  documentId: string | null;
}> {
  if (tab.kind === 'brief') return { document: tab.document, documentId: tab.documentId };
  return openAppFileIn(bridge, tab.kind, nextDocumentId());
}

/**
 * Reopens the tabs the last session left, as main decided them against the disk (TYTO-113).
 *
 * Main has already chosen: which files are still there, and whether each draft may go over
 * its file. What is left here is building the documents — the saved text read back out of the
 * buffer CodeMirror built from the disk, as `adopt` does, and the draft over it as a buffer of
 * its own. **The undo history does not come back**: a state is opaque and is written nowhere
 * (ADR 0080). A draft its file moved under opens in a tab of its own beside the file, never
 * over it, and a problems row says so; a file that is gone says so too.
 */
async function restoreSession(bridge: TytoBridge, handle: EditorHandle): Promise<void> {
  let answer: IpcResponse<'session:read'>;
  try {
    answer = await bridge['session:read']({});
  } catch (cause) {
    reportToLog(bridge, cause, 'session not read');
    sessionRead = true;
    return;
  }

  const restored: DocumentState[] = [];
  const rows: Diagnostic[] = [];
  let activeId: string | undefined;
  /** Per session tab, by index: the document it became, and a stale draft's tab beside it. */
  const builtAt = new Map<number, string>();
  const staleAt = new Map<number, string>();
  const untitled = (text: string, place: RestoredTab['place']): DocumentState => {
    const born = placed(newDocument(nextDocumentId(), handle.blank(text)), place);
    restored.push(born);
    return born;
  };

  for (const [index, tab] of answer.tabs.entries()) {
    const opened = await fileOf(bridge, tab);
    const kind = tab.kind === 'brief' ? undefined : tab.kind;
    let built: DocumentState | undefined;
    if (opened.document !== null && opened.documentId !== null) {
      const language = languageOf(kind);
      const assist = assistOf(kind, appFileAssists);
      const born = newDocument(
        opened.documentId,
        handle.blank(opened.document.text, language, assist),
      );
      built = placed(
        {
          ...born,
          ...(kind === undefined ? {} : { kind }),
          name: opened.document.name,
          // A restored tab is shown where its file is, as an opened one is (ADR 0086).
          pathLabel: opened.document.pathLabel,
          savedText: contentOf(born),
          state:
            tab.draft !== null && !tab.stale
              ? handle.blank(tab.draft, language, assist)
              : born.state,
        },
        tab.place,
      );
      restored.push(built);
      if (tab.draft !== null && tab.stale) {
        staleAt.set(index, untitled(tab.draft, tab.place).id);
        rows.push({
          severity: 'warning',
          code: SESSION_DRAFT_STALE,
          message: `${translate(state.locale, 'session.draftStale')}: ${opened.document.name}`,
        });
      }
    } else {
      if (tab.missing !== null) {
        rows.push({
          severity: 'error',
          code: FILE_NOT_FOUND,
          message: `${translate(state.locale, 'file.missing')}: ${tab.missing}`,
        });
      }
      if (tab.draft !== null) built = untitled(tab.draft, tab.place);
    }
    if (built !== undefined) builtAt.set(index, built.id);
    if (index === answer.active && built !== undefined) activeId = built.id;
  }

  // The template mode (TYTO-266), decided by main like a brief: a stale draft and the drafts of
  // a folder that is gone come back as untitled tabs beside the rest, never over a file.
  const template = answer.template;
  const fresh: RestoredDrafts = {};
  if (template !== null) {
    if (template.opened === null) {
      rows.push({
        severity: 'error',
        code: FILE_NOT_FOUND,
        message: `${translate(state.locale, 'file.missing')}: ${template.name}`,
      });
    }
    for (const buffer of ['manifest', 'markup'] as const) {
      const { draft, stale } = template[buffer];
      if (draft === null) continue;
      if (template.opened !== null && !stale) {
        fresh[buffer] = draft;
        continue;
      }
      untitled(draft, null);
      if (stale) {
        rows.push({
          severity: 'warning',
          code: SESSION_DRAFT_STALE,
          message: `${translate(state.locale, 'session.draftStale')}: ${template.name}/${TEMPLATE_FILES[buffer]}`,
        });
      }
    }
  }

  if (restored.length > 0) {
    // The tab the window opened on stays only if somebody already typed in it.
    const kept = workspace.documents.filter((document_) => !isDisposable(document_));
    workspace = {
      documents: [...restored, ...kept],
      activeId: activeId ?? (restored[0] as DocumentState).id,
    };
    // The groups the session left (TYTO-286), laid out and drawn before any pane is pointed at
    // a document: a scroll put back into a pane whose strip has not rendered yet lands against
    // the wrong height. A session with none, or none that survived, is one group, as before.
    if (answer.groups !== null) await restoreGroups(answer.groups, builtAt, staleAt);
    followWorkspace();
    for (const document_ of restored) {
      if (document_.kind === undefined) void request(bridge, document_.id, contentOf(document_));
      else void validateAppFile(bridge, document_.id);
    }
  }
  if (rows.length > 0) {
    const codes = new Set(rows.map((row) => row.code));
    panel.installation = [...rows, ...panel.installation.filter((item) => !codes.has(item.code))];
    raiseWindowProblem();
  }
  // After the tabs, so the mode opens over a window that already has them behind it.
  if (template?.opened !== null && template?.opened !== undefined) {
    const mode = await loadTemplateMode();
    mode?.restore(template.opened, fresh, template.visible);
  }
  sessionRead = true;
  // A first launch opens the preview to the side, so a new person sees art before they know
  // the key (TYTO-287, ADR 0084 decision 8); afterwards the session decides. A session whose
  // only kept tab was a following preview beside the untouched tab brings it back the same way,
  // since no tree is rebuilt for a window that had no document to keep.
  const followingKept = answer.groups !== null && keepsFollowingPreview(answer.groups.root);
  if (answer.firstLaunch || (restored.length === 0 && followingKept)) openPreview(true, false);
  repaint();
}

/** Whether a tree the session read back holds a following preview anywhere. */
const keepsFollowingPreview = (node: SessionGroupNode<StoredGroupItem>): boolean =>
  'split' in node
    ? node.children.some(keepsFollowingPreview)
    : node.tabs.some((tab) => 'view' in tab && !('locked' in tab));

/**
 * The session's groups made the window's (TYTO-286). Each tab names a session tab by index and
 * shows the document that tab became; a tab that came back as nothing — a file gone with no
 * draft — is not shown, and a group left with none collapses. **A stale draft opens beside its
 * file's first tab, in the same group**, as it opens beside the file in one strip. Every tab's
 * own cursor waits in {@link pendingPlaces} for the first pane that shows it.
 */
/** One tab of the groups the session read back: a text tab, or a preview (TYTO-287). */
type StoredGroupItem =
  NonNullable<IpcResponse<'session:read'>['groups']>['root'] extends SessionGroupNode<infer Item>
    ? Item
    : never;

async function restoreGroups(
  layout: NonNullable<IpcResponse<'session:read'>['groups']>,
  builtAt: ReadonlyMap<number, string>,
  staleAt: ReadonlyMap<number, string>,
): Promise<void> {
  type Item = { readonly stored: StoredGroupItem; readonly stale: boolean };
  const besideOnce = new Set<number>();
  const withDrafts = (node: SessionGroupNode<StoredGroupItem>): SessionGroupNode<Item> => {
    if ('split' in node) return { ...node, children: node.children.map(withDrafts) };
    const tabs: Item[] = [];
    let active = 0;
    node.tabs.forEach((tab, index) => {
      if (index === node.active) active = tabs.length;
      tabs.push({ stored: tab, stale: false });
      if (!('view' in tab) && staleAt.has(tab.tab) && !besideOnce.has(tab.tab)) {
        besideOnce.add(tab.tab);
        tabs.push({ stored: tab, stale: true });
      }
    });
    return { tabs, active };
  };
  const rebuilt = groupsFromLayout(
    groups,
    { root: withDrafts(layout.root), focused: layout.focused },
    ({ stored, stale }) => {
      if (!('view' in stored)) return (stale ? staleAt : builtAt).get(stored.tab);
      // A following preview is pointed at the brief in front once the groups are built; a
      // locked one shows the document its brief became, and goes when that did not come back.
      if (!('locked' in stored)) return { view: 'preview', documentId: '' };
      const brief = builtAt.get(stored.tab);
      return brief === undefined ? undefined : { view: 'preview', documentId: brief, locked: true };
    },
  );
  if (rebuilt === undefined) return;
  groups = rebuilt.groups;
  for (const [{ stored }, tabId] of rebuilt.tabIds) {
    if (!('view' in stored) && stored.place !== null) pendingPlaces.set(tabId, stored.place);
  }
  arrangeEditorGroups();
  await Promise.all([...groupElements.values()].map((element) => element.updateComplete));
}

/**
 * Closes the focused group: each of its tabs as `Mod-w` closes it (TYTO-286), brought to the
 * front first so a question about unsaved text is asked over the tab it is about. A tab whose
 * question was answered _keep_ stays, and so does the group with it.
 */
async function closeFocusedGroup(): Promise<void> {
  const group = focusedGroup(groups);
  for (const tab of group.tabs) {
    if (groupOfTab(groups, tab.id) === undefined) continue;
    selectTab(tab.id);
    await requestCloseTab(tab.id);
    if (groupOfTab(groups, tab.id) !== undefined) return;
  }
}

/** The file behind each template buffer, for the row that names a stale draft (TYTO-266). */
const TEMPLATE_FILES = { manifest: 'manifest.yaml', markup: 'template.html' } as const;

/** Takes a tab out of the window, and tells main to stop holding its path. */
function closeTab(id: string): void {
  const timer = pending.get(id);
  if (timer !== undefined) clearTimeout(timer);
  pending.delete(id);
  gates.delete(id);
  void withBridge(async (bridge) => {
    await bridge['file:close']({ documentId: id });
  });

  // Closing the last tab leaves an empty one rather than an empty window: there would be
  // nowhere to type, and typing is the state this app opens in.
  workspace = closeDocument(workspace, id, () => newDocument(nextDocumentId(), editor?.blank('')));
  // Every tab of it, in every group; the focused group's neighbour comes to the front there.
  groups = closeDocumentTabs(groups, id);
  const open = new Set(workspace.documents.map((document_) => document_.id));
  for (const document_ of workspace.documents) {
    if (!shownDocumentIds(groups).has(document_.id) && open.has(document_.id)) {
      groups = openDocument(groups, document_.id);
    }
  }
  showGroups();
}

/**
 * Closes one tab (TYTO-286). A document another group also shows only loses this tab, with no
 * question — nothing is lost; its last tab closes the document, asking first when it is unsaved.
 */
async function requestCloseTab(tabId: string): Promise<void> {
  const tab = groupOfTab(groups, tabId)?.tabs.find((each) => each.id === tabId);
  if (tab === undefined) return;
  // A preview holds nothing to lose, and its brief stays open whatever it shows (TYTO-287); a
  // preview of a document is not another tab of it, so it never spares the question below.
  const elsewhere =
    isPreview(tab) ||
    groupList(groups).some((group) =>
      group.tabs.some(
        (each) => each.id !== tabId && !isPreview(each) && each.documentId === tab.documentId,
      ),
    );
  if (!elsewhere) {
    await requestClose(tab.documentId);
    return;
  }
  groups = closeGroupTab(groups, tabId);
  showGroups();
}

/**
 * A show-or-hide command per panel, registered from the record rather than written out.
 *
 * Once, at startup, because the set of panels is fixed for a session — what changes is
 * whether each is open, and that is the command's business rather than the registration's.
 * A panel added to `DEFAULT_LAYOUT` gets its command with no edit here, which is the claim
 * the card makes about adding a panel being one entry and an element.
 */
function registerPanelCommands(): void {
  for (const panel of layout.panels) {
    // A fixed panel gets no command for the same reason it gets no close button: there is
    // nothing it could do (`shared/layout.ts`).
    if (panel.fixed) continue;
    registry.register({
      id: togglePanelCommandId(panel.id),
      label: panel.id,
      run: () => {
        const current = panelOf(layout, panel.id);
        if (current === undefined) return;
        void changeLayout(withPanelOpen(layout, panel.id, !current.open));
      },
    });
  }
}

/**
 * The installed plugins' panels, once main has started the plugins (TYTO-49, ADR 0045).
 *
 * Not awaited by `load`: the window opens while the plugins start, and a panel arrives as
 * a command — closed, until somebody opens it — when they have. Its toggle is labelled with
 * the plugin's own title, since the catalogue has no word for a panel it did not ship.
 */
async function loadPluginPanels(bridge: TytoBridge): Promise<void> {
  servePanelBridge(window, document, {
    request: (panelId, capability, args) =>
      bridge['panel:request']({ panelId, capability, args: [...args] }),
  });
  document.addEventListener('plugin-panel-load', () => {
    announceDocument(document, contentOf(active()));
  });

  // Answered once the plugins have started, and main has put their template packs into the
  // search before answering (`index.ts`), so this is also the moment the picker can list them.
  const { panels } = await bridge['plugins:panels']({});
  void afterTemplatesReread(bridge);
  for (const panel of panels) {
    offeredPanels.set(panel.id, panel);
    registry.register({
      id: togglePanelCommandId(panel.id),
      label: panel.title,
      run: () => {
        const current = panelOf(layout, panel.id);
        if (current === undefined) return;
        void changeLayout(withPanelOpen(layout, panel.id, !current.open));
      },
    });
  }
  layout = withPluginPanels(layout, panels);
  await applyLayout(false);
  // After the panels, whose toggles a plugin's keys may name.
  const { keymaps } = await bridge['plugins:keymaps']({});
  pluginKeybindings = keymaps.map(pluginKeybindingLayer);
  // The person's layer too: an entry naming a plugin panel's toggle resolves only now.
  if (pluginKeybindings.length > 0 || userKeybindings.length > 0) applyKeybindings(bridge);
}

/**
 * Asks once what every declared setting is, for the settings tab (TYTO-304). Main answers after
 * the installed plugins have started, so the answer holds their settings and themes; a refusal
 * leaves the tab without suggestions and says so in the log, never in front of the person.
 */
async function loadSettingsOutline(bridge: TytoBridge): Promise<void> {
  try {
    settingsOutline = (await bridge['settings:outline']({})).settings;
  } catch (cause) {
    reportToLog(bridge, cause, 'settings outline not read');
  }
}

/**
 * Resolves the table again and hands it to everything that reads it.
 *
 * Only when a layer above the built-in one exists or has just gone: with none the table is
 * the built-in one already, and reconfiguring the editor would reset the vim engine for
 * nothing. What the resolver refused goes to the log, one line per entry; the person's own
 * entries are also the keybindings tab's problems, at their ranges (`validateKeybindings`).
 */
function applyKeybindings(bridge: TytoBridge): void {
  const resolved = resolveWith(userKeybindings);
  keybindings = resolved.table;
  for (const problem of resolved.diagnostics) {
    void bridge['log:write']({
      level: 'warn',
      message: `${problem.code}: ${problem.message}`.slice(0, 200),
    });
  }
  editor?.setKeymaps({
    normal: keymapSetFor(false, keybindings),
    vim: keymapSetFor(true, keybindings),
  });
  paintCommandBar();
}

/**
 * `Mod-1`…`Mod-9`, registered once and never again.
 *
 * Nine commands for a window that usually has two tabs, and that is deliberate: the id is
 * the *slot*, so the keystroke is a fixed table the editor's keymap can carry, and the
 * document it lands on is looked up when the command runs. Registering per open document
 * instead would mean nine ids appearing and disappearing under a keymap that had already
 * been built. `commandEntries` is what keeps the empty slots out of the palette.
 */
function registerDocumentCommands(): void {
  for (const slot of DOCUMENT_SLOTS) {
    registry.register({
      id: selectDocumentCommandId(slot),
      label: String(slot),
      run: () => {
        // The focused group's tabs (TYTO-286): `Mod-2` is the second tab of the group in front.
        const target = focusedGroup(groups).tabs[slot - 1];
        if (target !== undefined) selectTab(target.id);
      },
    });
  }
}

/** The catalogue key a panel is named by in a list of panels. */
const PANEL_NAMES: Readonly<Record<string, CatalogueKey>> = {
  editor: 'panel.editor',
  problems: 'panel.problems',
  queue: 'panel.queue',
};

/** Every command the registry holds, translated and with the key that runs it. */
function commandEntries(): readonly CommandEntry[] {
  const bindings = shownBindingsOf(keybindings, editor?.isVimMode() ?? false, state.platform);

  return registry.list().flatMap((command) => {
    // Not offered with this tab in front (TYTO-283): the registry would refuse to run it.
    if (!offeredNow(command.id)) return [];
    const binding = bindings[command.id];
    const slot = slotOfSelectCommand(command.id);

    // A slot past the last tab is left out rather than shown doing nothing. The command
    // stays registered, because the keystroke table is fixed and a `Mod-7` pressed with six
    // tabs open should be a key that does nothing, not a key that runs the wrong tab.
    const slotTab = slot === undefined ? undefined : focusedGroup(groups).tabs[slot - 1];
    const tab = slotTab === undefined ? undefined : documentOf(workspace, slotTab.documentId);
    if (slot !== undefined && tab === undefined) return [];

    return [
      {
        id: command.id,
        label: commandTitle(command, tab),
        ...(binding === undefined ? {} : { binding }),
      },
    ];
  });
}

/**
 * A command's title as the command bar shows it, in the window's language. Three commands
 * build it from a word plus something that is not the catalogue's: a recent file's own name, a
 * panel's name, and a tab's (`tab`, for a tab slot; its number without one). All are resolved
 * at display time so that switching language needs no re-registration.
 */
function commandTitle(
  command: { readonly id: string; readonly label?: string },
  tab: DocumentState | undefined,
): string {
  const key = COMMAND_LABELS[command.id];
  const own = command.label ?? command.id;
  const panelId = panelOfToggleCommand(command.id);
  const panelName = panelId === undefined ? undefined : PANEL_NAMES[panelId];
  const slot = slotOfSelectCommand(command.id);
  if (pathOfRecentCommand(command.id) !== undefined) {
    return `${translate(state.locale, 'command.file.recent')}: ${own}`;
  }
  if (slot !== undefined) {
    return `${translate(state.locale, 'command.document.select')}: ${
      tab === undefined ? String(slot) : labelOf(tab)
    }`;
  }
  if (panelId !== undefined) {
    return `${translate(state.locale, 'command.layout.togglePanel')}: ${
      panelName === undefined ? own : translate(state.locale, panelName)
    }`;
  }
  return key === undefined ? own : translate(state.locale, key);
}

/**
 * Every command the keybindings tab may name (TYTO-304): the whole registry, as the resolver
 * checks entries against it — not only what is offered with the tab in front, since a key bound
 * to export is a fine entry while `keybindings.json` is the tab — each with the key it is on
 * before the person's file, read off the table built without the user layer.
 */
function keybindingCommands(): readonly KeybindingCommand[] {
  const defaults = shownBindingsOf(
    resolveWith([]).table,
    editor?.isVimMode() ?? false,
    state.platform,
  );
  return registry.list().map((command) => {
    const key = defaults[command.id];
    return {
      id: command.id,
      title: commandTitle(command, undefined),
      ...(key === undefined ? {} : { key }),
    };
  });
}

/** What vim last said through `onVimStatus`; `null` while vim is off (TYTO-248). */
let vimStatus: VimStatus | null = null;

/**
 * The `statusBarItems` setting, as main's last theme answer carried it (TYTO-301): today's bar
 * until the first answer arrives, which is also the setting's default.
 */
let statusBarItems: readonly StatusBarItemId[] = STATUS_BAR_ITEM_IDS;

/** The `vimModeStyle` setting, from the same answer (TYTO-301): the badge until it arrives. */
let vimModeStyle: VimModeStyle = 'badge';

/** The `indentGuides` setting, from the same answer (TYTO-293): on until it arrives. */
let indentGuides = true;

/** The `stickyScroll` setting, from the same answer (TYTO-295): on until it arrives. */
let stickyScroll = true;

/** The `tabSize` setting, from the same answer (TYTO-297): two until it arrives. */
let tabSize = DEFAULT_TAB_SIZE;

/** The `formatBriefOnSave` setting, from the same answer (TYTO-297): off until it arrives. */
let formatBriefOnSave = false;

/** The `briefColumns` setting, from the same answer (TYTO-298): the separator until it arrives. */
let briefColumns: BriefColumnLook = 'separator';

/** The ids the status bar's buttons run; the area toggles are named by the bar itself. */
const STATUS_COMMANDS: StatusBarCommands = {
  commandBar: COMMAND_BAR_TOGGLE,
  problems: togglePanelCommandId(PROBLEMS_PANEL),
  queue: togglePanelCommandId(QUEUE_PANEL),
  plugins: PLUGINS_SHOW,
  export: FILE_EXPORT,
  settings: SETTINGS_OPEN,
};

/** A panel is on screen when it is open and its area is not hidden (ADR 0076). */
const panelShown = (id: string): boolean => {
  const record = panelOf(layout, id);
  return record !== undefined && record.open && !dockIsHidden(layout, record.dock);
};

/**
 * The status bar, from the tab in front, the layout and the editor (TYTO-248, ADR 0076).
 *
 * A property assignment, like the problems panel's: Lit rewrites only what changed, which is
 * what lets this run on every cursor move.
 */
function paintStatusBar(): void {
  const bar = elements.statusBar;
  if (bar === null) return;
  const current = active();
  const problems = [...panel.installation, ...current.diagnostics];
  const problemsShown = panelShown(PROBLEMS_PANEL);
  // Every way the panel comes on screen — its button, the command bar, a key, showing the
  // bottom area — ends in a repaint, so this is the one place that has to know.
  if (problemsShown) problemsMark = seen(problemsMark);
  const shownState = focusedPane()?.state() ?? current.state;
  bar.commands = STATUS_COMMANDS;
  bar.items = statusBarItems;
  bar.offered = offeredNow;
  bar.run = (id) => {
    runWindowCommand(id);
  };
  const vim = editor?.isVimMode() === true ? vimStatus : null;
  // The border and the whole bar are the footer's, which holds the bar (TYTO-301).
  const foot = bar.closest<HTMLElement>('.shell__foot');
  if (foot !== null) paintVimStyle(foot, vimModeStyle, vim);
  bar.state = {
    locale: state.locale,
    vim,
    // The focused pane's caret (TYTO-286): a follower's selection is its own, not the record's.
    cursor: shownState === undefined ? { line: 1, column: 1, selected: 0 } : cursorOf(shownState),
    kind: activeKind() ?? 'brief',
    template: current.kind === undefined ? templateOf(activeText()) : undefined,
    problems: problems.length,
    errors: errorCount(problems),
    newProblems: problemsMark.lit,
    shown: {
      left: dockIsShown(layout, 'left'),
      right: dockIsShown(layout, 'right'),
      bottom: dockIsShown(layout, 'bottom'),
      problems: problemsShown,
      queue: panelShown(QUEUE_PANEL),
    },
    areas: {
      left: dockHasPanels(layout, 'left'),
      right: dockHasPanels(layout, 'right'),
      bottom: dockHasPanels(layout, 'bottom'),
    },
  };
}

function paintCommandBar(): void {
  const bar = elements.commandBar;
  if (bar === null) return;
  bar.locale = state.locale;
  bar.commands = commandEntries();
}

/**
 * Puts the window in the shape `layout` describes, and re-finds everything in it.
 *
 * The order is the whole of it. Arrange first, because a reopened panel's nodes do not
 * exist until the dock has made them; then look the nodes up again, because the old handles
 * point at a document nobody is looking at; then wire, because new nodes have no listeners;
 * then paint. Getting this order wrong produces a window that looks right and answers no
 * clicks, which is the failure this function is shaped around.
 */
async function applyLayout(persist: boolean): Promise<void> {
  await arrange(document, layout, {
    locale: state.locale,
    onClose: (panelId) => {
      void changeLayout(withPanelOpen(layout, panelId, false));
    },
    onResize: (panelId, size, settled) => {
      layout = withPanelSize(layout, panelId, size);
      // Only the settled one is written down. A drag is sixty of these a second and the
      // disk should hear about one of them.
      void applyLayout(settled);
    },
  });

  // A plugin panel's element exists once the dock has made it; what it shows is ours to say.
  for (const panel of document.querySelectorAll(PLUGIN_PANEL_ELEMENT)) {
    if (panel instanceof PluginPanel) panel.offered = offeredPanels.get(panel.panelId);
  }

  // The editor groups before the lookup: the first group's pane is `#editor` (TYTO-286).
  arrangeEditorGroups();
  elements = resolveElements();
  wirePanelControls();
  wireQueuePanel();
  wireCommandBar();
  present();
  repaint();

  if (persist) {
    void withBridge(async (bridge) => {
      await bridge['layout:set']({ layout });
    });
  }
}

/** Every layout change is this: a new record, the window rearranged, and a write. */
async function changeLayout(next: Layout): Promise<void> {
  layout = next;
  await applyLayout(true);
}

/**
 * Changes the window's language, which is three things and not one.
 *
 * Everything this app draws itself is re-read from the catalogue by `repaint`. The search
 * panel is not: it is CodeMirror's DOM and its words arrive through `EditorState.phrases`,
 * so the editor has to be told separately (E8.5). Both callers go through here rather than
 * setting `state.locale` and remembering — forgetting the second half would leave the panel
 * in whatever language the window opened in, and nothing on screen would say why.
 */
function applyLocale(next: Locale): void {
  state.locale = next;
  // Only once it is loaded: before that there is no element to tell, and `loadTemplateMode`
  // hands it the locale in force when it arrives.
  if (customElements.get(TEMPLATE_MODE_TAG) !== undefined && elements.templateMode) {
    elements.templateMode.locale = next;
  }
  if (elements.pluginsDialog) elements.pluginsDialog.locale = next;
  editor?.setSearchPhrases(searchPhrasesFor(state.locale));
  repaint();
  // And three things, since TYTO-124: the application menu is main's and now carries this
  // app's own verbs, so main has to be told which language to draw them in. Fire and forget —
  // a menu that stayed in the old language is a cosmetic failure, and the log is where it
  // belongs if the message never lands.
  void withBridge(async (bridge) => {
    await bridge['app:locale']({ locale: next });
    // Main has built the menu again in the new language; the drawn row reads it from there.
    await drawMenuRow(bridge);
  });
}

/**
 * What the shell paints, which is this module's own state plus the tab in front.
 *
 * A function and not a value: the unsaved marker is compared on every read (TYTO-112), so
 * anything holding one of these would be holding an answer from before the last keystroke.
 */
function shellState(): ShellState {
  const current = active();
  // The title is the active tab, which is the whole of point 5 of E9.11's card.
  return { ...state, document: { name: current.name, dirty: isUnsaved(current) } };
}

function repaint(): void {
  // Every change to the strip ends in a repaint, so this is where the session is kept from.
  keepSessionSoon();
  // Before the strips: each group is told whether a preview is in front (`paintTabs`), and the
  // panes it shows are painted here; before the translation pass too, which writes the heading
  // the chrome names (TYTO-256).
  paintTabs();
  paintPreviews();
  paint(document, shellState());
  paintPanel();
  paintCommandBar();
  paintStatusBar();
  tellMenuWhatIsOffered();
  if (elements.updateNotice !== null) {
    paintUpdateNotice(elements.updateNotice, updateStatus, state.locale);
  }
}

/** The File and View ids main was last told to disable, joined; `undefined` before the first. */
let menuDisabledSent: string | undefined;

/**
 * Tells main which File and View items do nothing with this tab in front, so it greys them
 * (TYTO-283). The same predicate the bar and the registry ask; sent only when the answer
 * changes, because this runs on every repaint and main rebuilds the menu on each message.
 */
function tellMenuWhatIsOffered(): void {
  const ids = [...FILE_MENU_COMMANDS, ...VIEW_MENU_COMMANDS]
    .map((command) => command.id)
    .filter((id) => !offeredNow(id));
  const joined = ids.join(' ');
  if (joined === menuDisabledSent) return;
  menuDisabledSent = joined;
  void withBridge(async (bridge) => {
    await bridge['menu:disabled']({ ids });
  });
}

/** Asks main where the update stands and shows it (TYTO-131). */
async function refreshUpdate(bridge: TytoBridge): Promise<void> {
  updateStatus = await bridge['update:status']({});
  repaint();
}

/**
 * Asks main for the frames of `brief`, and keeps the answer only if it is still the latest.
 *
 * "Latest" is per document (see {@link gates}), and the answer lands in the document it was
 * asked for even when that is not the one on screen — a tab compiled in the background is
 * finished when a person comes back to it rather than started then. **Nothing repaints for
 * a document nobody is looking at**, which is the card's third point in its literal form.
 */
async function request(bridge: TytoBridge, documentId: string, brief: string): Promise<void> {
  const gate = gateFor(documentId);
  const requestId = gate.next();
  const answer = await bridge['brief:preview']({ requestId, documentId, brief });
  if (!gate.accept(answer.requestId)) return;
  // Every document a group shows has its answers reach that pane's gutter (TYTO-286); a tab
  // compiled in the background is published when it is compiled again on screen.
  if ([...shownIn.values()].includes(documentId))
    analysis.publish(documentId, { ...answer, brief });
  // The plugins' panels hear the focused document on the same pause the preview compiles on.
  if (documentId === active().id) announceDocument(document, brief);

  const errors = errorCount(answer.diagnostics);

  workspace = updateDocument(workspace, documentId, (document_) => {
    /**
     * A failed compile keeps the artwork that last worked, marked (E9.13).
     *
     * `brief:preview` answers with no frames when a stage fails **fatally**, and taking
     * that literally is what used to blank the pane at the one moment the preview is the
     * thing telling you whether the fix worked.
     *
     * **The discriminator is the errors, not the empty list.** A brief that compiles to
     * nothing is a legitimate answer — a template with no artworks written yet — and it
     * should clear the pane rather than leave yesterday's picture in it. So frames are kept
     * only when the compile actually failed.
     *
     * **TYTO-107 narrowed what reaches here without touching this line**, which is the
     * sign the condition was written about the right thing. A stray `**` is not fatal
     * since ADR 0025: the answer arrives with frames in it, `failed` is false, and the
     * pane shows the artwork the author is typing rather than the one before it. What
     * still lands here is the fatal half — no template, a frontmatter that will not parse,
     * a required slot left unset — where there is genuinely nothing new to draw.
     */
    const failed = answer.frames.length === 0 && errors > 0;
    const frames = failed ? document_.frames : answer.frames;
    const artworks = failed ? document_.artworks : answer.artworks;

    return {
      ...document_,
      frames,
      artworks,
      selection: keepSelection(document_.selection, frames, artworks),
      diagnostics: answer.diagnostics,
      // The brief **as asked**, not as it stands: the ranges index this text, and pairing
      // them with a buffer two keystrokes further on would show a line number that drifts.
      brief,
      // Unchanged on a failure, which is what makes `isStale` true: the frames are still the
      // ones that older text produced. On success the two meet again and the marker clears
      // itself, with no keystroke and nothing to remember.
      renderedBrief: failed ? document_.renderedBrief : brief,
    };
  });

  // On screen in front of the panels, or in a preview tab anywhere (TYTO-287): a brief typed in
  // one group redraws the preview beside it, focused or not.
  if (documentId === active().id || previewedIn(documentId).length > 0) repaint();
}

/**
 * Nodes that already have their listeners.
 *
 * The dock rearranges whenever a panel opens, closes or is resized, and a reopened panel is
 * made of **new nodes** — so the wiring has to run again. A panel that merely survived the
 * rearrange keeps the nodes it had, and adding a second `click` listener to one of them
 * would run the handler twice. A `WeakSet` because the nodes it names are thrown away when
 * a panel closes, and nothing here should keep them alive.
 */
const wired = new WeakSet<EventTarget>();

/** Registers `listener` once per node, whatever a rearrange does afterwards. */
function once<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | null,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
): void {
  if (target === null || wired.has(target)) return;
  wired.add(target);
  target.addEventListener(type, listener);
}

/** The groups with a preview of `documentId` in front (TYTO-287). */
function previewedIn(documentId: string): readonly string[] {
  return groupList(groups).flatMap((group) => {
    const tab = activeTabOf(group);
    return tab !== undefined && isPreview(tab) && tab.documentId === documentId ? [group.id] : [];
  });
}

/** The zoom each preview pane was last drawn at, by group: `fit` resolved against its stage. */
const paintedZoom = new Map<string, number>();

/**
 * The zoom a brief is drawn at on screen, from the preview showing it — the focused group's
 * first — or `undefined` when no preview shows it (TYTO-287).
 */
function shownZoomOf(documentId: string): number | undefined {
  const shown = previewedIn(documentId);
  const group = shown.includes(groups.focusedGroupId) ? groups.focusedGroupId : shown[0];
  return group === undefined ? undefined : paintedZoom.get(group);
}

/** What a preview with no brief to show draws: the empty line. */
const NOTHING_TO_PREVIEW: PreviewState = {
  frames: [],
  artworks: [],
  selection: { format: undefined, artwork: undefined },
  zoom: 'fit',
  stale: false,
};

/**
 * Paints every preview tab in front of its group from the brief it shows (TYTO-287, ADR 0084).
 * The document already holds everything the PREVIEW panel drew — frames, artworks, the chosen
 * format and slide, the zoom, whether the art is stale or the brief broken — so two previews of
 * two briefs are two reads of the workspace and no second request.
 */
function paintPreviews(): void {
  for (const group of groupList(groups)) {
    const tab = activeTabOf(group);
    const element = groupElements.get(group.id);
    if (tab === undefined || !isPreview(tab) || element === undefined) continue;
    const pane_ = element.preview;
    const nodes = previewElementsOf(pane_);
    if (nodes === undefined) {
      // Made a moment ago and not rendered yet: the whole window is repainted once it has
      // been, so the translation pass reaches its strings too, not only its picture.
      void pane_.updateComplete.then(() => {
        if (previewElementsOf(pane_) !== undefined) repaint();
      });
      continue;
    }
    wirePreviewPane(pane_, nodes);
    const lock = pane_.querySelector<HTMLElement>('[data-preview-lock]');
    lock?.setAttribute('aria-pressed', String(tab.locked === true));
    lock?.classList.toggle('preview__lock--on', tab.locked === true);
    const shown = documentOf(workspace, tab.documentId);
    const drawn =
      shown === undefined
        ? NOTHING_TO_PREVIEW
        : { ...shown, stale: isStale(shown), broken: isBroken(shown) };
    paintedZoom.set(group.id, paintPreview(nodes, drawn));
  }
}

/** The document the preview in `pane_` shows now, read off its group at the moment it is asked. */
function documentOfPane(pane_: PreviewPane): string | undefined {
  for (const [groupId, element] of groupElements) {
    if (element.previewIfMade !== pane_) continue;
    const group = groupById(groups, groupId);
    const tab = group === undefined ? undefined : activeTabOf(group);
    return tab === undefined || tab.documentId === '' ? undefined : tab.documentId;
  }
  return undefined;
}

/** One stage observer for every preview: `fit` follows a split or a window resize (TYTO-287). */
let stageObserver: ResizeObserver | undefined;

/**
 * A preview pane's own controls, once per pane: the pane is made with its group and kept, so
 * this runs the first time it is painted. Each acts on the brief the pane shows when it is used.
 */
function wirePreviewPane(pane_: PreviewPane, nodes: PreviewElements): void {
  if (wired.has(pane_)) return;
  wired.add(pane_);
  const change = (choose: (document_: DocumentState) => DocumentState): void => {
    const documentId = documentOfPane(pane_);
    if (documentId === undefined) return;
    workspace = updateDocument(workspace, documentId, choose);
    repaint();
  };

  // **Nothing in here asks for a render**, which is the acceptance criterion rather than an
  // optimisation: every frame of every format is already in the document's own `frames`, so
  // switching is choosing one of them. The click handler that called the bridge would be
  // the bug.
  nodes.tabs.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const format = target.getAttribute(FORMAT_ATTRIBUTE);
    if (format === null) return;
    change((document_) => ({ ...document_, selection: { ...document_.selection, format } }));
  });

  nodes.slide.addEventListener('change', () => {
    const artwork = nodes.slide.value;
    change((document_) => ({ ...document_, selection: { ...document_.selection, artwork } }));
    // The card asks for both halves: the preview follows the choice, and so does the
    // editor. The range is the `::slide` directive that made this artwork, which only
    // `resolve` knew — a `Scene` carries no source position at all.
    const documentId = documentOfPane(pane_);
    const target = documentId === undefined ? undefined : primaryPaneOf(documentId);
    const at = rangeOfArtwork(documentOf(workspace, documentId ?? '')?.artworks ?? [], artwork);
    if (at !== undefined && target !== undefined) revealRange(target.view, at);
  });

  // The zoom buttons and the lock run commands rather than doing the work: a button, a key
  // and a bar entry are three ways to say one id (E9.12). The click has already focused this
  // pane's group, so the command acts on the brief this pane shows.
  const commands: Readonly<Record<string, string>> = {
    fit: PREVIEW_ZOOM_FIT,
    in: PREVIEW_ZOOM_IN,
    out: PREVIEW_ZOOM_OUT,
  };
  for (const button of pane_.querySelectorAll<HTMLElement>('[data-preview-zoom]')) {
    const command = commands[button.dataset['previewZoom'] ?? ''];
    if (command !== undefined) {
      button.addEventListener('click', () => {
        runCommand(command);
      });
    }
  }
  pane_.querySelector('[data-preview-lock]')?.addEventListener('click', () => {
    runCommand(PREVIEW_TOGGLE_LOCK);
  });

  // `fit` is a function of the stage, which a split or a window resize changes without any
  // state changing to notice it. jsdom has no observer, and its stage has no size either.
  if (typeof ResizeObserver === 'undefined') return;
  stageObserver ??= new ResizeObserver(() => {
    if (groupList(groups).some((group) => isFitPreview(group))) paintPreviews();
  });
  stageObserver.observe(nodes.stage);
}

/** Whether a group has a preview in front drawn at `fit`. */
function isFitPreview(group: EditorGroup): boolean {
  const tab = activeTabOf(group);
  return (
    tab !== undefined && isPreview(tab) && documentOf(workspace, tab.documentId)?.zoom === 'fit'
  );
}

/**
 * Runs a command by id, which is the only way anything in this file runs one.
 *
 * The registry needs a view because a command may be the editor's — undo and redo are, and
 * they reach CodeMirror's history through it. Before the editor exists there is nothing to
 * undo and nothing that needs one, so there is no fallback here and no silent failure
 * either: `run` answers `false` and the caller was a click on a button that does nothing
 * yet.
 */
function runCommand(id: string): boolean {
  // The focused group's view (TYTO-286): undo there, find there, save its document. With a
  // preview focused, its brief's pane (TYTO-287); the text commands are not offered there.
  const target = commandPane();
  if (target === undefined) return false;
  return registry.run(id, { view: target.view });
}

/**
 * The bar's own two callbacks, re-set on every arrange because the bar may be a new element.
 *
 * It is not — the bar lives outside the docks and the dock never touches it — but this runs
 * from `applyLayout` beside the panel wiring and should not be the one thing there that
 * assumes its node survived.
 */
function wireCommandBar(): void {
  const bar = elements.commandBar;
  if (bar === null) return;

  bar.run = (id) => runCommand(id);
  bar.close = () => undefined;
  paintCommandBar();
}

/**
 * The window's keybinding dispatcher, registered **exactly once for the life of the window**.
 *
 * It runs the table's global bindings and its `commandBar` and `panel` ones — `Mod-K` among
 * them — and CodeMirror runs the rest. It reads `keybindings` at the keystroke, so a table
 * that changes needs no second listener.
 *
 * Separate from `wireCommandBar` because that one runs on every rearrange, and this must
 * not: a second listener toggles the bar a second time on the same keystroke, so with two
 * of them the palette opens and closes inside one keypress and never appears. Two arranges
 * is the ordinary case — load, then the first time anybody closes a panel — so the bug
 * arrives the moment somebody uses the feature (TYTO-101).
 *
 * Found by the end-to-end suite, which could not open the bar after closing a panel. No
 * unit sees it: each function is right on its own and the fault is in how often one runs.
 */
function wireKeybindingDispatcher(): void {
  const altTap = new AltTap();
  window.addEventListener('keydown', (event) => {
    altTap.down(event);
    const stroke = keyOfStroke(event);
    for (const binding of windowBindingsOf(keybindings)) {
      if (concreteKey(binding, state.platform) !== stroke) continue;
      if (!windowContextHolds(binding.when)) continue;
      // A key the editor already ran is the editor's — except the bar's, which is the one
      // key nothing may take (ADR 0074) and which this listener always answered.
      if (event.defaultPrevented && binding.command !== COMMAND_BAR_TOGGLE) return;
      if (!runWindowCommand(binding.command)) continue;
      event.preventDefault();
      return;
    }
    // With a preview focused no CodeMirror view hears the keys, so the editor's own bindings —
    // save, close, the tab keys — are run from here, on its brief (TYTO-287).
    if (!event.defaultPrevented && inPreview(event.target)) {
      for (const binding of previewBindings()) {
        if (concreteKey(binding, state.platform) !== stroke) continue;
        if (!runWindowCommand(binding.command)) continue;
        event.preventDefault();
        return;
      }
    }
    // F10 focuses the drawn menu row (TYTO-244, ADR 0078), **after** the table: a binding a
    // person or a plugin put on F10 wins, and a key the editor took stays the editor's. Not a
    // menu accelerator, which the browser process would answer before the page (TYTO-124).
    if (event.defaultPrevented || menuRow === undefined) return;
    if (stroke === 'F10') {
      if (menuRow.toggle()) event.preventDefault();
      if (menuRow.focused) menuRow.showMnemonics(true, takenAltLetters());
      return;
    }
    // Alt held shows each name's letter, and Alt and that letter opens its menu (TYTO-264, ADR
    // 0078) — here, after the table, for F10's reasons: a binding on Alt+<letter> wins, and a
    // key the editor took (Alt+L selects the line) stays the editor's. Never an `&` the
    // browser process answers first: the row is drawn, so the native bar that would is gone.
    if (event.key === 'Alt' && !event.ctrlKey && !event.metaKey) {
      menuRow.showMnemonics(true, takenAltLetters());
    } else if (isMenuLetterStroke(event) && menuRow.openByLetter(event.key, takenAltLetters())) {
      event.preventDefault();
    }
  });
  // Alt alone, the other door to the row. Decided on the release, because the press is also
  // the start of every Alt+key the editor, vim and the table own (`AltTap`). The same wiring
  // and the same once-only rule as the keydown above.
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt') menuRow?.showMnemonics(false);
    if (!altTap.up(event) || menuRow === undefined) return;
    if (menuRow.toggle()) event.preventDefault();
    // Into the row: its letters stay underlined while it has focus. Out of it: they went with it.
    if (menuRow.focused) menuRow.showMnemonics(true, takenAltLetters());
  });
  window.addEventListener(
    'mousedown',
    () => {
      altTap.reset();
    },
    true,
  );
  window.addEventListener('blur', () => {
    altTap.reset();
    menuRow?.showMnemonics(false);
  });
}

/** Whether a key went to a preview tab's pane rather than to a CodeMirror view. */
const inPreview = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('tyto-preview-pane') !== null;

/**
 * The editor's bindings for the input mode in force, which a focused preview answers: `editor`
 * always, and `mode.desktop` or vim's normal mode — a preview takes no text, so never insert.
 */
function previewBindings() {
  const mode = editor?.isVimMode() === true ? 'vim.normal' : 'mode.desktop';
  return keybindings.bindings.filter(
    (binding) =>
      binding.when !== undefined &&
      EDITOR_CONTEXTS.has(binding.when) &&
      (binding.when === 'editor' || binding.when === mode),
  );
}

/** The letters the table holds with Alt, read at the keystroke as the table is (TYTO-264). */
function takenAltLetters(): ReadonlySet<string> {
  return altLettersTaken(
    keybindings.bindings.map((binding) => concreteKey(binding, state.platform)),
  );
}

/**
 * The drawn menu row (TYTO-244, ADR 0078), on Windows and Linux only: macOS keeps its native
 * menu bar and hides the drawn title bar. Undefined until `load` has asked main for the model.
 */
let menuRow: MenuRow | undefined;

/** Asks main for the installed menu and draws its names; again after the language changes. */
async function drawMenuRow(bridge: TytoBridge): Promise<void> {
  if (state.platform === 'darwin') return;
  if (menuRow === undefined) {
    const container = document.querySelector<HTMLElement>('.title-bar__menu');
    if (container === null) return;
    menuRow = new MenuRow(container, (id, at) => bridge['menu:popup']({ id, ...at }));
  }
  menuRow.draw((await bridge['menu:model']({})).menus);
}

/** `commandBar`, `panel` and global, the three contexts the window answers (ADR 0074). */
function windowContextHolds(when: KeybindingContext | undefined): boolean {
  if (when === undefined) return true;
  const barOpen = elements.commandBar?.open === true;
  if (when === 'commandBar') return barOpen;
  const panel = document.activeElement?.closest('[data-panel]');
  return (
    when === 'panel' &&
    !barOpen &&
    panel !== null &&
    panel !== undefined &&
    panel.getAttribute('data-panel') !== EDITOR_PANEL
  );
}

/** The bar's toggle, which is the window's own; every other id is the registry's. */
function runWindowCommand(id: string): boolean {
  if (id !== COMMAND_BAR_TOGGLE) return runCommand(id);
  const bar = elements.commandBar;
  if (bar === null) return false;
  // A toggle, because the muscle memory for closing a palette is the key that opened it
  // as often as it is Escape.
  if (bar.open) bar.dismiss();
  else bar.show();
  return true;
}

/**
 * The problems panel's control: a row that moves the cursor. The template picker that was the
 * second went with the BRIEF bar's last trace (TYTO-288, ADR 0085): a template is chosen with
 * "New brief from template…", the "/" menu, completion or the `template:` line.
 */
function wirePanelControls(): void {
  // Handed to the element rather than delegated from it. The hand-written panel wrote each
  // range into two `data-` attributes so that one listener here could read them back with
  // `closest()`; the element calls this with the range object itself, and the round trip
  // through the DOM is gone (ADR 0024).
  if (elements.problems !== null) elements.problems.reveal = reveal;
}

/**
 * The id the quit question files the template mode under (TYTO-44).
 *
 * The mode is not a tab, and the question counts tabs: `resolveExit` asks for ids, then saves
 * each one. Filing the mode under an id of its own is what lets unsaved template work stop a
 * quit without a second question or a second box — and it cannot collide with a tab, whose ids
 * are `doc-<n>`. Since TYTO-266 the session keeps the mode's buffers, so this id reaches the
 * question only when the session could not be written (ADR 0080 decision 5).
 */
const TEMPLATE_MODE_ID = 'template-mode';

/**
 * The template mode, loaded on first use (TYTO-44), with its ports in.
 *
 * **Loaded by `import()` and not imported, and the reason is measured.** Statically, the mode
 * took the window's bundle from 1,433,883 bytes to 2,327,834 — the manifest parser, the
 * template compiler and the linter — and every one of those bytes is evaluated before `load()`
 * registers the `app:exit-requested` listener. The same launch-and-close took 545-628 ms to
 * answer two `app:info` calls on main and 1447-1750 ms here, and `packaged.package.test.ts`,
 * which closes the app at exactly that moment, hung its 600 s `afterAll` on CI and locally: the
 * push reached a window with nobody listening and ADR 0031 keeps the app open. A window that
 * never opens the mode now never pays for it.
 *
 * `undefined` without a bridge, which is the unit test's window, and without the element.
 */
async function loadTemplateMode(): Promise<TemplateMode | undefined> {
  const bridge = window.tyto;
  const mode = elements.templateMode;
  if (bridge === undefined || mode === null || mode === undefined) return undefined;
  await import('./template-mode.js');
  await customElements.whenDefined(TEMPLATE_MODE_TAG);
  if (mode.ports === undefined) wireTemplateMode(mode, bridge);
  mode.locale = state.locale;
  mode.showIndentGuides(indentGuides);
  mode.showStickyScroll(stickyScroll);
  mode.showTabSize(tabSize);
  return mode;
}

/**
 * Hands the template mode its ports. Most are a round trip to main; `saved` and `created` are
 * what a save or a New means to the rest of the window.
 */
function wireTemplateMode(mode: TemplateMode, bridge: TytoBridge): void {
  mode.ports = {
    open: async (directory) => (await bridge['template:open']({ directory })).template,
    preview: (request) => bridge['template:preview'](request),
    save: (request) => bridge['template:save'](request),
    create: (name) => bridge['template:new']({ name }),
    confirmDiscard: async () =>
      (
        await bridge['dialog:confirm']({
          message: translate(state.locale, 'templateMode.discard.message'),
          detail: translate(state.locale, 'templateMode.discard.detail'),
          confirm: translate(state.locale, 'templateMode.discard.confirm'),
          cancel: translate(state.locale, 'templateMode.discard.cancel'),
        })
      ).confirmed,
    saved: () => {
      void afterTemplatesReread(bridge);
    },
    // The scaffold is a template more in the folder, read again exactly as a save is (TYTO-324).
    created: () => {
      void afterTemplatesReread(bridge);
    },
    // The mode is part of the session (TYTO-266), kept on the same pause as the tabs.
    changed: () => {
      keepSessionSoon();
    },
    // Back into the focused group's pane, where the person was before the mode (TYTO-286).
    closed: () => {
      focusedPane()?.view.focus();
    },
  };
}

/**
 * Main has read the folders again — a template was saved, or the installed plugins started and
 * their packs joined the search (ADR 0046) — so every open brief is compiled again. The first is
 * TYTO-44's third acceptance criterion; the second is why a brief that names an installed
 * template, open before the plugins had started, stops being `E_UNKNOWN_TEMPLATE` untouched.
 *
 * **Every** open brief and not only the ones naming the template, because a save can rename
 * it: a brief that named the old name stops resolving and one that named the new name starts,
 * and both need the answer. It is one compile per tab, and background tabs are updated without
 * a repaint, exactly as a late answer to their own typing is (`request`).
 */
async function afterTemplatesReread(bridge: TytoBridge): Promise<void> {
  // The folder may now hold one template more, or one fewer — the picker's list and the
  // footer's count come from the same read.
  const chosen = await bridge['templates:folder']({});
  state.templatesFolder = chosen.folder;
  state.templatesFound = chosen.found;
  await refreshTemplates(bridge);
  await Promise.all(
    workspace.documents
      .filter((document_) => document_.kind === undefined)
      .map((document_) => request(bridge, document_.id, contentOf(document_))),
  );
  repaint();
}

async function load(): Promise<void> {
  const bridge = window.tyto;

  if (bridge !== undefined) {
    // **First, before anything is awaited** (TYTO-44, ADR 0039). Main does not ask a page that
    // has not said it is listening, and lets the quit through instead — safe only while nothing
    // here can hold unsaved text, which is why this comes before every other line of `load()`.
    // A push that arrived during the three awaits that used to precede it reached a page with no
    // listener, and the app never quit. No unsubscribe is kept: the subscription and the page
    // have the same lifetime by construction.
    listenForExit(
      {
        onRequest: (handler) => {
          bridge.on('app:exit-requested', ({ askId }) => {
            handler(askId);
          });
        },
        acknowledge: (askId) => {
          void bridge['app:exit-ack']({ askId });
        },
        listening: () => {
          void bridge['app:exit-listening']({});
        },
      },
      (askId) => answerExitRequest(bridge, askId),
    );
    // The page's own `window.close()`, which main is never told about, sent to the same
    // question (TYTO-250). Registered right after the listener: until main has heard
    // `app:exit-listening` it overrules this veto, as it lets every other quit through then.
    pageClose = holdPageClose({
      onNavigate: (handler) => {
        navigationOf(window)?.addEventListener('navigate', (event) => {
          const navigation = event as unknown as NavigateEventFields;
          handler({
            sameDocument: navigation.destination.sameDocument,
            download: navigation.downloadRequest !== null,
          });
        });
      },
      onBeforeUnload: (vetoes) => {
        window.addEventListener('beforeunload', (event) => {
          if (vetoes()) event.preventDefault();
        });
      },
    });

    // The theme's colours over the token file's, which painted the first frame (TYTO-208). Not
    // awaited: a theme an installed plugin contributes waits for the plugins to start.
    showTheme(bridge, () => bridge['theme:current']({}));

    const info = await bridge['app:info']({});
    state.version = info.version;
    state.platform = info.platform;
    // Which frame the window has: macOS keeps the system's, so `shell.css` hides the drawn
    // title bar there (TYTO-244, ADR 0078).
    document.documentElement.dataset['platform'] = info.platform;
    state.templates = info.templates;
    if (isLocale(info.locale)) state.locale = info.locale;
  }

  // The layout before the first arrange, so the window opens in the shape it was left in
  // rather than snapping from the default to it while somebody watches.
  if (bridge !== undefined) layout = (await bridge['layout:get']({})).layout;

  registerPanelCommands();
  registerDocumentCommands();
  // Arranged **before** anything is looked up: there are no panels in the document until
  // the dock has made them, so every `getElementById` before this line would answer null.
  // `applyLayout` also lays out the editor groups, which is what makes `#editor` (TYTO-286).
  await applyLayout(false);
  if (bridge !== undefined) void loadPluginPanels(bridge);
  if (bridge !== undefined) void loadSettingsOutline(bridge);
  wireKeybindingDispatcher();
  if (bridge !== undefined) await drawMenuRow(bridge);
  wireSplitters(document, () => layout, {
    locale: state.locale,
    onClose: (panelId) => {
      void changeLayout(withPanelOpen(layout, panelId, false));
    },
    onResize: (panelId, size, settled) => {
      layout = withPanelSize(layout, panelId, size);
      void applyLayout(settled);
    },
  });

  if (bridge !== undefined) {
    // A File menu item was picked (TYTO-124). Straight into `runCommand`, which is the same
    // door the command bar knocks on — the id crossed the bridge precisely so that nothing
    // else had to.
    //
    // A command the registry does not hold returns `false` and is ignored, which is the right
    // answer to a menu built against an older table: a window that threw here would be a
    // window a stale menu could crash.
    bridge.on('command:run', ({ id }) => {
      runCommand(id);
    });

    // The queue changed (TYTO-45). Heard whether or not the panel is open, and ignored while
    // it is closed: the panel asks once when it opens, so nothing is lost by not listening.
    bridge.on('queue:changed', () => {
      if (elements.queuePanel !== null) void refreshQueue();
    });

    // `settings.json` changed or refused a screen's change (TYTO-206).
    bridge.on('settings:changed', (change) => {
      void settingsChanged(bridge, change);
    });

    // `keybindings.json` changed on disk (TYTO-207). Subscribed before the first read below,
    // so a save between the two is not lost; a repeat of the same text resolves the same table.
    bridge.on('keybindings:changed', ({ text }) => {
      keybindingsChanged(bridge, text);
    });
    // Before the editor is made, so it is born with the person's keys and not reset after.
    readUserKeybindings(bridge, (await bridge['keybindings:read']({})).text);

    // `snippets.json` the same way (TYTO-277): subscribed first, then read once.
    bridge.on('snippets:changed', ({ text }) => {
      snippetsChanged(bridge, text);
    });
    readUserSnippets(bridge, (await bridge['snippets:read']({})).text);

    // A newer version (TYTO-131, ADR 0069). Subscribed first and asked second: the check runs
    // from the moment main starts, and a push into a page that was not yet listening is
    // dropped without a trace (ADR 0039), so the question is what catches anything earlier.
    bridge.on('update:changed', () => {
      void refreshUpdate(bridge);
    });
    once(elements.updateNotice, 'click', () => {
      void bridge['update:act']({});
    });
    void refreshUpdate(bridge);
  }

  if (bridge !== undefined) {
    // Before the list, because the list's diagnostics depend on it: a folder that brought no
    // templates is a row in the problems panel, and that row cannot be built without knowing
    // there is a folder (TYTO-122).
    const chosen = await bridge['templates:folder']({});
    state.templatesFolder = chosen.folder;
    state.templatesFound = chosen.found;

    // Asked once here, and again only when the folder changes. A picker that re-asked per
    // click would be re-reading manifests that cannot have changed in between.
    await refreshTemplates(bridge, false);
  }

  if (elements.editor !== null) {
    // Created once and never again: the editor panel is `fixed`, so the dock never removes
    // its element and `#editor` is the same node for the life of the window. A panel that
    // could close would have to hand its buffer somewhere first, which is what makes
    // `fixed` a record field rather than a rule in the dock (`shared/layout.ts`).
    // The registry goes in here, which is what makes `Mod-z` the registry's undo rather
    // than CodeMirror's: an app-level command sitting on top of the stack has to come off
    // before the text underneath it, and only the registry knows about both.
    editor = createEditor(elements.editor, {
      doc: '',
      commands: registry,
      // Both input modes' halves of the one table: the desktop set with vim off, and save
      // and render with it on. The bar reads the same table (`shownBindingsOf`).
      keymap: keymapSetFor(false, keybindings),
      vimKeymap: keymapSetFor(true, keybindings),
      // The search panel's words, which are the catalogue's even though the panel is
      // CodeMirror's. `applyLocale` is what keeps them current afterwards.
      searchPhrases: searchPhrasesFor(state.locale),
      // The status bar shows vim's mode (TYTO-248), so the library's own line would say it
      // twice. Its `:` prompt and its notifications still open in its own panel.
      vimStatus: false,
      // Spaces per indent level (TYTO-297); the theme's answer brings the saved one.
      tabSize,
      // How a `|` line's columns are drawn (TYTO-298); the theme's answer brings the saved one.
      briefColumns,
      // Slots, adjustments, enum values and plugin directives after `::`, and the
      // underline, both fed from the preview's answer. No delay of the linter's own: the
      // preview's debounce is the pause, and a second one would only add to it.
      // The "/" menu beside them (TYTO-276): the templates, read at each opening. The
      // person's snippets in both lists (TYTO-277), and Tab and Shift+Tab stepping through any
      // open list — first, so it is above the snippet's own field keys.
      extensions: [
        tabThroughCompletions(),
        briefLint(analysis.analyzer, { delay: 0 }),
        briefCompletion(),
        briefSnippets(() => userSnippets),
        slashCompletion([
          templatesSlashSource(),
          snippetsSlashSource(
            () => translate(state.locale, 'slash.section.snippets'),
            () => userSnippets,
          ),
        ]),
      ],
    });
    // Narrowed once, because `editor` is a module-level `let` and TypeScript widens it
    // again inside every callback below.
    const handle = editor;
    // Both before anything else can touch the document, and in this order: the workspace
    // takes the state CodeMirror was born with, and then subscribes to every transaction
    // that moves it. From here the store is the owner and the view is a viewport onto it
    // (D1, TYTO-115) — there is no window in which a keystroke lands somewhere this record
    // does not follow.
    adoptEditorState(handle);
    // Light or dark as the system is, now and whenever it changes (TYTO-96). The colours
    // follow the tokens on their own; this is CodeMirror's base flag, and `restore` brings
    // every other tab up to it when it is shown.
    followScheme((scheme) => {
      handle.setTheme(scheme);
    });
    handle.onUpdate((next, view) => {
      // Into the document **the pane it happened in** is showing — never the active one
      // (TYTO-286). With groups a transaction can come from a pane nobody is looking at: a
      // lint answer, a copy from the pane beside it. A follower's state is not the record:
      // its change was copied into the primary, whose own update lands here.
      const shown = paneOfView(view);
      const documentId = shown === undefined ? undefined : shownIn.get(shown[0]);
      if (shown === undefined || documentId === undefined) return;
      // The header row of the group the transaction happened in, with the status bar: each
      // group shows its own caret (TYTO-273).
      paintBreadcrumb(shown[0]);
      if (isFollower(next)) {
        // Its caret moved, which the status bar shows; its text reaches the record by the copy.
        paintStatusBar();
        return;
      }
      workspace = updateDocument(workspace, documentId, (document_) => ({
        ...document_,
        state: next,
      }));
      // The cursor moved or the text did: the bar's Ln/Col reads the state just written.
      paintStatusBar();
      // And the session keeps where the cursor is (TYTO-265), a pause after it stops moving.
      keepSessionSoon();
    });
    handle.onVimStatus((status) => {
      vimStatus = status;
      paintStatusBar();
    });
    // The bindings are read off the keymap set the editor is running, so the bar can only
    // be painted once there is an editor to ask.
    paintCommandBar();
    if (bridge !== undefined) {
      // Repainted on every keystroke and not only on the answer: the picker shows the
      // template the *brief* names, so typing the line by hand has to move it too.
      handle.onChange((_value, view) => {
        // The id is read now rather than inside the timeout: a person can switch tabs
        // before the compile fires, and this edit belongs to the document the pane it was
        // typed in was showing (TYTO-286) when the key was pressed.
        const documentId = documentShownBy(view);
        if (documentId === undefined) return;
        // The two things the unsaved marker paints, and only those two (TYTO-112).
        //
        // There used to be an `if` here, because the marker was a flag and a flag has an
        // edge: it was set on the first keystroke and the window was repainted once. A
        // comparison has no edge — it can change back — so the dot and the title are
        // repainted per keystroke instead, and the `if` was replaced by making that cheap
        // rather than by looking for the moment it flipped. `paintTabs` is Lit keyed by
        // document id and rewrites only the tab that moved (ADR 0024); `paintTitle` is one
        // `textContent`. What stays out of this path is `repaint`, whose `[data-i18n]` walk
        // over the whole window is the expensive part and has nothing to do with the dot.
        //
        // What the comparison itself costs was measured rather than assumed, because it is
        // one `doc.toString()` per **open** tab and not per window: 0.0074 ms per keystroke
        // for five tabs of 1 KB, 0.053 ms for five of 10 KB, 0.43 ms for five of 100 KB.
        // A frame is 16.7 ms. It stops being free at five tabs of a megabyte (7.3 ms), and
        // a brief that size is not a thing this app has seen.
        paintTabs();
        paintTitle(document, shellState());
        paintPanel();
        // The workspace's text, which `onUpdate` has already written for this very
        // transaction — the editor tells the store before it tells anybody else, and that
        // order is asserted in `packages/editor/src/editor.test.ts`. Reading the pane here
        // would give the same string today and the wrong one the moment a second pane
        // exists.
        const edited = documentOf(workspace, documentId);
        if (edited === undefined) return;
        if (edited.kind !== undefined) askAppFile(bridge, documentId);
        else ask(bridge, documentId, contentOf(edited));
        // Typing changes no tab but the draft, and a draft is what a crash would cost.
        keepSessionSoon();
      });
      // Once on load as well: a brief restored into the buffer should show, and the first
      // answer is what fills the format tabs.
      void request(bridge, active().id, activeText());
      // The tabs the last session left (TYTO-113), now that there is an editor to build them.
      await restoreSession(bridge, handle);
    }
  }

  // Asked once the window is up rather than during startup: the list is what the command
  // bar shows, nothing on screen depends on it, and a folder read that delays the first
  // paint buys nothing.
  void refreshRecent();

  repaint();
}

// The shell's own strings — the heading, the footer, the title — before anything is asked
// of main. The docks are empty at this point and `paint` simply finds nothing in them,
// which is the correct amount of work for a window that has not been arranged yet.
// Painted once before the round trip as well, so the window is never blank while main
// answers — the strings are already correct for the default locale, and only the version
// and the platform arrive late.
// Before both, because `load()` is async and its rejection is one of the two things this
// catches, and a throw inside `repaint()` on a locale that is missing a key is the other
// (TYTO-132).
installErrorReporting(window, window.tyto);

repaint();
void load();
