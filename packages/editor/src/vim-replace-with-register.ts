import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { type OperatorFn, Vim } from '@replit/codemirror-vim';

import type { VimOperation } from './vim-contributions.js';
import { viewOf } from './vim-mode.js';
import { offsetOf, positionOf } from './vim-positions.js';

/**
 * ReplaceWithRegister's `gr` as an operation a vim contribution maps keys onto (TYTO-419,
 * ADR 0143 amendment): the text a motion covers replaced by a register, which is left as it
 * was, so the same value can be pasted over one target after another.
 *
 * An `engine` operator rather than a typed one because it needs the register the person named
 * (`"agrw`), and the typed `operator` kind hands an operation its contribution's args only.
 * Being an operator, `grr` (the operator typed twice), a count, visual `gr` and `.` come from
 * the engine. The register is the engine's own, so `"+gr` reads what vim last put in `+`,
 * not the system clipboard.
 */

/** A target as offsets, and whether it is whole lines. */
export interface ReplaceTarget {
  readonly from: number;
  readonly to: number;
  readonly linewise: boolean;
}

/**
 * The edit for one target. A linewise register's last line break and a linewise target's are
 * both left out, so lines over a word drop the break and a word over `grr` keeps the line's.
 */
export function replacement(
  text: string,
  target: ReplaceTarget,
  register: { readonly text: string; readonly linewise: boolean },
): { from: number; to: number; insert: string } {
  const insert =
    register.linewise && register.text.endsWith('\n') ? register.text.slice(0, -1) : register.text;
  const to = target.linewise && target.to > target.from && text[target.to - 1] === '\n';
  return { from: target.from, to: to ? target.to - 1 : target.to, insert };
}

const replaceOperator: VimOperation = {
  kind: 'engine',
  type: 'operator',
  isEdit: true,
  define: (engineName) => {
    const operator: OperatorFn = (adapter, operatorArgs, ranges) => {
      const view: EditorView | undefined = viewOf(adapter);
      if (view === undefined || ranges.length === 0) return undefined;
      // An unnamed or unknown name is the unnamed register, as the engine's own `p` reads it.
      const named = (operatorArgs as { registerName?: string }).registerName;
      const register = Vim.getRegisterController().getRegister(named);
      const source = { text: register.toString(), linewise: register.linewise };
      const text = view.state.doc.toString();
      const edits = ranges.map((range) => {
        const anchor = offsetOf(view, range.anchor);
        const head = offsetOf(view, range.head);
        const target = {
          from: Math.min(anchor, head),
          to: Math.max(anchor, head),
          linewise: operatorArgs.linewise === true,
        };
        return replacement(text, target, source);
      });
      const changes = view.state.changes(edits);
      const first = Math.min(...edits.map(({ from }) => from));
      view.dispatch({
        changes,
        selection: EditorSelection.cursor(changes.mapPos(first, -1)),
        userEvent: 'input.vim-replace-with-register',
      });
      return positionOf(view, changes.mapPos(first, -1));
    };
    Vim.defineOperator(engineName, operator);
  },
};

export const VIM_REPLACE_WITH_REGISTER_OPERATIONS: ReadonlyMap<string, VimOperation> = new Map([
  ['replaceWithRegister', replaceOperator],
]);
