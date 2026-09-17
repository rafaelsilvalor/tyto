import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import {
  type Extension,
  type StateEffect,
  Annotation,
  Compartment,
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
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';

import { brief } from './brief-language.js';
import { type CommandRegistry, commandRegistryFacet } from './commands.js';
import { type SearchPhrases, searchSupport, setSearchPhrases } from './search.js';
import { type EditorKeymap, defaultKeymapSet, keymapExtension } from './keymap.js';
import { type ThemeName, themes } from './theme.js';
import { template } from './template-language.js';
import { vimMode } from './vim-mode.js';

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
export type LanguageName = 'brief' | 'template';

const languages: Readonly<Record<LanguageName, () => Extension>> = {
  brief,
  template,
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
  /** Starts in vim mode. Toggle later with `setVimMode`. */
  readonly vim?: boolean;
  /**
   * Which of the two languages the buffer holds. Defaults to `brief`.
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
 * It stays opaque all the same: {@link textOf} is the only field read this package offers,
 * and nothing outside reaches past it.
 */
export type EditorState = CodeMirrorEditorState;

/**
 * Where a pane is looking, as an effect that can be dispatched into one later.
 *
 * A type of its own because it is the half of an open document that is **not** the document:
 * an `EditorState` carries no scroll position at all, since scroll is a property of the view
 * and two views on one document scroll independently (D7). `scrollSnapshot()` is
 * CodeMirror's own way of naming one.
 */
export type ScrollPosition = StateEffect<unknown>;

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

export interface EditorHandle {
  /**
   * The view underneath, for the extension points this handle does not wrap — a host that
   * needs the selection or wants to dispatch its own transaction reaches through here.
   */
  readonly view: EditorView;
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
   * The state that came out of every transaction, for the store that owns it.
   *
   * Fires for the host's own `setValue` too: the store tracks what the document *is*,
   * irrespective of who moved it. Returns the function that stops the listener.
   */
  onUpdate(listener: (state: EditorState) => void): () => void;
  /**
   * Puts a document back in the view, undo history, cursor and scroll included. Notifies
   * `onChange` listeners of nothing.
   *
   * `scroll` left out means the top, which is where a document no pane has shown yet is.
   */
  restore(state: EditorState, scroll?: ScrollPosition): void;
  /** A new document with this editor's own extensions — an empty history, no selection. */
  blank(doc: string): EditorState;
  /** Returns the function that stops the listener. */
  onChange(listener: (value: string) => void): () => void;
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
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  foldGutter(),
  history(),
  drawSelection(),
  dropCursor(),
  rectangularSelection(),
  indentOnInput(),
  CodeMirrorEditorState.allowMultipleSelections.of(true),
  // A brief is prose, and an author typing a subtitle into a narrow pane should see the
  // whole of it. Where the line actually breaks in the artwork is the IR's answer, not
  // this one (ADR 0016).
  EditorView.lineWrapping,
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
];

export function createEditor(parent: HTMLElement, options: EditorOptions = {}): EditorHandle {
  const changeListeners = new Set<(value: string) => void>();
  const updateListeners = new Set<(state: EditorState) => void>();

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
  const keys = keymapExtension(options.keymap ?? defaultKeymapSet);
  let vimEnabled = options.vim ?? false;

  /**
   * One listener for both directions, and the order inside it carries weight.
   *
   * The store is told first, so a host that reads its own record from `onChange` finds the
   * text of the transaction that has just run rather than the one before it — which is the
   * whole of what D1 buys and the one way to lose it. Two separate `updateListener`s would
   * leave that order to the extension array, where it would be reversed one day by an edit
   * that looked like a reordering of imports.
   */
  const notify = EditorView.updateListener.of((update) => {
    // A view update with no transaction behind it is a measure, a viewport change or a
    // `setState` — the document has not moved, and D1 is about transactions.
    if (update.transactions.length === 0) return;

    for (const listener of updateListeners) listener(update.state);

    if (!update.docChanged) return;
    if (update.transactions.every((transaction) => transaction.annotation(programmatic) === true)) {
      return;
    }
    const value = textOf(update.state);
    for (const listener of changeListeners) listener(value);
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
  const extensions = [
    ...(options.extensions ?? []),
    // Ahead of `baseExtensions`, so this package's `Mod-z` is reached before the
    // `historyKeymap` in there. Both stay: when there is no registry, or nothing left
    // to undo, ours returns false and CodeMirror's own binding still works.
    inputCompartment.of(vimEnabled ? vimMode() : keys),
    ...(options.commands === undefined ? [] : [commandRegistryFacet.of(options.commands)]),
    notify,
    // Both halves of read-only, because they answer different questions: the facet
    // stops the commands, and `editable` takes the `contenteditable` off the content
    // element so the caret and the input method never arrive in the first place.
    ...(readOnly ? [CodeMirrorEditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    themeCompartment.of(themes[options.theme ?? 'light']),
    searchSupport(() => searchPhrases),
    languages[options.language ?? 'brief'](),
    ...baseExtensions(),
  ];

  const view = new EditorView({
    parent,
    state: CodeMirrorEditorState.create({ doc: options.doc ?? '', extensions }),
  });

  return {
    view,

    getValue: () => textOf(view.state),

    state: () => view.state,

    scroll: () => view.scrollSnapshot(),

    onUpdate: (listener: (state: EditorState) => void) => {
      updateListeners.add(listener);
      return () => {
        updateListeners.delete(listener);
      };
    },

    restore: (state: EditorState, scroll?: ScrollPosition) => {
      // `setState` and not a change transaction: a transaction would put the swap on the
      // undo stack, so undoing once in a fresh tab would paste the other document back in.
      view.setState(state);
      // Dispatched after, because a scroll effect is a property of the view and the view
      // has just been given a different state to measure. The phrases ride along: a state
      // carries the language it was built in, so a tab that was away while the window
      // switched would come back with the panel in the old one.
      view.dispatch({
        effects: [scroll ?? EditorView.scrollIntoView(0), setSearchPhrases.of(searchPhrases)],
      });
    },

    blank: (doc: string) => CodeMirrorEditorState.create({ doc, extensions }),

    setValue: (value: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: programmatic.of(true),
      });
    },

    onChange: (listener: (value: string) => void) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },

    setTheme: (theme: ThemeName) => {
      view.dispatch({ effects: themeCompartment.reconfigure(themes[theme]) });
    },

    setSearchPhrases: (phrases: SearchPhrases) => {
      searchPhrases = phrases;
      view.dispatch({ effects: setSearchPhrases.of(phrases) });
    },

    runCommand: (id: string) => options.commands?.run(id, { view }) ?? false,

    setVimMode: (enabled: boolean) => {
      if (enabled === vimEnabled) return;
      vimEnabled = enabled;
      view.dispatch({
        effects: inputCompartment.reconfigure(enabled ? vimMode() : keys),
      });
    },

    isVimMode: () => vimEnabled,

    destroy: () => {
      changeListeners.clear();
      updateListeners.clear();
      view.destroy();
    },
  };
}
