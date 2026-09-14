import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
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
}

export interface EditorHandle {
  /**
   * The view underneath, for the extension points this handle does not wrap — a host that
   * needs the selection or wants to dispatch its own transaction reaches through here.
   */
  readonly view: EditorView;
  getValue(): string;
  /** Replaces the whole document. Does not notify `onChange` listeners. */
  setValue(value: string): void;
  /** Returns the function that stops the listener. */
  onChange(listener: (value: string) => void): () => void;
  setTheme(theme: ThemeName): void;
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
 * Deliberately not CodeMirror's `basicSetup`: that bundle pulls in autocompletion, lint and
 * search, and the first two are E8.2's to configure against a template manifest. What is
 * here is the part an editor is unusable without — a gutter, undo, a cursor you can see,
 * and the keymap that drives them.
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
  EditorState.allowMultipleSelections.of(true),
  // A brief is prose, and an author typing a subtitle into a narrow pane should see the
  // whole of it. Where the line actually breaks in the artwork is the IR's answer, not
  // this one (ADR 0016).
  EditorView.lineWrapping,
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
];

export function createEditor(parent: HTMLElement, options: EditorOptions = {}): EditorHandle {
  const listeners = new Set<(value: string) => void>();

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
  const keys = keymapExtension(options.keymap ?? defaultKeymapSet);
  let vimEnabled = options.vim ?? false;

  const notify = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    if (update.transactions.every((transaction) => transaction.annotation(programmatic) === true)) {
      return;
    }
    const value = update.state.doc.toString();
    for (const listener of listeners) listener(value);
  });

  const readOnly = options.readOnly ?? false;

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc ?? '',
      extensions: [
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
        ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        themeCompartment.of(themes[options.theme ?? 'light']),
        languages[options.language ?? 'brief'](),
        ...baseExtensions(),
      ],
    }),
  });

  return {
    view,

    getValue: () => view.state.doc.toString(),

    setValue: (value: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: programmatic.of(true),
      });
    },

    onChange: (listener: (value: string) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setTheme: (theme: ThemeName) => {
      view.dispatch({ effects: themeCompartment.reconfigure(themes[theme]) });
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
      listeners.clear();
      view.destroy();
    },
  };
}
