import {
  type CompletionContext,
  type CompletionResult,
  autocompletion,
} from '@codemirror/autocomplete';
import { type EditorState, type Extension } from '@codemirror/state';

import { chainSegments } from '@tyto/recipe';

import { NOT_A_STEP, recipeLanguage } from './recipe-language.js';

/**
 * Verb names offered at the start of a recipe line (TYTO-377), and after a `|` that chains
 * steps on one line (TYTO-712).
 *
 * The names come from the host, because only the host knows which verbs exist: the built-in
 * ones and whatever the installed plugins contribute, namespaced (`jira.pull`, ADR 0128). This
 * package takes from `@tyto/recipe` only its pure line rules (which `|` chains steps), never
 * its verbs.
 *
 * Only the verb, in v1: the first word of a line that is not a comment, a description or the
 * header, or the first word after a chaining `|`. Arguments mean something per verb, and that
 * knowledge is the verb's.
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
  // Or it is the first after a `|` that chains steps, and there `| ` already says a verb comes.
  const first = indent + typed.length === before.length;
  if (!first && !afterChainBar(line.text, before.length - typed.length)) return null;
  if (first && typed === '' && !context.explicit) return null;
  const options = verbs(context.state).map((verb) => ({ label: verb, type: 'function' }));
  if (options.length === 0) return null;
  return { from: context.pos - typed.length, options, validFor: /^[\w.-]*$/u };
}

/** Whether the word starting at `start` follows, past blanks, a `|` that chains steps. */
function afterChainBar(text: string, start: number): boolean {
  if (NOT_A_STEP.test(text.trimStart())) return false;
  const bar = text.slice(0, start).trimEnd().length - 1;
  if (bar < 0 || text[bar] !== '|') return false;
  return chainSegments(text).some((segment) => segment.bar === bar);
}

/**
 * What a `@./<file>.vocab.json#/<pointer>` may name (TYTO-402, ADR 0176), as the host answers
 * it: without `file`, the vocabulary files beside the recipe; with it, the pointers of that
 * file's tables. Only the host reads files, and only inside the recipe's folder.
 */
export type RecipeReferenceSource = (
  file: string | undefined,
) => Promise<{ readonly files: readonly string[]; readonly pointers: readonly string[] }>;

/** A data reference being typed at the end of the text before the cursor, after a blank or `=`. */
const REFERENCE_BEFORE = /(?:^|[\s=])@\.\/([^\s#"]*)(?:#([^\s"]*))?$/u;

/**
 * The completion answer for a data reference at `context.pos` (TYTO-402): the vocabulary files
 * after `@./`, and the pointers of the file named after its `#`. `null` anywhere else, so the
 * verb completion keeps the start of the line.
 */
export async function completeRecipeReference(
  context: CompletionContext,
  names: RecipeReferenceSource,
): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const typed = REFERENCE_BEFORE.exec(before);
  if (typed === null) return null;
  const file = typed[1] ?? '';
  const pointer = typed[2];
  if (pointer === undefined) {
    const { files } = await names(undefined);
    if (files.length === 0) return null;
    return {
      from: context.pos - file.length,
      // The file and its `#/`, so the pointer is what the person types next.
      options: files.map((name) => ({ label: name, apply: `${name}#/`, type: 'variable' })),
      validFor: /^[^\s#"]*$/u,
    };
  }
  if (file === '') return null;
  const { pointers } = await names(file);
  if (pointers.length === 0) return null;
  return {
    from: context.pos - pointer.length,
    options: pointers.map((name) => ({ label: name, type: 'property' })),
    validFor: /^[^\s"]*$/u,
  };
}

/**
 * Mount beside `recipe()`; `verbs` is read at each completion, so it may change. `references`,
 * when given, completes `@./<file>.vocab.json#/<pointer>` from what the host answers.
 */
export function recipeCompletion(
  verbs: RecipeVerbSource,
  references?: RecipeReferenceSource,
): Extension {
  return [
    autocompletion(),
    recipeLanguage.data.of({
      autocomplete: (context: CompletionContext) => completeRecipeVerb(context, verbs),
    }),
    ...(references === undefined
      ? []
      : [
          recipeLanguage.data.of({
            autocomplete: (context: CompletionContext) =>
              completeRecipeReference(context, references),
          }),
        ]),
  ];
}
