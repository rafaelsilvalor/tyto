import {
  EditorSelection,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { type MotionFn, type OperatorFn, Vim } from '@replit/codemirror-vim';

import { palette } from './theme.js';
import type { VimOperation } from './vim-contributions.js';
import { viewOf } from './vim-mode.js';
import { offsetOf, positionOf } from './vim-positions.js';

/**
 * vim-exchange as operations a vim contribution maps keys onto (TYTO-419, ADR 0143 amendment):
 * `cx{motion}` marks a span, the second `cx{motion}` swaps the two; `cxx` is a line, visual `X`
 * the selection, and `cxc` forgets the marked span.
 *
 * `c` is a whole operator in the engine, so `cx` is never matched as two keys; as surround's
 * `s`, exchange is **a motion, `x`, mapped in `operatorPending`, that reads the operator
 * pending before it**: under `change` it puts the exchange operator in its place, under the
 * exchange operator it is the current line (`cxx`). `c` is a second such motion: under the
 * exchange operator it clears (`cxc`), and under `change` it is the line, as `cc` was before
 * the motion shadowed the engine's own doubling of `c`.
 *
 * The marked span is per editor, in a `StateField` the operator adds to the view the first
 * time it runs there, and it is mapped through every change made before the second `cx`.
 */

/** A span as offsets; a linewise one leaves out its last line break. */
export interface ExchangeSpan {
  readonly from: number;
  readonly to: number;
  readonly linewise: boolean;
}

/**
 * What the second span does with the first. Disjoint spans swap; when one holds the other the
 * outer is replaced by the inner, as vim-exchange does; any other overlap cancels.
 */
export function exchangeEdit(
  text: string,
  first: ExchangeSpan,
  second: ExchangeSpan,
): { from: number; to: number; insert: string }[] {
  const textOf = (span: ExchangeSpan): string => text.slice(span.from, span.to);
  const holds = (outer: ExchangeSpan, inner: ExchangeSpan): boolean =>
    outer.from <= inner.from && inner.to <= outer.to;
  if (holds(first, second)) return [{ from: first.from, to: first.to, insert: textOf(second) }];
  if (holds(second, first)) return [{ from: second.from, to: second.to, insert: textOf(first) }];
  if (first.from < second.to && second.from < first.to) return [];
  return [
    { from: first.from, to: first.to, insert: textOf(second) },
    { from: second.from, to: second.to, insert: textOf(first) },
  ];
}

const setSpan = StateEffect.define<ExchangeSpan | null>();

const pendingSpan = StateField.define<ExchangeSpan | null>({
  create: () => null,
  update: (span, transaction) => {
    for (const effect of transaction.effects) if (effect.is(setSpan)) return effect.value;
    if (span === null || !transaction.docChanged) return span;
    const from = transaction.changes.mapPos(span.from, 1);
    const to = Math.max(from, transaction.changes.mapPos(span.to, -1));
    return { ...span, from, to };
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state): DecorationSet => {
      const span = state.field(field);
      return span === null ? Decoration.none : Decoration.set(markOf(state.doc, span), true);
    }),
});

const MARK = 'cm-tyto-exchange';

/** A line span marks its lines, so an empty line shows too; a charwise one its characters. */
function markOf(doc: Text, span: ExchangeSpan): Range<Decoration>[] {
  if (!span.linewise) {
    return span.to > span.from ? [Decoration.mark({ class: MARK }).range(span.from, span.to)] : [];
  }
  const marks: Range<Decoration>[] = [];
  for (let line = doc.lineAt(span.from); ; line = doc.line(line.number + 1)) {
    marks.push(Decoration.line({ class: MARK }).range(line.from));
    if (line.to >= span.to || line.number === doc.lines) return marks;
  }
}

/** The selection's colour, a role every theme already sets: no new token for one mark. */
const exchangeExtension: Extension = [
  pendingSpan,
  EditorView.baseTheme({ [`.${MARK}`]: { backgroundColor: palette.selection } }),
];

/** Dispatches the effect, adding the field to the view the first time exchange runs in it. */
const dispatchSpan = (view: EditorView, span: ExchangeSpan | null): void => {
  if (view.state.field(pendingSpan, false) === undefined) {
    if (span === null) return;
    view.dispatch({ effects: StateEffect.appendConfig.of(exchangeExtension) });
  }
  view.dispatch({ effects: setSpan.of(span) });
};

/** Test seam: the span `cx` marked in this view, or `null`. */
export const pendingExchange = (view: EditorView): ExchangeSpan | null =>
  view.state.field(pendingSpan, false) ?? null;

/** The engine's name for its own change operator. */
const CHANGE = 'change';
const EXCHANGE = 'exchange';

const exchangeOperator: VimOperation = {
  kind: 'engine',
  type: 'operator',
  isEdit: true,
  define: (engineName) => {
    const operator: OperatorFn = (adapter, operatorArgs, ranges) => {
      const view = viewOf(adapter);
      const range = ranges[0];
      if (view === undefined || range === undefined) return undefined;
      const anchor = offsetOf(view, range.anchor);
      const head = offsetOf(view, range.head);
      const linewise = operatorArgs.linewise === true;
      const text = view.state.doc.toString();
      const from = Math.min(anchor, head);
      let to = Math.max(anchor, head);
      if (linewise && to > from && text[to - 1] === '\n') to--;
      const span = { from, to, linewise };
      const first = pendingExchange(view);
      if (first === null) {
        dispatchSpan(view, span);
        return positionOf(view, from);
      }
      const changes = view.state.changes(exchangeEdit(text, first, span));
      const cursor = changes.mapPos(from, -1);
      view.dispatch({
        changes,
        effects: setSpan.of(null),
        selection: EditorSelection.cursor(cursor),
        userEvent: 'input.vim-exchange',
      });
      return positionOf(view, cursor);
    };
    Vim.defineOperator(engineName, operator);
  },
};

/** The line the cursor is on and the `repeat - 1` after it, as the engine's `expandToLine`. */
const currentLines: MotionFn = (_adapter, head, motionArgs) => {
  motionArgs.linewise = true;
  return { line: head.line + motionArgs.repeat - 1, ch: Infinity };
};

/** `x` after an operator: `cx` turns `c` into exchange, `cxx` is the line. */
const exchangeTarget: VimOperation = {
  kind: 'engine',
  type: 'motion',
  define: (engineName, nameOf) => {
    const motion: MotionFn = (adapter, head, motionArgs, vim, inputState) => {
      if (inputState.operator === nameOf(EXCHANGE)) {
        return currentLines(adapter, head, motionArgs, vim, inputState);
      }
      if (inputState.operator === CHANGE) {
        // The engine has already cleared `vim.inputState` for the next key; it is the motion
        // typed next that feeds the exchange operator, and the change never runs.
        vim.inputState.operator = nameOf(EXCHANGE);
        vim.inputState.operatorArgs = {};
        // The count typed before `c` (`2cxx`) would go with the cleared state; carried over.
        const repeat = inputState.getRepeat();
        if (repeat > 0) vim.inputState.prefixRepeat = [String(repeat)];
      }
      return null;
    };
    Vim.defineMotion(engineName, motion);
  },
};

/** `c` after an operator: `cxc` forgets the span, `cc` is still the line. */
const exchangeClear: VimOperation = {
  kind: 'engine',
  type: 'motion',
  define: (engineName, nameOf) => {
    const motion: MotionFn = (adapter, head, motionArgs, vim, inputState) => {
      if (inputState.operator === CHANGE) {
        return currentLines(adapter, head, motionArgs, vim, inputState);
      }
      const view = viewOf(adapter);
      if (inputState.operator === nameOf(EXCHANGE) && view !== undefined) dispatchSpan(view, null);
      return null;
    };
    Vim.defineMotion(engineName, motion);
  },
};

export const VIM_EXCHANGE_OPERATIONS: ReadonlyMap<string, VimOperation> = new Map([
  [EXCHANGE, exchangeOperator],
  ['exchange.target', exchangeTarget],
  ['exchange.clear', exchangeClear],
]);
