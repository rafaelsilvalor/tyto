import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
  startCompletion,
} from '@codemirror/autocomplete';
import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';

import { briefLanguage } from './brief-language.js';
import { treeAt } from './syntax.js';

/**
 * The "/" menu (TYTO-276): a "/" typed at the start of a line lists what can be inserted there,
 * as Notion and Obsidian do — typing filters, Enter inserts, Escape leaves the "/" as typed.
 *
 * The editor does not know what is listed. A host hands it {@link SlashSource}s — the desktop's
 * templates today, a snippets file later — and each is asked for its items every time the list
 * opens, so a templates folder that changed is read the next time and nothing is reconfigured.
 *
 * **Column 0 only, outside the frontmatter, with nothing after the cursor.** Each guard is a
 * place where "/" already means something or may: an indented body line is prose, and prose may
 * start with a path; a value in the frontmatter is YAML; and a "/" typed in front of existing
 * text is an edit to that text. `//` is the language's line comment, so the second "/" falls
 * outside `validFor` and the list closes with the comment written. An unclosed frontmatter
 * produces no `Frontmatter` node at all, so a brief being typed from scratch counts as body —
 * the same reading completion makes (`completion.ts`).
 */

/** One row of the menu. `apply` receives the span the choice replaces: the "/" and the query. */
export interface SlashItem {
  readonly label: string;
  readonly detail?: string;
  apply(view: EditorView, from: number, to: number): void;
}

/**
 * A group of rows under one heading. `items` is called each time the menu opens, with the state
 * and the span a choice would remove, so a row can say what it would do to *this* brief.
 */
export interface SlashSource {
  readonly section: string;
  items(state: EditorState, from: number, to: number): readonly SlashItem[];
}

/**
 * Asks for the menu without a "/" (`editor.insertMenu`). Dispatched just before
 * `startCompletion`; it holds until the next change to the text or the selection.
 */
export const slashRequested = StateEffect.define<null>();

const slashRequestField = StateField.define<boolean>({
  create: () => false,
  update(requested, transaction) {
    if (transaction.effects.some((effect) => effect.is(slashRequested))) return true;
    if (transaction.docChanged || transaction.selection !== undefined) return false;
    return requested;
  },
});

/** What a query can be: the same shape as a template name, so `//` is not one. */
const QUERY = /^[a-zA-Z0-9_-]*$/u;

/** The "/" and the query before the cursor, written from column 0. */
const SLASH_AT_LINE_START = /^\/[a-zA-Z0-9_-]*$/u;

/**
 * Where the menu's query starts, or `undefined` when a "/" here is just a "/".
 *
 * Returns the position right after the "/".
 */
function slashQueryStart(context: CompletionContext): number | undefined {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  if (state.sliceDoc(pos, line.to) !== '') return undefined;
  if (!SLASH_AT_LINE_START.test(state.sliceDoc(line.from, pos))) return undefined;
  if (treeAt(state, pos).resolveInner(pos, -1).name === 'Frontmatter') return undefined;
  return line.from + 1;
}

const optionsOf = (
  sources: readonly SlashSource[],
  state: EditorState,
  from: number,
  to: number,
  slash: boolean,
): Completion[] =>
  sources.flatMap((source) =>
    source.items(state, from, to).map((item): Completion => ({
      label: item.label,
      type: 'class',
      section: source.section,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
      // CodeMirror hands over the span the query covers; the "/" in front of it goes too.
      apply: (view, _completion, start, end) => {
        item.apply(view, slash ? start - 1 : start, end);
      },
    })),
  );

/** The source itself, exported so a test can drive it without the language's facet. */
export function completeSlash(
  sources: readonly SlashSource[],
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const requested = context.explicit && context.state.field(slashRequestField, false) === true;
    const from = requested ? context.pos : slashQueryStart(context);
    if (from === undefined) return null;
    const options = optionsOf(
      sources,
      context.state,
      requested ? from : from - 1,
      context.pos,
      !requested,
    );
    if (options.length === 0) return null;
    return { from, options, validFor: QUERY };
  };
}

/**
 * The "/" menu, scoped to the brief language — a settings tab or the template mode, which are
 * other languages, never get it — beside `briefCompletion` and not instead of it.
 */
export function slashCompletion(sources: readonly SlashSource[]): Extension {
  return [
    autocompletion(),
    slashRequestField,
    briefLanguage.data.of({ autocomplete: completeSlash(sources) }),
  ];
}

/**
 * Opens the menu at the cursor without a "/" — what a command bound to a key does. A choice is
 * inserted at the cursor and removes nothing but the query typed after the menu opened.
 */
export function openSlashMenu(view: EditorView): boolean {
  view.dispatch({ effects: slashRequested.of(null) });
  return startCompletion(view);
}
