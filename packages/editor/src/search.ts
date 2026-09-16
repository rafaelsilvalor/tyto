import {
  closeSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
} from '@codemirror/search';
import { EditorState, type Extension, StateEffect, StateField } from '@codemirror/state';
import { type Command, type KeyBinding, keymap } from '@codemirror/view';

/**
 * Find and replace, with every word it puts on screen coming from the host.
 *
 * Two things this package normally refuses meet here. It shows user-facing text — a panel
 * with "Find", "Replace" and six toggles on it — and it has no locale, which is why
 * `commands.ts` labels undo as `'Undo'` and lets the desktop translate at the point of
 * display. A panel cannot be translated that way: the strings are inside CodeMirror's own
 * DOM and nothing outside reaches them.
 *
 * `EditorState.phrases` is the seam CodeMirror provides for exactly this, and **all 17 of
 * the panel's strings go through it** — verified against the installed package rather than
 * assumed, because one literal outside `phrase()` would have meant hand-rolling a
 * replacement panel:
 *
 * ```
 * $ grep -n 'phrase(' @codemirror/search/dist/index.js
 * 18 call sites, 1 of them the helper — 0 literals rendered any other way
 * ```
 *
 * So this package still owns no words. It owns the *keys*, and the host owns what they say.
 */

/* --------------------------------------------------------------------- phrases -- */

/**
 * Every string `@codemirror/search` renders, exactly as it spells them.
 *
 * The strings are the keys: `phrase("Find")` looks up `"Find"` and falls back to itself, so
 * a missing entry shows the English rather than nothing. That is a good failure and a quiet
 * one, which is why `SEARCH_PHRASE_KEYS` is exported — a host can be held to covering all of
 * it, and `apps/desktop` is.
 *
 * The last four are not on the panel. `current match` and `on line` are read out when the
 * selection moves to a match, and the two `$` forms are announced after a replace — the `$`
 * is CodeMirror's own placeholder, substituted with the line number or the count.
 */
export const SEARCH_PHRASE_KEYS = [
  'Find',
  'Replace',
  'next',
  'previous',
  'all',
  'match case',
  'regexp',
  'by word',
  'replace',
  'replace all',
  'close',
  'Go to line',
  'go',
  'current match',
  'on line',
  'replaced match on line $',
  'replaced $ matches',
] as const;

export type SearchPhraseKey = (typeof SEARCH_PHRASE_KEYS)[number];

/** What the panel says, in the host's language. A missing key shows CodeMirror's English. */
export type SearchPhrases = Partial<Readonly<Record<SearchPhraseKey, string>>>;

/** Carries a new set of phrases into a live editor, which is what a locale switch is. */
export const setSearchPhrases = StateEffect.define<SearchPhrases>();

/**
 * The phrases as state rather than as a compartment, which is what makes a second document
 * inherit them.
 *
 * `setTheme` next door reconfigures a compartment, and a compartment's initial content is
 * captured in the extension array `createEditor` builds once — so a state made by `blank()`
 * after a switch would carry the *original* value. A field's `create` runs when the state is
 * made and reads the current one instead. `restore` re-dispatches for the other direction: a
 * snapshot taken before a switch carries the language it was taken in.
 */
const phrasesField = (current: () => SearchPhrases): Extension => {
  const field = StateField.define<SearchPhrases>({
    create: current,
    update: (value, transaction) => {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchPhrases)) return effect.value;
      }
      return value;
    },
  });

  return [field, EditorState.phrases.compute([field], (state) => state.field(field))];
};

/* -------------------------------------------------------------------- commands -- */

/**
 * The ids, which are the editor's rather than a host's.
 *
 * Unlike `editor.save`, this package can implement these — the commands are CodeMirror's and
 * it has them. What the host still owns is the label and the keystroke's place in a palette,
 * the same way it does for undo.
 */
export const EDITOR_FIND = 'editor.find';
export const EDITOR_FIND_NEXT = 'editor.findNext';
export const EDITOR_FIND_PREVIOUS = 'editor.findPrevious';
export const EDITOR_REPLACE_NEXT = 'editor.replaceNext';
export const EDITOR_REPLACE_ALL = 'editor.replaceAll';
export const EDITOR_GOTO_LINE = 'editor.gotoLine';

/**
 * The six commands, as data for `createCommandRegistry` to register.
 *
 * A list rather than a function that takes a registry, so this module imports nothing from
 * `commands.ts` and the dependency runs one way. Registered rather than bound directly,
 * because `commands.ts` is explicit that a key, a palette entry and a click are three ways to
 * say one id: dropping `searchKeymap` in whole would add seven bindings the registry knows
 * nothing about, and `bindingsOf` in the desktop reads keystrokes off the registry's set — so
 * the bar would go on claiming those keys did not exist while they worked.
 *
 * The labels are English, like `'Undo'` and `'Redo'` beside them: this package has no locale
 * and the desktop translates at the point of display. A host with no catalogue still gets a
 * readable palette instead of a list of ids.
 *
 * **`selectNextOccurrence` and `selectSelectionMatches` are deliberately left out.** They are
 * in `searchKeymap` and they are multi-cursor editing rather than find and replace; binding
 * them here would be this card deciding something it was not asked about.
 */
export const SEARCH_COMMANDS: readonly {
  readonly id: string;
  readonly label: string;
  readonly run: Command;
}[] = [
  { id: EDITOR_FIND, label: 'Find', run: openSearchPanel },
  { id: EDITOR_FIND_NEXT, label: 'Find next', run: findNext },
  { id: EDITOR_FIND_PREVIOUS, label: 'Find previous', run: findPrevious },
  { id: EDITOR_REPLACE_NEXT, label: 'Replace', run: replaceNext },
  { id: EDITOR_REPLACE_ALL, label: 'Replace all', run: replaceAll },
  { id: EDITOR_GOTO_LINE, label: 'Go to line', run: gotoLine },
];

/* ------------------------------------------------------------------ extensions -- */

/**
 * The keys that have to keep working with the focus inside the panel.
 *
 * A registry binding cannot express this. `keymapExtension` builds a `keymap.of(...)` with
 * CodeMirror's default scope, `"editor"`, and the panel's two inputs are not the editor — so
 * a `Mod-g` routed through the registry stops working the moment somebody clicks into the
 * field they are searching from. These are CodeMirror's own entries narrowed to the panel,
 * leaving the editor-scope copy to the registry, which is what keeps one table.
 *
 * `Escape` is the exception that carries both scopes: closing the panel is the one thing a
 * person expects to work whichever half has the focus, and it is not a command anybody would
 * look for in a palette.
 */
const panelScopedKeys: readonly KeyBinding[] = [
  { key: 'Mod-f', run: openSearchPanel, scope: 'search-panel' },
  { key: 'Mod-g', run: findNext, shift: findPrevious, scope: 'search-panel', preventDefault: true },
  { key: 'F3', run: findNext, shift: findPrevious, scope: 'search-panel', preventDefault: true },
  { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
];

/**
 * Everything the editor needs for find and replace, given a way to read the current phrases.
 *
 * `top: true` puts the panel above the text. The default is below, which in this app would
 * put it against the status line and the problems panel — and a find bar that appears where
 * the errors are is a find bar people mistake for an error.
 */
export const searchSupport = (current: () => SearchPhrases): Extension => [
  phrasesField(current),
  search({ top: true }),
  // Every other occurrence of what is selected, faintly. It is the half of "find" that
  // answers "how many" before anybody presses a key.
  highlightSelectionMatches(),
  keymap.of([...panelScopedKeys]),
];
