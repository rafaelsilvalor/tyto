import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type EditorState } from '@codemirror/state';
import { type Tree } from '@lezer/common';

/**
 * How long a reader may wait for the parser to reach the position it asked about.
 *
 * Measured rather than picked: forcing the parse to the end of a 14 942-character brief
 * costs **5.9 ms**, and to the end of a 20 903-character template **6.8 ms** (TYTO-114).
 * 100 ms is fifteen times the worst of those and still under the threshold where a person
 * notices a keystroke, so the budget is a backstop against a pathological document rather
 * than a limit anything normal meets.
 */
const PARSE_BUDGET_MS = 100;

/**
 * The syntax tree, guaranteed to cover `upto` — which `syntaxTree` does not promise.
 *
 * **`syntaxTree(state)` returns whatever the last parse happened to finish**, and on a fresh
 * state that is the first 3 000 characters at most:
 *
 * ```
 * // @codemirror/language/dist/index.js:540, LanguageState.init
 * let vpTo = Math.min(3000, state.doc.length);
 * if (!parseState.work(20, vpTo)) parseState.takeTree();
 * ```
 *
 * `takeTree` truncates at wherever the parser stopped, so past that point `resolveInner`
 * answers with the top node instead of the node the cursor is in. Every reader here then
 * falls through to its `default:` and returns nothing — which reads as "no suggestions" and
 * is really "no tree". Measured on a real document: a 400-line brief resolved `Brief` where
 * a 200-line one resolved `Adjustments`, and completion went from two options to none
 * (TYTO-114).
 *
 * The 20 ms is **wall clock, not CPU time**, which is the second half of the same defect: a
 * worker descheduled under load blows the budget on a document of any size. That is what
 * made `completion.test.ts` fail 2 runs in 9 while passing every time it ran alone.
 *
 * `ensureSyntaxTree` does the parsing the initial pass skipped and hands back the longer
 * tree. It does **not** change what `syntaxTree(state)` answers for the same state, so the
 * returned tree has to be the one that gets read — reading the state again gets the
 * truncated one back, which was measured too.
 *
 * On a budget overrun this falls back to the partial tree, which is exactly today's
 * behaviour: degraded, not broken.
 */
export function treeAt(state: EditorState, upto: number): Tree {
  return ensureSyntaxTree(state, upto, PARSE_BUDGET_MS) ?? syntaxTree(state);
}
