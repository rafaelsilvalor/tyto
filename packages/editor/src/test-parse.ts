import { ensureSyntaxTree, language, syntaxTree } from '@codemirror/language';
import { type EditorState } from '@codemirror/state';

/**
 * Bounds the loop below so a parser that stops making progress fails the test instead of
 * hanging it. Far beyond any fixture here: every call advances the parse at least one step.
 */
const MAX_PARSE_CALLS = 100_000;

/**
 * `state`, with `syntaxTree` covering the whole document — whatever the clock does. Test-only.
 *
 * **Every test that reads a fold range or a sticky line goes through here** (TYTO-306), because
 * `foldable` is CodeMirror's own and reads `syntaxTree(state)`, and two things stand between a
 * fresh state and a whole tree there:
 *
 * - The initial parse runs on a **20 ms wall-clock** budget and keeps whatever it reached. A
 *   worker descheduled for 20 ms on a busy CI runner leaves a fifty-character document half
 *   parsed. `check` went red three times on main and on PR #94, on a different fold test each
 *   time.
 * - `ensureSyntaxTree` parses further on the parse context the state field holds, but the field
 *   **snapshots the context's tree when it is built**, so `syntaxTree(state)` keeps answering
 *   with the partial one. Only a transaction promotes it: `LanguageState.apply` builds a new
 *   field once the snapshot and the context's tree differ. This is why `sticky-scroll.test.ts`
 *   failed with `ensureSyntaxTree(…, 5000)` in place — it parsed, then read the old snapshot.
 *
 * A single `ensureSyntaxTree` with a long budget is not enough either: the budget is wall
 * clock too. Instead this asks repeatedly with a budget of zero. `ParseContext.work` advances
 * the parse once before it looks at the clock, so each call makes progress and the loop ends
 * when the tree reaches the end, however slow the clock reads. Then an empty transaction
 * promotes the tree, and the result is checked rather than assumed.
 *
 * A state with no language (a JSON tab in a test that it does not fold) comes back unchanged:
 * there is no tree to finish.
 */
export function fullyParsed(state: EditorState): EditorState {
  if (state.facet(language) === null) return state;
  const end = state.doc.length;
  let calls = 0;
  while (ensureSyntaxTree(state, end, 0) === null) {
    calls += 1;
    if (calls > MAX_PARSE_CALLS) {
      throw new Error(`the parse did not reach ${String(end)} in ${String(calls)} calls`);
    }
  }
  const promoted = state.update({}).state;
  const reached = syntaxTree(promoted).length;
  if (reached < end) {
    throw new Error(`syntaxTree covers ${String(reached)} of ${String(end)} characters`);
  }
  return promoted;
}
