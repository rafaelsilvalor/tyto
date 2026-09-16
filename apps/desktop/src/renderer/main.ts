import { type CommandRegistry, type EditorHandle, createEditor } from '@tyto/editor';

import { type TytoBridge } from '../../shared/ipc.js';
import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  isLocale,
  translate,
} from '../../shared/i18n/index.js';
import { planTemplateEdit, templateOf } from './frontmatter.js';
import {
  type Diagnostic,
  type SourceRange,
  type Template,
  paintTemplatePicker,
  rangeOfArtwork,
  revealRange,
} from './panel.js';
import { type CommandEntry, type CommandBar, COMMAND_BAR_TAG } from './command-bar.js';
import {
  COMMAND_LABELS,
  DOCUMENT_SLOTS,
  PREVIEW_ZOOM_FIT,
  PREVIEW_ZOOM_IN,
  PREVIEW_ZOOM_OUT,
  bindingsOf,
  createDesktopRegistry,
  keymapSetFor,
  panelOfToggleCommand,
  pathOfRecentCommand,
  recentCommandId,
  selectDocumentCommandId,
  slotOfSelectCommand,
  togglePanelCommandId,
} from './commands.js';
import {
  type DocumentState,
  type Workspace,
  activeOf,
  addDocument,
  closeDocument,
  documentAtSlot,
  documentOf,
  isDisposable,
  newDocument,
  selectDocument,
  stepDocument,
  updateDocument,
  workspaceOf,
} from './documents.js';
import { type DocumentTabs, TABS_TAG } from './tabs.js';
import { type ProblemsPanel, PROBLEMS_TAG } from './problems-panel.js';
import { arrange, wireSplitters } from './dock.js';
import './panels.js';
import {
  type Layout,
  DEFAULT_LAYOUT,
  panelOf,
  withPanelOpen,
  withPanelSize,
} from '../../shared/layout.js';
import { fillLocalePicker, localeFromPicker, paint } from './shell.js';
import {
  type PreviewElements,
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

const state = {
  locale: DEFAULT_LOCALE as Locale,
  version: '—',
  platform: '—',
  templates: [] as readonly string[],
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
 * Starts as one untitled document with no snapshot in it: the buffer does not exist yet at
 * module load, and the first thing the editor is created with *is* this document. Every
 * later document is born from `editor.blank`.
 */
let workspace: Workspace = workspaceOf(newDocument(nextDocumentId()));

/** The document every painter below reads. */
const active = (): DocumentState => activeOf(workspace);

/** Changes the active document and leaves every other one exactly as it was. */
function updateActive(change: (document: DocumentState) => DocumentState): void {
  workspace = updateDocument(workspace, workspace.activeId, change);
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
 * The editor, held here because three controls now move it.
 *
 * It used to be a local in `load`, which was right while nothing outside the bridge touched
 * it. A diagnostic row scrolls it, the slide picker scrolls it and the template picker
 * edits it, so the handle is state rather than a local now.
 *
 * **One editor and several documents**, not one editor per tab. Switching hands the buffer,
 * the undo history, the cursor and the scroll over as a `DocumentSnapshot`; a second
 * CodeMirror per tab would be a second set of extensions, a second keymap and a second
 * command registry for the window to keep in step.
 */
let editor: EditorHandle | undefined;

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
let pane: PreviewElements | undefined;

function resolveElements() {
  return {
    status: byId('preview-status'),
    editor: byId('editor'),
    locale: byId<HTMLSelectElement>('locale'),
    template: byId<HTMLSelectElement>('template'),
    // By tag and not by id: the element is the panel, so what identifies it is what it is.
    // Naming the tag here is also what keeps `problems-panel.js` a runtime import rather
    // than a type-only one that the bundler would drop — and dropping it would mean the
    // custom element is never defined and the panel silently stays empty.
    problems: document.querySelector<ProblemsPanel>(PROBLEMS_TAG),
    problemsCount: byId('problems-count'),
    commandBar: document.querySelector<CommandBar>(COMMAND_BAR_TAG),
    // Outside the docks, like the command bar: the strip lists what the *window* has open,
    // so it must not disappear with a panel.
    tabs: document.querySelector<DocumentTabs>(TABS_TAG),
  };
}

/** Every element the preview pane writes into, or `undefined` if the panel is closed. */
function previewElements(): PreviewElements | undefined {
  const tabs = byId('format-tabs');
  const slide = byId<HTMLSelectElement>('slide');
  const slideLabel = byId('slide-label');
  const stage = byId('preview-stage');
  const paper = byId('preview-paper');
  const frame = byId<HTMLIFrameElement>('preview-frame');
  const empty = byId('preview-empty');
  const zoomLevel = byId('zoom-level');

  if (
    tabs === null ||
    slide === null ||
    slideLabel === null ||
    stage === null ||
    paper === null ||
    frame === null ||
    empty === null ||
    zoomLevel === null
  ) {
    // Not a failure any more, and that is the change: before the dock, a missing preview
    // node meant a broken document. Now it means the preview panel is closed, which is a
    // thing a person is allowed to do.
    return undefined;
  }
  return { tabs, slide, slideLabel, stage, paper, frame, empty, zoomLevel };
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

function paintStatus(): void {
  const status = elements.status;
  if (status === null) return;
  const current = active();

  // No frames and nothing to say about them is the state before anybody types, which the
  // stage already covers with its own message. A second empty sentence under it would be
  // noise.
  if (current.problems === 0) {
    status.textContent = current.frames.length === 0 ? '' : translate(state.locale, 'preview.ok');
    status.classList.remove('preview__status--bad');
    return;
  }

  const label = translate(state.locale, 'preview.problems');
  status.textContent = `${label}: ${String(current.problems)}`;
  // Only errors colour it. A warning is a document that still renders (ADR 0013), and
  // painting it red would make every unused slot look like a failure.
  status.classList.toggle('preview__status--bad', current.errors > 0);
}

/** The card's acceptance criterion, in `panel.ts` where a test can drive it. */
function reveal(range: SourceRange): void {
  if (editor !== undefined) revealRange(editor.view, range);
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
    };
  }

  if (elements.problemsCount !== null) {
    // The number, with no word in front of it: the panel's own heading already says what is
    // being counted, and a second label beside it would say it twice.
    elements.problemsCount.textContent = problems.length === 0 ? '' : String(problems.length);
  }

  if (elements.template !== null) {
    paintTemplatePicker(elements.template, {
      templates: panel.templates,
      current: templateOf(editor?.getValue() ?? ''),
      locale: state.locale,
    });
  }
}

/** The name a tab and the window title show, which is the catalogue's when there is none. */
const labelOf = (document_: DocumentState): string =>
  document_.name ?? translate(state.locale, 'document.untitled');

function paintTabs(): void {
  const strip = elements.tabs;
  if (strip === null) return;
  strip.locale = state.locale;
  strip.activeId = workspace.activeId;
  // A fresh array every time, for the reason the problems panel's state object is fresh:
  // Lit compares by identity and `repeat` keyed by document id is what makes rebuilding
  // this list cost only the tabs that changed.
  strip.tabs = workspace.documents.map((document_) => ({
    id: document_.id,
    label: labelOf(document_),
    dirty: document_.dirty,
  }));
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
const registry: CommandRegistry = createDesktopRegistry({
  stepZoom: (direction) => {
    if (pane === undefined) return;
    // A step from whatever is on screen, the same as the buttons: the first step after
    // `fit` moves from the size the user is looking at.
    const from = paintPreview(pane, active());
    updateActive((document_) => ({ ...document_, zoom: stepZoom(from, direction) }));
    repaint();
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
    state.locale = state.locale === 'pt-BR' ? 'en' : 'pt-BR';
    // The picker is a view of the locale and not its owner, so it is written rather than
    // read here; leaving it stale would make the footer disagree with the window.
    if (elements.locale !== null) fillLocalePicker(elements.locale, state.locale);
    repaint();
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
      if (editor === undefined) return;
      const documentId = workspace.activeId;
      const answer = await bridge['file:save']({
        documentId,
        text: editor.getValue(),
        saveAs,
      });
      // A dismissed dialog leaves everything alone, dirty marker included. Clearing it
      // would tell somebody their text was written when it was not.
      if (answer.document === null) return;
      const name = answer.document.name;
      workspace = updateDocument(workspace, documentId, (document_) => ({
        ...document_,
        name,
        dirty: false,
      }));
      repaint();
      void refreshRecent();
    });
  },

  restoreLayout: () => {
    void changeLayout(DEFAULT_LAYOUT);
  },

  closeDocument: () => {
    void requestClose(workspace.activeId);
  },

  stepDocument: (direction) => {
    activate(stepDocument(workspace, direction));
  },

  toggleVimMode: () => {
    if (editor === undefined) return;
    editor.setVimMode(!editor.isVimMode());
    // The bindings change with the mode — vim has no `Mod-z`, because undo is `u` and
    // belongs to the vim engine — so the bar has to be told what it now shows.
    paintCommandBar();
  },
});

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
 * Writes the editor's buffer back into the active document, before anything takes it away.
 *
 * The one call that keeps a tab a place rather than a reload: the snapshot carries the undo
 * history, the cursor and the scroll, none of which a string would. Everything that changes
 * which document the editor is holding calls this first.
 */
function captureActive(): void {
  if (editor === undefined) return;
  const snapshot = editor.snapshot();
  updateActive((document_) => ({ ...document_, snapshot }));
}

/** Puts a document in the editor and in front of every panel. */
function activate(id: string): void {
  if (id === workspace.activeId || documentOf(workspace, id) === undefined) return;
  captureActive();
  workspace = selectDocument(workspace, id);
  restoreActive();
  repaint();
}

/**
 * Hands the editor whatever the active document was holding when it was put down.
 *
 * And puts the caret back in it. Clicking a tab moves focus to the tab's own button, and a
 * person who has just chosen a document wants to type into it — every editor does this, and
 * without it the first keystroke after a switch goes nowhere a person can see.
 */
function restoreActive(): void {
  if (editor === undefined) return;
  const snapshot = active().snapshot;
  if (snapshot !== undefined) editor.restore(snapshot);
  editor.view.focus();
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
  opened: { name: string; text: string } | null,
  documentId: string | null,
  wanted: string,
): void {
  if (opened === null || documentId === null) return;

  if (documentId !== wanted) {
    activate(documentId);
    return;
  }
  if (editor === undefined) return;

  const created: DocumentState = {
    ...newDocument(documentId, editor.blank(opened.text)),
    name: opened.name,
  };

  captureActive();
  const current = active();
  workspace = isDisposable(current)
    ? {
        // The empty tab the window opened on is replaced rather than pushed aside, and only
        // that one: `isDisposable` is false the moment anybody types a character.
        documents: workspace.documents.map((document_) =>
          document_.id === current.id ? created : document_,
        ),
        activeId: created.id,
      }
    : addDocument(workspace, created);

  restoreActive();
  repaint();
  void withBridge((bridge) => request(bridge, created.id, opened.text));
  void refreshRecent();
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
      panel.installation = [
        {
          severity: 'error',
          code: 'E_FILE_NOT_FOUND',
          message: `${translate(state.locale, 'file.missing')}: ${name}`,
        },
        ...panel.installation.filter((item) => item.code !== 'E_FILE_NOT_FOUND'),
      ];
      repaint();
      // Listed again, so an entry that is gone is marked gone rather than looking untried.
      void refreshRecent();
      return;
    }

    adopt(answer.document, answer.documentId, wanted);
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

  if (target.dirty) {
    const bridge = window.tyto;
    if (bridge !== undefined) {
      const answer = await bridge['dialog:confirm']({
        message: translate(state.locale, 'document.discard.message'),
        detail: `${labelOf(target)}: ${translate(state.locale, 'document.discard.detail')}`,
        confirm: translate(state.locale, 'document.discard.confirm'),
        cancel: translate(state.locale, 'document.discard.cancel'),
      });
      if (!answer.confirmed) return;
    }
  }

  closeTab(id);
}

/** Takes a tab out of the window, and tells main to stop holding its path. */
function closeTab(id: string): void {
  const timer = pending.get(id);
  if (timer !== undefined) clearTimeout(timer);
  pending.delete(id);
  gates.delete(id);
  void withBridge(async (bridge) => {
    await bridge['file:close']({ documentId: id });
  });

  const before = workspace.activeId;
  if (id === before) captureActive();
  // Closing the last tab leaves an empty one rather than an empty window: there would be
  // nowhere to type, and typing is the state this app opens in.
  workspace = closeDocument(workspace, id, () => newDocument(nextDocumentId(), editor?.blank('')));
  if (workspace.activeId !== before) restoreActive();
  repaint();
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
        const target = documentAtSlot(workspace, slot);
        if (target !== undefined) activate(target.id);
      },
    });
  }
}

/** The catalogue key a panel is named by in a list of panels. */
const PANEL_NAMES: Readonly<Record<string, CatalogueKey>> = {
  editor: 'panel.editor',
  preview: 'panel.preview',
  problems: 'panel.problems',
};

/** Every command the registry holds, translated and with the key that runs it. */
function commandEntries(): readonly CommandEntry[] {
  const bindings = bindingsOf(keymapSetFor(editor?.isVimMode() ?? false), state.platform);

  return registry.list().flatMap((command) => {
    const key = COMMAND_LABELS[command.id];
    const binding = bindings[command.id];
    // Three commands build their label from a word plus something that is not the
    // catalogue's: a recent file's own name, a panel's name, and a tab's. All are resolved
    // at display time so that switching language needs no re-registration.
    const own = command.label ?? command.id;
    const panelId = panelOfToggleCommand(command.id);
    const panelName = panelId === undefined ? undefined : PANEL_NAMES[panelId];
    const slot = slotOfSelectCommand(command.id);

    // A slot past the last tab is left out rather than shown doing nothing. The command
    // stays registered, because the keystroke table is fixed and a `Mod-7` pressed with six
    // tabs open should be a key that does nothing, not a key that runs the wrong tab.
    const tab = slot === undefined ? undefined : documentAtSlot(workspace, slot);
    if (slot !== undefined && tab === undefined) return [];

    const label =
      pathOfRecentCommand(command.id) !== undefined
        ? `${translate(state.locale, 'command.file.recent')}: ${own}`
        : tab !== undefined
          ? `${translate(state.locale, 'command.document.select')}: ${labelOf(tab)}`
          : panelId !== undefined
            ? `${translate(state.locale, 'command.layout.togglePanel')}: ${
                panelName === undefined ? own : translate(state.locale, panelName)
              }`
            : key === undefined
              ? own
              : translate(state.locale, key);

    return [
      {
        id: command.id,
        label,
        ...(binding === undefined ? {} : { binding }),
      },
    ];
  });
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

  elements = resolveElements();
  pane = previewElements();
  wirePreviewControls(window.tyto === undefined);
  wirePanelControls();
  wireCommandBar();
  wireTabs();
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

function repaint(): void {
  const current = active();
  paint(document, {
    ...state,
    // The title is the active tab, which is the whole of point 5 of the card.
    document: { name: current.name, dirty: current.dirty },
  });
  if (pane !== undefined) paintPreview(pane, current);
  paintStatus();
  paintPanel();
  paintTabs();
  paintCommandBar();
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

  workspace = updateDocument(workspace, documentId, (document_) => ({
    ...document_,
    frames: answer.frames,
    artworks: answer.artworks,
    selection: keepSelection(document_.selection, answer.frames, answer.artworks),
    problems: answer.diagnostics.length,
    errors: errorCount(answer.diagnostics),
    diagnostics: answer.diagnostics,
    // The brief **as asked**, not as it stands: the ranges index this text, and pairing them
    // with a buffer two keystrokes further on would show a line number that drifts.
    brief,
  }));

  if (documentId === workspace.activeId) repaint();
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

function wirePreviewControls(bridgeless: boolean): void {
  if (pane === undefined) return;
  const active_ = pane;

  // **Nothing in here asks for a render**, which is the acceptance criterion rather than an
  // optimisation: every frame of every format is already in the document's own `frames`, so
  // switching is choosing one of them. The click handler that called the bridge would be
  // the bug.
  once(active_.tabs, 'click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const format = target.getAttribute(FORMAT_ATTRIBUTE);
    if (format === null) return;
    updateActive((document_) => ({
      ...document_,
      selection: { ...document_.selection, format },
    }));
    repaint();
  });

  once(active_.slide, 'change', () => {
    const artwork = active_.slide.value;
    updateActive((document_) => ({
      ...document_,
      selection: { ...document_.selection, artwork },
    }));
    repaint();
    // The card asks for both halves: the preview follows the choice, and so does the
    // editor. The range is the `::slide` directive that made this artwork, which only
    // `resolve` knew — a `Scene` carries no source position at all.
    const at = rangeOfArtwork(active().artworks, artwork);
    if (at !== undefined) reveal(at);
  });

  // The three zoom buttons run commands rather than doing the work. That is the whole of
  // what E9.12 asks for from the rest of the window: a button, a key and a bar entry are
  // three ways to say one id, and a handler that did the work here would be a fourth
  // definition of "zoom in" for the others to drift away from.
  for (const [id, command] of [
    ['zoom-fit', PREVIEW_ZOOM_FIT],
    ['zoom-in', PREVIEW_ZOOM_IN],
    ['zoom-out', PREVIEW_ZOOM_OUT],
  ] as const) {
    once(byId<HTMLButtonElement>(id), 'click', () => {
      runCommand(command);
    });
  }

  // `fit` is a function of the stage, and the stage changes with the window without any
  // state changing to notice it.
  window.addEventListener('resize', () => {
    if (active().zoom === 'fit') repaint();
  });

  if (bridgeless) pane.empty.hidden = false;
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
  if (editor === undefined) return false;
  return registry.run(id, { view: editor.view });
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

  bar.run = (id) => {
    runCommand(id);
  };
  bar.close = () => undefined;
  paintCommandBar();
}

/** The strip's two callbacks, set for the same reason and at the same time as the bar's. */
function wireTabs(): void {
  const strip = elements.tabs;
  if (strip === null) return;

  strip.select = (id) => {
    activate(id);
  };
  strip.close = (id) => {
    void requestClose(id);
  };
  paintTabs();
}

/**
 * `Mod-K`, on the window and **exactly once for the life of the window**.
 *
 * Separate from `wireCommandBar` because that one runs on every rearrange, and this must
 * not: a second listener toggles the bar a second time on the same keystroke, so with two
 * of them the palette opens and closes inside one keypress and never appears. Two arranges
 * is the ordinary case — load, then the first time anybody closes a panel — so the bug
 * arrives the moment somebody uses the feature this card adds.
 *
 * Found by the end-to-end suite, which could not open the bar after closing a panel. No
 * unit sees it: each function is right on its own and the fault is in how often one runs.
 */
function wireCommandBarShortcut(): void {
  window.addEventListener('keydown', (event) => {
    const bar = elements.commandBar;
    if (bar === null) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    // A toggle, because the muscle memory for closing a palette is the key that opened it
    // as often as it is Escape.
    if (bar.open) bar.dismiss();
    else bar.show();
  });
}

/** The panel's own two controls: a row that moves the cursor, and a picker that edits. */
function wirePanelControls(): void {
  // Handed to the element rather than delegated from it. The hand-written panel wrote each
  // range into two `data-` attributes so that one listener here could read them back with
  // `closest()`; the element calls this with the range object itself, and the round trip
  // through the DOM is gone (ADR 0024).
  if (elements.problems !== null) elements.problems.reveal = reveal;

  once(elements.template, 'change', () => {
    const picker = elements.template;
    if (picker === null || editor === undefined || picker.value === '') return;

    // An edit dispatched into the document, not a `setValue`. That is what keeps the cursor
    // where it was, puts the old template back under Ctrl+Z, and — the part that matters
    // most — notifies `onChange`, so the preview refreshes through the same path typing
    // uses. `setValue` deliberately notifies nobody.
    const edit = planTemplateEdit(editor.getValue(), picker.value);
    if (edit === undefined) return;
    editor.view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
    });
  });
}

async function load(): Promise<void> {
  const bridge = window.tyto;

  if (bridge !== undefined) {
    const info = await bridge['app:info']({});
    state.version = info.version;
    state.platform = info.platform;
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
  await applyLayout(false);
  wireCommandBarShortcut();
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

  if (elements.locale instanceof HTMLSelectElement) {
    const picker = elements.locale;
    fillLocalePicker(picker, state.locale);
    once(picker, 'change', () => {
      state.locale = localeFromPicker(picker, state.locale);
      repaint();
    });
  }

  if (bridge !== undefined) {
    // Asked once, because a registry is read at startup and held in main. A picker that
    // re-asked per click would be re-reading manifests that cannot have changed.
    const answer = await bridge['templates:list']({});
    panel.templates = answer.templates;
    // A folder that meant to be a template and is broken is why a template is missing from
    // the picker, and nothing else in the app would ever say so: the preview service replays
    // the registry's warnings and these are not among them.
    panel.installation = answer.failures.flatMap((failure) => failure.diagnostics);
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
      // The desktop's set, which is the editor's plus `Mod-o`, `Mod-Shift-s` and the tab
      // keys. Passed here rather than bound in a window listener so that the bar and the
      // editor read one table — `bindingsOf` is given this same set.
      keymap: keymapSetFor(false),
    });
    // The bindings are read off the keymap set the editor is running, so the bar can only
    // be painted once there is an editor to ask.
    paintCommandBar();
    if (bridge !== undefined) {
      const handle = editor;
      // Repainted on every keystroke and not only on the answer: the picker shows the
      // template the *brief* names, so typing the line by hand has to move it too.
      handle.onChange(() => {
        // The id is read now rather than inside the timeout: a person can switch tabs
        // before the compile fires, and this edit belongs to the document that was in the
        // editor when the key was pressed.
        const documentId = workspace.activeId;
        // Repainted only on the edge, not on every keystroke: the title and the tab are the
        // only things that change when a document goes from saved to touched, and
        // repainting the window per character to say so would be the one expensive thing in
        // this path.
        if (!active().dirty) {
          updateActive((document_) => ({ ...document_, dirty: true }));
          repaint();
        }
        paintPanel();
        ask(bridge, documentId, handle.getValue());
      });
      // Once on load as well: a brief restored into the buffer should show, and the first
      // answer is what fills the format tabs.
      void request(bridge, workspace.activeId, handle.getValue());
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
repaint();
void load();
