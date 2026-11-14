import {
  type CompletionContext,
  type CompletionResult,
  autocompletion,
} from '@codemirror/autocomplete';
import { type EditorState, type Extension } from '@codemirror/state';

import { SET_AGGREGATES, chainSegments, readSet } from '@tyto/recipe';

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

/** The step being typed in a `set` line, up to the cursor: `set last_due = ma`. */
const SET_AGGREGATE_BEFORE = /^set\s+[A-Za-z_][\w-]*\s*=\s*([A-Za-z_]*)$/u;

/**
 * The aggregates after `set <name> = ` (TYTO-727, ADR 0199), at the start of a line's step or
 * after a `|` that chains one. `@tyto/recipe` lists them, so a new one is offered with no
 * change here; `null` anywhere else.
 */
export function completeSetAggregate(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const column = context.pos - line.from;
  if (NOT_A_STEP.test(line.text.trimStart())) return null;
  // The last step that starts before the cursor: a trimmed segment ends before trailing blanks.
  const segment = chainSegments(line.text)
    .filter((each) => each.from <= column)
    .at(-1);
  if (segment === undefined) return null;
  const typed = SET_AGGREGATE_BEFORE.exec(line.text.slice(segment.from, column))?.[1];
  if (typed === undefined) return null;
  return {
    from: context.pos - typed.length,
    options: SET_AGGREGATES.map((name) => ({ label: name, type: 'keyword' })),
    validFor: /^[A-Za-z_]*$/u,
  };
}

/** A placeholder being typed: `{` and the start of its name, not yet closed. */
const PLACEHOLDER_BEFORE = /\{([A-Za-z_][\w-]*)?$/u;
const DECLARED = /^(?:param|const)\s+([A-Za-z_][\w-]*)/u;

/**
 * The names a step may write as `{name}` at `position` (TYTO-727, ADR 0199), as the parser
 * scopes them: every `param` and `const`, wherever they are written, and each `set` above the
 * step, a step chained earlier on its line included. In the order written, each once.
 */
export function namedValuesAt(doc: EditorState['doc'], position: number): readonly string[] {
  const names = new Set<string>();
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    const content = line.text.trimStart();
    const declared = DECLARED.exec(content)?.[1];
    if (declared !== undefined) {
      names.add(declared);
      continue;
    }
    if (NOT_A_STEP.test(content) || line.from > position) continue;
    for (const segment of chainSegments(line.text)) {
      // Only a step that ends before the cursor's: a `set` reads into the steps below it.
      if (line.from + segment.to >= position) break;
      const step = line.text.slice(segment.from, segment.to);
      const set = /^set\s+(.*)$/u.exec(step)?.[1];
      const name = set === undefined ? undefined : readSet(set)?.name;
      if (name !== undefined) names.add(name);
    }
  }
  return [...names];
}

/**
 * `{name}` in a step (TYTO-727): the named values in scope at the cursor, read from the text
 * as typed. The closing `}` is written unless the next character is one already.
 */
export function completeNamedValue(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  if (NOT_A_STEP.test(line.text.trimStart())) return null;
  const before = line.text.slice(0, context.pos - line.from);
  const match = PLACEHOLDER_BEFORE.exec(before);
  if (match === null) return null;
  const typed = match[1] ?? '';
  const names = namedValuesAt(context.state.doc, context.pos - typed.length - 1);
  if (names.length === 0) return null;
  const closed = line.text[context.pos - line.from] === '}';
  return {
    from: context.pos - typed.length,
    options: names.map((name) => ({
      label: name,
      apply: closed ? name : `${name}}`,
      type: 'variable',
    })),
    validFor: /^[\w-]*$/u,
  };
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
 * when given, completes `@./<file>.vocab.json#/<pointer>` from what the host answers. A `set`
 * step's aggregate and a `{name}` come from the text itself (TYTO-727).
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
    recipeLanguage.data.of({ autocomplete: completeSetAggregate }),
    recipeLanguage.data.of({ autocomplete: completeNamedValue }),
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
