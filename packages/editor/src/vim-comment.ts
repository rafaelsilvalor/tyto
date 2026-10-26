import { toggleComment } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';

import type { VimOperation } from './vim-contributions.js';

/**
 * vim-commentary's `gc` as an operation a vim contribution maps keys onto (TYTO-418, ADR 0143).
 *
 * An operator, so the engine supplies the rest: `gcc` is the operator typed twice (linewise on
 * the line, as `dd`), `gc` in visual mode acts on the selection, a count and any motion or
 * text object work, and `.` repeats it. The edit is CodeMirror's `toggleComment`, which reads
 * the language's `commentTokens`: a line comment where the language has one, a block comment
 * where it has only that, as a template's `<!-- -->`. Vim's own `gc` is `toggleLineComment`,
 * which does nothing in a language without a line comment; that is the difference the switch
 * makes.
 */
const commentOperator: VimOperation = {
  kind: 'operator',
  isEdit: true,
  run: (view, _args, ranges) => {
    if (ranges.length === 0) return;
    // A linewise range ends at the start of the line after it; `toggleComment` leaves a line
    // the selection only touches at its start, as CodeMirror's line commands do.
    view.dispatch({
      selection: EditorSelection.create(
        ranges.map(({ from, to }) => EditorSelection.range(from, to)),
      ),
    });
    toggleComment(view);
    // On the first line the operator covered, as vim-commentary leaves it.
    const first = Math.min(...ranges.map(({ from }) => from));
    const line = view.state.doc.lineAt(Math.min(first, view.state.doc.length));
    view.dispatch({ selection: EditorSelection.cursor(line.from) });
  },
};

export const VIM_COMMENT_OPERATIONS: ReadonlyMap<string, VimOperation> = new Map([
  ['comment', commentOperator],
]);
