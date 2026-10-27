import {
  type CompletionContext,
  type CompletionResult,
  autocompletion,
} from '@codemirror/autocomplete';
import { type EditorState, type Extension } from '@codemirror/state';

import { recipeLanguage } from './recipe-language.js';

/**
 * Verb names offered at the start of a recipe line (TYTO-377).
 *
 * The names come from the host, because only the host knows which verbs exist: the built-in
 * ones and whatever the installed plugins contribute, namespaced (`jira.pull`, ADR 0128). This
 * package does not depend on `@tyto/recipe` and does not start to.
 *
 * Only the verb, in v1: the first word of a line that is not a comment, a description or the
 * header. Arguments mean something per verb, and that knowledge is the verb's.
 */
export type RecipeVerbSource = (state: EditorState) => readonly string[];

const WORD_BEFORE = /[\w.-]*$/u;

/** The completion answer at `context.pos`, or `null` when the cursor is not on a verb. */
export function completeRecipeVerb(
  context: CompletionContext,
  verbs: RecipeVerbSource,
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const indent = before.length - before.trimStart().length;
  const typed = WORD_BEFORE.exec(before)?.[0] ?? '';
  // The word being typed must be the line's first: anything before it makes this an argument,
  // and a `#` or a `|` before it is not a word, so comments and descriptions are left out too.
  if (indent + typed.length !== before.length) return null;
  if (typed === '' && !context.explicit) return null;
  const options = verbs(context.state).map((verb) => ({ label: verb, type: 'function' }));
  if (options.length === 0) return null;
  return { from: context.pos - typed.length, options, validFor: /^[\w.-]*$/u };
}

/** Mount beside `recipe()`; `verbs` is read at each completion, so it may change. */
export function recipeCompletion(verbs: RecipeVerbSource): Extension {
  return [
    autocompletion(),
    recipeLanguage.data.of({
      autocomplete: (context: CompletionContext) => completeRecipeVerb(context, verbs),
    }),
  ];
}
