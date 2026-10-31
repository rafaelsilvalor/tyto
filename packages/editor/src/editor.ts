import { defaultKeymap, historyKeymap, indentWithTab, undoDepth } from '@codemirror/commands';
import { foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import {
  type Extension,
  type StateEffect,
  Annotation,
  Compartment,
  Transaction,
  // Aliased so that the type this package re-exports below can be an **alias** rather than a
  // re-export. `export type { EditorState }` reads correctly in the source and comes out of
  // tsup's declaration rollup as `export { EditorState } from '@codemirror/state'` with the
  // `type` modifier dropped — a published `.d.ts` promising a value the bundle does not
  // carry, so `import { EditorState } from '@tyto/editor'` would typecheck and then fail to
  // link. Measured on the built `dist/`, not predicted.
  EditorState as CodeMirrorEditorState,
} from '@codemirror/state';
import {
  EditorView,
  type ViewUpdate,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  keymap,
  rectangularSelection,
} from '@codemirror/view';

import { activeLine } from './active-line.js';
import { brief } from './brief-language.js';
import { type MarkedDiagnostic, diagnosticsSpec } from './diagnostic-markers.js';
import { DEFAULT_TAB_SIZE, indentExtension } from './format-brief.js';
import { indentGuides } from './indent-guides.js';
import { stickyScroll } from './sticky-scroll.js';
import { remeasureText } from './remeasure.js';
import { type BriefColumnStyle, DEFAULT_BRIEF_COLUMNS, briefColumns } from './columns.js';
import { type CommandRegistry, commandRegistryFacet } from './commands.js';
import { type SearchPhrases, searchSupport, setSearchPhrases } from './search.js';
import { type EditorKeymap, defaultKeymapSet, keymapExtension } from './keymap.js';
import { type LineNumbersStyle, lineNumbersExtension } from './line-numbers.js';
import { type ThemeName, themes } from './theme.js';
import { json } from './json-language.js';
import { markdown } from './markdown-language.js';
import { recipe } from './recipe-language.js';
import { followerState, historyExtension, mirrored, primaryFacet } from './mirror.js';
import { template } from './template-language.js';
import { type VimStatus, vimMode } from './vim-mode.js';

/**
 * `createEditor` is the whole public surface of this package.
 *
 * The renderer process, the demo page and — later — a web build all mount an editor the
 * same way, and none of them imports CodeMirror directly. That is what "framework-agnostic"
 * buys: a React wrapper in `apps/desktop` is a `useEffect` around these four methods, and
 * swapping the framework does not reopen ADR 0006.
 */

/**
 * Marks a change this package made on the host's behalf.
 *
 * `setValue` is the host writing into the editor, and `onChange` is the editor telling the
 * host what the author did. Letting the first fire the second closes a loop: E9.2 has the
 * renderer setting the document when a file is opened and saving when it changes, which
 * would save the file it has just opened. The annotation keeps the two directions apart.
 */
const programmatic = Annotation.define<boolean>();

/** The two `LanguageSupport`s this package ships, by the name `createEditor` takes. */
/**
 * `plain` is a buffer with no grammar at all — the `manifest.yaml` beside a template, which
 * the desktop's template mode edits in a tab of its own (TYTO-44). No YAML grammar is
 * shipped: what makes a manifest right is `parseManifest`, and a colour table would only say
 * that a line is YAML, which every line in that file is.
 *
 * `json` is JSON with comments, coloured and nothing more — the desktop's `settings.json` and
 * `keybindings.json` tabs (TYTO-256). Their checks are pushed in by the host as markers.
 *
 * `markdown` is a `.md` tab's, coloured by `@lezer/markdown` with GitHub's extensions (TYTO-247).
 *
 * `recipe` is a `.recipe` file's, coloured line by line and nothing more (TYTO-377): what a
 * recipe means is `parseRecipe`'s, and the host pushes its diagnostics in.
 */
export type LanguageName = 'brief' | 'template' | 'plain' | 'json' | 'markdown' | 'recipe';

const languages: Readonly<Record<LanguageName, () => Extension>> = {
  brief,
  template,
  plain: () => [],
  json,
  markdown,
  recipe,
};

export interface EditorOptions {
  /** Initial document. Empty when omitted. */
  readonly doc?: string;
  /** Defaults to `light`. */
  readonly theme?: ThemeName;
  /** A preview pane that shows a brief without inviting an edit passes `true`. */
  readonly readOnly?: boolean;
  /**
   * Given higher precedence than the defaults — CodeMirror reads an earlier extension as
   * the stronger one — so a caller's keymap, theme or language wins. This is how E8.2 adds
   * lint markers and completion without this signature changing.
   */
  readonly extensions?: readonly Extension[];
  /**
   * The commands bindings and vim ex-commands dispatch to.
   *
   * Without one the editor still works and the bindings simply do nothing, because a
   * binding to an id nobody registered falls through. A host that wants `Mod-s` to save
   * registers `editor.save` here.
   */
  readonly commands?: CommandRegistry;
  /** Defaults to `defaultKeymapSet`. Ignored while vim mode is on, which brings its own. */
  readonly keymap?: EditorKeymap;
  /** What vim mode brings with it. Defaults to `vimKeymapSet` (TYTO-207). */
  readonly vimKeymap?: EditorKeymap;
  /** Starts in vim mode. Toggle later with `setVimMode`. */
  readonly vim?: boolean;
  /**
   * Vim's own status line under the buffer. On by default; a host that shows the mode in
   * its own status bar through {@link EditorHandle.onVimStatus} turns it off (TYTO-248).
   * Vim's `:` prompt and its notifications still open in the library's panel either way.
   */
  readonly vimStatus?: boolean;
  /**
   * Which language the buffer holds. Defaults to `brief`.
   *
   * A name rather than a `LanguageSupport`, so a host still never imports CodeMirror — the
   * same reason `theme` is `'light' | 'dark'`. It is fixed for the life of the editor: a
   * buffer is a `.brief` or a `template.html`, and a host that opens the other one is
   * opening another file.
   */
  readonly language?: LanguageName;
  /**
   * What the find-and-replace panel says, keyed by `SEARCH_PHRASE_KEYS`.
   *
   * The one place this package takes user-facing words, and it takes them because it cannot
   * translate them at the point of display the way `commands.ts` does for a label: the panel
   * is CodeMirror's own DOM. A key left out shows CodeMirror's English rather than nothing.
   */
  readonly searchPhrases?: SearchPhrases;
  /**
   * Draws a guide per indent level (TYTO-293, ADR 0088). On by default; the desktop's
   * `indentGuides` setting turns it off, live, through {@link EditorHandle.setIndentGuides}.
   */
  readonly indentGuides?: boolean;
  /**
   * Pins the head line of every block the pane's top is inside (TYTO-295, ADR 0094). On by
   * default; the desktop's `stickyScroll` setting turns it off, live, through
   * {@link EditorHandle.setStickyScroll}.
   */
  readonly stickyScroll?: boolean;
  /**
   * Spaces per indent level (TYTO-297): what Tab inserts, how wide a tab is drawn, the indent
   * guides' step and the indent Format Brief writes. 2 by default; the desktop's `tabSize`
   * setting changes it, live, through {@link EditorHandle.setTabSize}.
   */
  readonly tabSize?: number;
  /**
   * How the columns of a `|` line are told apart in a brief (TYTO-298, ADR 0097): `off`, the
   * `|` alone (`separator`, the default), even columns muted too (`alternate`), or a colour
   * per column (`perColumn`). The desktop's `briefColumns` setting changes it, live, through
   * {@link EditorHandle.setBriefColumns}.
   */
  readonly briefColumns?: BriefColumnStyle;
  /**
   * How the gutter numbers the lines (TYTO-415): `on` (the default), `relative` or `off`. The
   * desktop's `lineNumbers` setting changes it, live, through {@link EditorHandle.setLineNumbers}.
   */
  readonly lineNumbers?: LineNumbersStyle;
}

/**
 * The document of record, which the **host** owns and a view only shows (D1).
 *
 * Re-exported rather than left for the host to import from `@codemirror/state`, for the
 * reason `theme` is `'light' | 'dark'`: this package owns the CodeMirror dependency and a
 * window with tabs should not have to declare it to name the thing it is holding. The shape
 * is CodeMirror's because it *is* CodeMirror's — an `EditorState` already carries the text,
 * the undo history and the selection, and rebuilding one from a string is exactly what
 * throws an undo stack away.
 *
 * It stays opaque all the same: {@link textOf}, {@link cursorOf}, {@link selectionOf} and
 * {@link hasBeenEdited} are the reads this package offers and {@link withSelection} its one
 * write, and nothing outside reaches past them.
 */
export type EditorState = CodeMirrorEditorState;

/**
 * Where a pane is looking: the document position of the line at the top of it.
 *
 * A type of its own because it is the half of an open document that is **not** the document:
 * an `EditorState` carries no scroll position at all, since scroll is a property of the view
 * and two views on one document scroll independently (D7).
 *
 * **Plain data, so a host can write it down** (TYTO-265): the desktop keeps it in
 * `session.json` and hands it back after a relaunch. A position in the text and not a pixel
 * offset, because a pixel is an answer about one window: the same `scrollTop` in a window of
 * another width, where the long lines wrap into a different number of rows, is another line.
 * A position names the line whatever the width, and one past the end of a shorter text is
 * clamped to it.
 *
 * Within one run the pane comes back more exactly than that: `scroll()` also keeps
 * CodeMirror's own snapshot of the pixel it measured, keyed by the object it returns, and
 * `restore` uses the snapshot when it has one. A position read back from a record has none,
 * and lands with its line at the top of the pane.
 */
export interface ScrollPosition {
  readonly top: number;
}

/** The main selection as two document positions, which is what a session can write down. */
export interface SelectionRange {
  readonly anchor: number;
  readonly head: number;
}

/**
 * What a document says, read without a view.
 *
 * The point of D1 in one function. A host that keeps the state can answer "what is in this
 * document" for **every** document it holds, not only for the one a view happens to be
 * showing — which is what the store needs before it can derive anything from the text, and
 * what an editor that owned the content could never offer.
 *
 * Derived on every call rather than carried beside the state: `Text` is immutable, so the
 * string is a fact about the state and never a second copy that can disagree with it.
 */
export const textOf = (state: EditorState): string => state.doc.toString();

/** Where the main cursor is, one-based, and how many characters every range selects. */
export interface CursorPosition {
  readonly line: number;
  readonly column: number;
  readonly selected: number;
}

/** Read off the state the host already holds, for a status bar (TYTO-248). */
export function cursorOf(state: EditorState): CursorPosition {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const selected = state.selection.ranges.reduce((sum, range) => sum + range.to - range.from, 0);
  return { line: line.number, column: head - line.from + 1, selected };
}

/** The main selection's two ends (TYTO-265). Other ranges of a multiple selection are dropped. */
export function selectionOf(state: EditorState): SelectionRange {
  const { anchor, head } = state.selection.main;
  return { anchor, head };
}

/**
 * The same document with this selection, each end clamped to the text (TYTO-265).
 *
 * Clamped because the selection may have been written down against another text: a file that
 * changed on disk between two launches, or got shorter. Kept off the undo history, so a
 * restored tab still answers `false` to {@link hasBeenEdited} and undo has nothing to take back
 * that the person did not do.
 */
export function withSelection(state: EditorState, selection: SelectionRange): EditorState {
  const clamp = (position: number): number =>
    Math.min(Math.max(Math.trunc(position), 0), state.doc.length);
  return state.update({
    selection: { anchor: clamp(selection.anchor), head: clamp(selection.head) },
    annotations: Transaction.addToHistory.of(false),
  }).state;
}

/**
 * The same document with these diagnostics as its markers, replacing any it had (TYTO-256).
 *
 * For a document no pane is showing; {@link EditorHandle.showDiagnostics} is the same for the one
 * that is. A buffer in a language with no lint of its own gets the markers all the same — the
 * desktop's `settings.json` tab, checked by another process — and they map through later edits.
 * Kept off the undo history.
 */
export const withDiagnostics = (
  state: EditorState,
  diagnostics: readonly MarkedDiagnostic[],
): EditorState => state.update(diagnosticsSpec(state, diagnostics)).state;

/**
 * Whether this document's undo history holds anything — "has anybody typed here", which is
 * a different question from "is it empty now" (TYTO-120).
 *
 * A tab typed into and then emptied by hand holds no text and still holds the history that
 * can bring the text back, and only the state knows that. A document `blank()` built answers
 * `false`, and so does one undone all the way back: the undo stack is empty again, and that
 * is the stack this reads.
 *
 * A boolean and not CodeMirror's `undoDepth`, because the host wants the answer and not the
 * count, and a number would be one more piece of CodeMirror's shape outside this package.
 */
export const hasBeenEdited = (state: EditorState): boolean => undoDepth(state) > 0;

/**
 * One view of the editor: what a window with several editor groups holds per group (TYTO-286).
 *
 * Every pane of one editor shares that editor's extensions — the keymap and theme compartments,
 * the command registry and the listener that tells the host about a transaction — so a state
 * born in one pane is understood by every other, and a theme or a keymap change reaches them
 * all. A second {@link createEditor} per group would be a second set of compartments, and a
 * state moved between the two would notify the wrong listeners and be reconfigured through a
 * compartment it does not carry, with no error.
 */
export interface EditorPane {
  /**
   * The view underneath, for the extension points this handle does not wrap — a host that
   * needs the selection or wants to dispatch its own transaction reaches through here.
   */
  readonly view: EditorView;
  /** The document this pane is showing. */
  state(): EditorState;
  /** Where this pane is scrolled, measured: see {@link EditorHandle.scroll}. */
  scroll(): ScrollPosition;
  /** Puts a document in this pane: see {@link EditorHandle.restore}. */
  restore(state: EditorState, scroll?: ScrollPosition): void;
  /** {@link withDiagnostics} for the document this pane is showing. */
  showDiagnostics(diagnostics: readonly MarkedDiagnostic[]): void;
  /** Runs a registered command with this pane's view as its context. */
  runCommand(id: string): boolean;
  /** Takes the pane away. The editor's own first pane goes with {@link EditorHandle.destroy}. */
  destroy(): void;
}

export interface EditorHandle extends EditorPane {
  /**
   * The pane the editor was created with, as a pane of its own: its `destroy` takes only that
   * view away, where the handle's takes every pane. The handle's own pane methods act on it.
   */
  readonly firstPane: EditorPane;
  getValue(): string;
  /** Replaces the whole document. Does not notify `onChange` listeners. */
  setValue(value: string): void;
  /**
   * The document this view is showing, so that a store can take ownership of it (D1).
   *
   * The calls below are what a window with tabs needs and nothing else does: keep the
   * document, learn when it moves, take it away, put another one in, and make a new one. A
   * host without tabs never calls them and pays nothing for them.
   */
  state(): EditorState;
  /**
   * Where this view is scrolled, **measured** — which is why it is a call and not something
   * {@link onUpdate} hands over.
   *
   * Reading it costs a layout flush, so a host asks for it when a pane is about to be
   * pointed at another document rather than on every keystroke.
   */
  scroll(): ScrollPosition;
  /**
   * The state that came out of every transaction, for the store that owns it, and the view
   * it happened in — with several panes that is what says which document moved (TYTO-286).
   *
   * Fires for the host's own `setValue` too: the store tracks what the document *is*,
   * irrespective of who moved it. Returns the function that stops the listener.
   */
  onUpdate(listener: (state: EditorState, view: EditorView) => void): () => void;
  /**
   * Another pane over this editor's extensions, mounted in `parent` and showing an empty
   * document until the host restores one into it (TYTO-286).
   */
  createPane(parent: HTMLElement): EditorPane;
  /**
   * A copy of the document `primary` is showing, for a second pane to show: the same text and
   * selection, no history of its own (ADR 0083). Edits in either pane are copied into the
   * other, and an undo asked of the copy runs in `primary`, so the one history stays whole.
   */
  followerOf(primary: EditorPane): EditorState;
  /**
   * Puts a document back in the view, undo history, cursor and scroll included. Notifies
   * `onChange` listeners of nothing.
   *
   * `scroll` left out means the top, which is where a document no pane has shown yet is.
   */
  restore(state: EditorState, scroll?: ScrollPosition): void;
  /**
   * A new document with this editor's own extensions — an empty history, no selection.
   *
   * `language` names another language for this one document, the way a window of `.brief`
   * tabs opens its `settings.json` as plain text (TYTO-206). Such a document gets the keys,
   * the commands, the theme and search, and **not the host's `extensions`**: those are the
   * editor's language's own lint and completion, and they would read the other text as one.
   *
   * `extensions` are this one document's own, ahead of the rest: a `settings.json` tab's
   * suggestions and hover (`jsonAssist`, TYTO-304). A follower of the document (`followerOf`)
   * is built from its state, so it carries them too.
   */
  blank(doc: string, language?: LanguageName, extensions?: readonly Extension[]): EditorState;
  /**
   * {@link withDiagnostics} for the document this view is showing: its markers replaced by
   * these. Notifies `onUpdate` listeners, which is how a store holding the state learns of
   * them, and not `onChange` ones: the text did not move.
   */
  showDiagnostics(diagnostics: readonly MarkedDiagnostic[]): void;
  /**
   * The author changed the text, in `view`. Not fired for `setValue`, nor for a change copied
   * in from another pane showing the same document — that one was already reported where it
   * was typed. Returns the function that stops the listener.
   */
  onChange(listener: (value: string, view: EditorView) => void): () => void;
  setTheme(theme: ThemeName): void;
  /**
   * Changes the search panel's language, now and for every document opened afterwards.
   *
   * A host that switches locale at runtime calls this; one that does not never has to. It is
   * a method rather than a re-creation because `createEditor` is called once in a window with
   * tabs, and rebuilding the editor to change a word would throw away every buffer in it.
   */
  setSearchPhrases(phrases: SearchPhrases): void;
  /** `false` when no registry was given, or when it has no command with that id. */
  runCommand(id: string): boolean;
  /**
   * Swaps the input layer in place.
   *
   * A compartment reconfigure and not a rebuilt state, which is what makes the document,
   * the cursor, the undo history and the lint markers survive the toggle — the editor does
   * not blink, it changes what interprets the keys.
   */
  setVimMode(enabled: boolean): void;
  isVimMode(): boolean;
  /**
   * Shows or hides the indent guides in every pane and every tab, in place — a compartment, as
   * `setVimMode` is, so nothing about the documents changes (TYTO-293).
   */
  setIndentGuides(enabled: boolean): void;
  /**
   * Shows or hides the pinned head lines in every pane and every tab, in place, each pane
   * keeping its own scroll (TYTO-295).
   */
  setStickyScroll(enabled: boolean): void;
  /**
   * Changes the spaces per indent level in every pane and every tab, in place — a compartment,
   * so the text, the selection and the undo history stay (TYTO-297).
   */
  setTabSize(size: number): void;
  /**
   * Changes how the columns of a `|` line are drawn in every pane and every tab, in place — a
   * compartment, so nothing about the documents changes (TYTO-298).
   */
  setBriefColumns(style: BriefColumnStyle): void;
  /**
   * Changes how the gutter numbers the lines in every pane and every tab, in place — a
   * compartment, so nothing about the documents changes (TYTO-415).
   */
  setLineNumbers(style: LineNumbersStyle): void;
  /**
   * Makes every pane read its text's size again, after the host changed the face or the size
   * it gives the editor (TYTO-272): the line height, the character width, and everything drawn
   * from them — the indent guides and the pinned head lines.
   */
  remeasure(): void;
  /**
   * Vim's mode and pending keys as they change, and `null` when vim is off (TYTO-248).
   * Called at once with the current answer. Returns the function that stops the listener.
   */
  onVimStatus(listener: (status: VimStatus | null) => void): () => void;
  /**
   * Replaces both input modes' bindings, in place, as `setVimMode` swaps between them
   * (TYTO-207). A tab shown afterwards picks them up in `restore`, so a table that changes
   * while five tabs are open changes for all five.
   */
  setKeymaps(keymaps: { readonly normal: EditorKeymap; readonly vim: EditorKeymap }): void;
  destroy(): void;
}

/**
 * What every brief editor gets before the caller's own extensions.
 *
 * Deliberately not CodeMirror's `basicSetup`: that bundle pulls in autocompletion and lint,
 * which are E8.2's to configure against a template manifest. What is here is the part an
 * editor is unusable without — a gutter, undo, a cursor you can see, and the keymap that
 * drives them.
 *
 * Search *is* in, since E8.5, and it is not in this list: `searchSupport` goes beside the
 * theme in the per-editor extensions because it needs the phrases this editor was given, and
 * `baseExtensions` takes no arguments on purpose.
 *
 * `historyKeymap` stays even though E8.3 put a command registry in front of it. The two do
 * not fight: the registry's bindings are given higher precedence and hand the keystroke on
 * when they have nothing to undo, and an editor built with no registry at all still has a
 * working Ctrl+Z.
 */
const baseExtensions = (): Extension[] => [
  highlightActiveLineGutter(),
  activeLine(),
  foldGutter(),
  historyExtension(),
  drawSelection(),
  dropCursor(),
  rectangularSelection(),
  indentOnInput(),
  CodeMirrorEditorState.allowMultipleSelections.of(true),
  // A brief is prose, and an author typing a subtitle into a narrow pane should see the
  // whole of it. Where the line actually breaks in the artwork is the IR's answer, not
  // this one (ADR 0016).
  EditorView.lineWrapping,
  // Tab indents and Shift+Tab outdents (TYTO-183). CodeMirror binds nothing to Tab on
  // purpose, so a keyboard user can leave the editor with it; binding it takes that away,
  // and CodeMirror's own way back is Escape then Tab, which moves focus on.
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
];

export function createEditor(parent: HTMLElement, options: EditorOptions = {}): EditorHandle {
  const changeListeners = new Set<(value: string, view: EditorView) => void>();
  const updateListeners = new Set<(state: EditorState, view: EditorView) => void>();
  /** Every pane's view, the first one included: what a theme or a keymap change reaches. */
  const views = new Set<EditorView>();

  /** Swapped in place by `setTheme`, so switching does not rebuild the state. */
  const themeCompartment = new Compartment();

  /**
   * One compartment for whatever interprets the keys: a keymap set, or vim.
   *
   * Two compartments would let a host end up in vim with the default set's `Mod-z` racing
   * `u` for the same undo stack. One means the two modes are mutually exclusive by
   * construction rather than by the host remembering to turn one off.
   */
  const inputCompartment = new Compartment();

  /** The indent guides or nothing, swapped by `setIndentGuides` (TYTO-293). */
  const guidesCompartment = new Compartment();
  /** Made once, so a tab's compartment can be compared with what the editor holds now. */
  const guidesOn = indentGuides();
  /** The pinned head lines or nothing, swapped by `setStickyScroll` (TYTO-295). */
  const stickyCompartment = new Compartment();
  const stickyOn = stickyScroll();
  /**
   * The indent unit and tab width, swapped by `setTabSize` (TYTO-297). Two spaces unless the
   * host says otherwise: what a brief's block content is indented by.
   */
  const indentCompartment = new Compartment();
  /** The look of a `|` line's columns, swapped by `setBriefColumns` (TYTO-298). */
  const columnsCompartment = new Compartment();
  /** The line number gutter, or none, swapped by `setLineNumbers` (TYTO-415). */
  const numbersCompartment = new Compartment();

  /**
   * The phrases as a mutable holder rather than a value baked into the extension list.
   *
   * `blank()` builds a second state from the same `extensions` array, so anything captured
   * there is captured at construction — which is the bug `themeCompartment` would have if
   * the desktop ever switched theme with two tabs open. The field in `search.ts` reads this
   * when a state is created, so a tab opened after a locale switch is born in the new
   * language rather than the one the window started in.
   */
  let searchPhrases = options.searchPhrases ?? {};
  let keys = keymapExtension(options.keymap ?? defaultKeymapSet);
  let vimKeymap = options.vimKeymap;
  let vimEnabled = options.vim ?? false;
  const vimListeners = new Set<(status: VimStatus | null) => void>();
  let vimStatus: VimStatus | null = null;
  const reportVim = (status: VimStatus | null): void => {
    vimStatus = status;
    for (const listener of vimListeners) listener(status);
  };
  const vimInput = (): Extension =>
    vimMode({
      status: options.vimStatus ?? true,
      onStatus: reportVim,
      ...(vimKeymap === undefined ? {} : { keymap: vimKeymap }),
    });
  /** What the input compartment holds now, which every shown tab is brought up to. */
  let input: Extension = vimEnabled ? vimInput() : keys;
  /**
   * What the theme compartment holds now, for the input layer's reason: a tab built or stored
   * before the system switched to dark still holds `light`, and `restore` brings it up to this
   * (TYTO-96). The desktop switches it whenever the system does.
   */
  let theme: Extension = themes[options.theme ?? 'light'];
  /** What the guides compartment holds now, which `restore` brings every tab up to. */
  let guides: Extension = (options.indentGuides ?? true) ? guidesOn : [];
  /** What the sticky compartment holds now, for the same reason. */
  let sticky: Extension = (options.stickyScroll ?? true) ? stickyOn : [];
  /** What the numbers compartment holds now, for the same reason. */
  let numbers: Extension = lineNumbersExtension(options.lineNumbers ?? 'on');
  /** The size the indent compartment holds now, and the extension it holds for it. */
  let tabSize = options.tabSize ?? DEFAULT_TAB_SIZE;
  let indent: Extension = indentExtension(tabSize);
  /** What the columns compartment holds now, which `restore` brings every tab up to. */
  let columns: Extension = briefColumns(options.briefColumns ?? DEFAULT_BRIEF_COLUMNS);

  /**
   * One listener for both directions, and the order inside it carries weight.
   *
   * The store is told first, so a host that reads its own record from `onChange` finds the
   * text of the transaction that has just run rather than the one before it — which is the
   * whole of what D1 buys and the one way to lose it. Two separate `updateListener`s would
   * leave that order to the extension array, where it would be reversed one day by an edit
   * that looked like a reordering of imports.
   */
  /**
   * Copies a change into every other pane showing the same document (ADR 0083): the primary
   * and its followers. First, so the record already holds the text when the host hears of it.
   *
   * A change that is itself a copy goes no further — without the annotation the two panes
   * would hand the same change back and forth for ever.
   */
  const mirror = (update: ViewUpdate): void => {
    if (!update.docChanged) return;
    if (update.transactions.every((transaction) => transaction.annotation(mirrored) === true)) {
      return;
    }
    const source = update.view;
    const primary = update.state.facet(primaryFacet) ?? source;
    for (const target of views) {
      if (target === source) continue;
      if (target !== primary && target.state.facet(primaryFacet) !== primary) continue;
      target.dispatch({ changes: update.changes, annotations: mirrored.of(true) });
    }
  };

  const notify = EditorView.updateListener.of((update) => {
    // A view update with no transaction behind it is a measure, a viewport change or a
    // `setState` — the document has not moved, and D1 is about transactions.
    if (update.transactions.length === 0) return;

    mirror(update);

    for (const listener of updateListeners) listener(update.state, update.view);

    if (!update.docChanged) return;
    if (
      update.transactions.every(
        (transaction) =>
          transaction.annotation(programmatic) === true ||
          transaction.annotation(mirrored) === true,
      )
    ) {
      return;
    }
    const value = textOf(update.state);
    for (const listener of changeListeners) listener(value, update.view);
  });

  const readOnly = options.readOnly ?? false;

  /**
   * The extensions every document in this editor gets, held so that `blank` can make a
   * second one.
   *
   * A list and not a closure over `CodeMirrorEditorState.create`, because a tab's state has to be
   * built with *these* extensions: the keymap compartment, the command registry, the
   * language and the theme are what make two documents behave like the same editor rather
   * than like two editors that happen to be in one window.
   */
  const ownLanguage = options.language ?? 'brief';
  const shared = (language: LanguageName): Extension[] => [
    // Ahead of `baseExtensions`, so this package's `Mod-z` is reached before the
    // `historyKeymap` in there. Both stay: when there is no registry, or nothing left
    // to undo, ours returns false and CodeMirror's own binding still works.
    inputCompartment.of(input),
    ...(options.commands === undefined ? [] : [commandRegistryFacet.of(options.commands)]),
    notify,
    // Both halves of read-only, because they answer different questions: the facet
    // stops the commands, and `editable` takes the `contenteditable` off the content
    // element so the caret and the input method never arrive in the first place.
    ...(readOnly ? [CodeMirrorEditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    themeCompartment.of(theme),
    guidesCompartment.of(guides),
    stickyCompartment.of(sticky),
    indentCompartment.of(indent),
    columnsCompartment.of(columns),
    numbersCompartment.of(numbers),
    searchSupport(() => searchPhrases),
    languages[language](),
    ...baseExtensions(),
  ];
  const extensions = [...(options.extensions ?? []), ...shared(ownLanguage)];

  /**
   * CodeMirror's own snapshot for each position `scroll()` measured, which puts the pane back
   * to the pixel. Weak, so a position the host drops takes its snapshot with it.
   */
  const snapshots = new WeakMap<ScrollPosition, StateEffect<unknown>>();
  const scrollEffect = (
    scroll: ScrollPosition | undefined,
    state: EditorState,
  ): StateEffect<unknown> => {
    if (scroll === undefined) return EditorView.scrollIntoView(0);
    const snapshot = snapshots.get(scroll);
    if (snapshot !== undefined) return snapshot;
    // A position read back from a record: its line at the top, clamped to this text.
    const top = Math.min(Math.max(Math.trunc(scroll.top), 0), state.doc.length);
    return EditorView.scrollIntoView(top, { y: 'start', yMargin: 0 });
  };

  const paneOn = (view: EditorView): EditorPane => {
    views.add(view);
    return {
      view,

      state: () => view.state,

      scroll: () => {
        // The document height at the pane's top edge: where the scroller starts on screen,
        // less where the document starts on screen (negative once it is scrolled down).
        const height = Math.max(view.scrollDOM.getBoundingClientRect().top - view.documentTop, 0);
        const position: ScrollPosition = { top: view.lineBlockAtHeight(height).from };
        snapshots.set(position, view.scrollSnapshot());
        return position;
      },

      restore: (state: EditorState, scroll?: ScrollPosition) => {
        // `setState` and not a change transaction: a transaction would put the swap on the
        // undo stack, so undoing once in a fresh tab would paste the other document back in.
        view.setState(state);
        // A tab built before the mode or the bindings last changed still holds the input
        // layer it was born with; the editor has one input layer, and the tab shown takes it.
        if (inputCompartment.get(view.state) !== input) {
          view.dispatch({ effects: inputCompartment.reconfigure(input) });
        }
        if (themeCompartment.get(view.state) !== theme) {
          view.dispatch({ effects: themeCompartment.reconfigure(theme) });
        }
        if (guidesCompartment.get(view.state) !== guides) {
          view.dispatch({ effects: guidesCompartment.reconfigure(guides) });
        }
        if (stickyCompartment.get(view.state) !== sticky) {
          view.dispatch({ effects: stickyCompartment.reconfigure(sticky) });
        }
        if (indentCompartment.get(view.state) !== indent) {
          view.dispatch({ effects: indentCompartment.reconfigure(indent) });
        }
        if (columnsCompartment.get(view.state) !== columns) {
          view.dispatch({ effects: columnsCompartment.reconfigure(columns) });
        }
        if (numbersCompartment.get(view.state) !== numbers) {
          view.dispatch({ effects: numbersCompartment.reconfigure(numbers) });
        }
        // Dispatched after, because a scroll effect is a property of the view and the view
        // has just been given a different state to measure. The phrases ride along: a state
        // carries the language it was built in, so a tab that was away while the window
        // switched would come back with the panel in the old one.
        view.dispatch({
          effects: [scrollEffect(scroll, state), setSearchPhrases.of(searchPhrases)],
        });
      },

      showDiagnostics: (diagnostics: readonly MarkedDiagnostic[]) => {
        view.dispatch(diagnosticsSpec(view.state, diagnostics));
      },

      runCommand: (id: string) => options.commands?.run(id, { view }) ?? false,

      destroy: () => {
        views.delete(view);
        view.destroy();
      },
    };
  };

  const first = paneOn(
    new EditorView({
      parent,
      state: CodeMirrorEditorState.create({ doc: options.doc ?? '', extensions }),
    }),
  );
  const view = first.view;
  /** Every view at once, for the settings that belong to the editor and not to one pane. */
  const everyView = (effects: StateEffect<unknown>): void => {
    for (const each of views) each.dispatch({ effects });
  };

  return {
    ...first,
    firstPane: first,

    getValue: () => textOf(view.state),

    onUpdate: (listener: (state: EditorState, view: EditorView) => void) => {
      updateListeners.add(listener);
      return () => {
        updateListeners.delete(listener);
      };
    },

    createPane: (paneParent: HTMLElement) =>
      paneOn(
        new EditorView({
          parent: paneParent,
          state: CodeMirrorEditorState.create({ doc: '', extensions }),
        }),
      ),

    followerOf: (primary: EditorPane) => followerState(primary.view.state, primary.view),

    blank: (doc: string, language: LanguageName = ownLanguage, own: readonly Extension[] = []) =>
      CodeMirrorEditorState.create({
        doc,
        extensions: [...own, ...(language === ownLanguage ? extensions : shared(language))],
      }),

    setValue: (value: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: programmatic.of(true),
      });
    },

    onChange: (listener: (value: string, view: EditorView) => void) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },

    setTheme: (name: ThemeName) => {
      theme = themes[name];
      everyView(themeCompartment.reconfigure(theme));
    },

    setSearchPhrases: (phrases: SearchPhrases) => {
      searchPhrases = phrases;
      everyView(setSearchPhrases.of(phrases));
    },

    setVimMode: (enabled: boolean) => {
      if (enabled === vimEnabled) return;
      vimEnabled = enabled;
      input = enabled ? vimInput() : keys;
      everyView(inputCompartment.reconfigure(input));
    },

    isVimMode: () => vimEnabled,

    setIndentGuides: (enabled: boolean) => {
      if ((guides === guidesOn) === enabled) return;
      guides = enabled ? guidesOn : [];
      everyView(guidesCompartment.reconfigure(guides));
    },

    setStickyScroll: (enabled: boolean) => {
      if ((sticky === stickyOn) === enabled) return;
      sticky = enabled ? stickyOn : [];
      everyView(stickyCompartment.reconfigure(sticky));
    },

    setTabSize: (size: number) => {
      if (size === tabSize) return;
      tabSize = size;
      indent = indentExtension(size);
      everyView(indentCompartment.reconfigure(indent));
    },

    setBriefColumns: (style: BriefColumnStyle) => {
      const next = briefColumns(style);
      if (next === columns) return;
      columns = next;
      everyView(columnsCompartment.reconfigure(columns));
    },

    setLineNumbers: (style: LineNumbersStyle) => {
      const next = lineNumbersExtension(style);
      if (next === numbers) return;
      numbers = next;
      everyView(numbersCompartment.reconfigure(numbers));
    },

    remeasure: () => {
      for (const each of views) remeasureText(each);
    },

    onVimStatus: (listener: (status: VimStatus | null) => void) => {
      vimListeners.add(listener);
      listener(vimStatus);
      return () => {
        vimListeners.delete(listener);
      };
    },

    setKeymaps: (keymaps) => {
      keys = keymapExtension(keymaps.normal);
      vimKeymap = keymaps.vim;
      input = vimEnabled ? vimInput() : keys;
      everyView(inputCompartment.reconfigure(input));
    },

    destroy: () => {
      changeListeners.clear();
      updateListeners.clear();
      vimListeners.clear();
      for (const each of [...views]) each.destroy();
      views.clear();
    },
  };
}
