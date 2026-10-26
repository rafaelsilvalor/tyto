import type { ChangeSpec } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { type MotionFn, type OperatorFn, Vim } from '@replit/codemirror-vim';

import type { VimOperation } from './vim-contributions.js';
import { readVimKeys } from './vim-key-reader.js';
import { viewOf } from './vim-mode.js';
import { offsetOf, positionOf } from './vim-positions.js';

/**
 * vim-surround as operations a vim contribution maps keys onto (TYTO-418, ADR 0143 amendment).
 *
 * `c`, `d` and `y` are whole operators in the engine, so `cs`, `ds` and `ys` are never matched
 * as three keys: `y` wins on its own and waits for a motion. Surround is therefore **a motion,
 * `s`, mapped in `operatorPending`, that reads the operator pending before it**: under `d` it
 * deletes a pair, under `c` it changes one, and under `y` it swaps the pending yank for the
 * `surround.add` operator, so the motion typed next (`iw`, `$`, or `s` again for `yss`) feeds
 * that one instead. Visual `S` maps `surround.add` directly. The pair is read after the keys,
 * by `vim-key-reader.ts`.
 *
 * **`.` repeats with the pair that was read.** The engine records the edit before the motion
 * runs and replays it through the same objects, so the keys are written onto the motion's or
 * the operator's args once read, and a replay finds them there and does not read again.
 *
 * The pair arithmetic is on the text alone and tested without a view.
 */

interface Pair {
  readonly open: string;
  readonly close: string;
}

/**
 * What a key stands for, as tpope's surround reads it: an opening bracket is spaced (`ysiw(`
 * gives `( word )`) and a closing one or its letter is not (`ysiw)` and `ysiwb` give
 * `(word)`). `<` is spaced like the other openings; tpope's tag prompt is not here.
 */
const KEYS: Readonly<Record<string, Pair & { readonly spaced: boolean }>> = {
  '(': { open: '(', close: ')', spaced: true },
  ')': { open: '(', close: ')', spaced: false },
  b: { open: '(', close: ')', spaced: false },
  '[': { open: '[', close: ']', spaced: true },
  ']': { open: '[', close: ']', spaced: false },
  '{': { open: '{', close: '}', spaced: true },
  '}': { open: '{', close: '}', spaced: false },
  B: { open: '{', close: '}', spaced: false },
  '<': { open: '<', close: '>', spaced: true },
  '>': { open: '<', close: '>', spaced: false },
  "'": { open: "'", close: "'", spaced: false },
  '"': { open: '"', close: '"', spaced: false },
  '`': { open: '`', close: '`', spaced: false },
};

/** A text change, as offsets into the document before it. */
export interface SurroundEdit {
  readonly changes: readonly {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
  }[];
  /** Where the cursor goes afterwards, in the document after the edit. */
  readonly cursor: number;
}

/** The two characters of a pair: the offset of the opening one and of the closing one. */
interface Found {
  readonly open: number;
  readonly close: number;
}

/**
 * The quotes around `head` on its line, paired from the line's start as vim's `i"` pairs
 * them; with none around it, the first pair after it. A quote after a backslash is text.
 */
function findQuotes(text: string, head: number, quote: string): Found | undefined {
  const lineStart = text.lastIndexOf('\n', head - 1) + 1;
  const newline = text.indexOf('\n', head);
  const lineEnd = newline < 0 ? text.length : newline;
  const quotes: number[] = [];
  for (let index = lineStart; index < lineEnd; index++) {
    if (text[index] === quote && text[index - 1] !== '\\') quotes.push(index);
  }
  let after: Found | undefined;
  for (let index = 0; index + 1 < quotes.length; index += 2) {
    const open = quotes[index] as number;
    const close = quotes[index + 1] as number;
    if (open <= head && head <= close) return { open, close };
    if (after === undefined && open > head) after = { open, close };
  }
  return after;
}

/**
 * The innermost `open`…`close` around `head`, nesting counted, across lines. The cursor on
 * either bracket counts as inside, as `di(` on the `(` does.
 */
function findBrackets(text: string, head: number, pair: Pair): Found | undefined {
  let open = -1;
  if (text[head] === pair.open) open = head;
  else {
    let depth = 0;
    // From before the cursor, so a cursor on the closing bracket finds its own opening one.
    for (let index = head - 1; index >= 0; index--) {
      const char = text[index];
      if (char === pair.close) depth++;
      else if (char === pair.open) {
        if (depth === 0) {
          open = index;
          break;
        }
        depth--;
      }
    }
  }
  if (open < 0) return undefined;
  let depth = 0;
  for (let index = open + 1; index < text.length; index++) {
    const char = text[index];
    if (char === pair.open) depth++;
    else if (char === pair.close) {
      if (depth === 0) return { open, close: index };
      depth--;
    }
  }
  return undefined;
}

const findPair = (text: string, head: number, pair: Pair): Found | undefined =>
  pair.open === pair.close ? findQuotes(text, head, pair.open) : findBrackets(text, head, pair);

const isBlank = (char: string | undefined): boolean => char === ' ' || char === '\t';

/**
 * The two spans a target's pair takes: the brackets, and with an opening key also the blanks
 * just inside them, so `ds(` on `( word )` leaves `word` and `ds)` leaves ` word `.
 */
function spansOf(text: string, found: Found, spaced: boolean) {
  let openEnd = found.open + 1;
  let closeStart = found.close;
  if (spaced) {
    while (openEnd < closeStart && isBlank(text[openEnd])) openEnd++;
    while (closeStart > openEnd && isBlank(text[closeStart - 1])) closeStart--;
  }
  return {
    open: { from: found.open, to: openEnd },
    close: { from: closeStart, to: found.close + 1 },
  };
}

/** `ds{target}`: the pair around the cursor removed, or nothing when there is none. */
export function deleteSurround(
  text: string,
  head: number,
  target: string,
): SurroundEdit | undefined {
  const key = KEYS[target];
  if (key === undefined) return undefined;
  const found = findPair(text, head, key);
  if (found === undefined) return undefined;
  const spans = spansOf(text, found, key.spaced);
  return {
    changes: [
      { ...spans.open, insert: '' },
      { ...spans.close, insert: '' },
    ],
    cursor: found.open,
  };
}

/** `cs{target}{replacement}`: the pair around the cursor replaced by the other one. */
export function changeSurround(
  text: string,
  head: number,
  target: string,
  replacement: string,
): SurroundEdit | undefined {
  const key = KEYS[target];
  const next = KEYS[replacement];
  if (key === undefined || next === undefined) return undefined;
  const found = findPair(text, head, key);
  if (found === undefined) return undefined;
  const spans = spansOf(text, found, key.spaced);
  const space = next.spaced ? ' ' : '';
  return {
    changes: [
      { ...spans.open, insert: next.open + space },
      { ...spans.close, insert: space + next.close },
    ],
    cursor: found.open,
  };
}

/**
 * `ys{motion}{key}` and visual `S{key}`: each range wrapped in the pair. A linewise range
 * ends on the line break after its last line, which stays outside the pair.
 */
export function addSurround(
  text: string,
  ranges: readonly { readonly from: number; readonly to: number }[],
  key: string,
): SurroundEdit | undefined {
  const pair = KEYS[key];
  if (pair === undefined || ranges.length === 0) return undefined;
  const space = pair.spaced ? ' ' : '';
  const changes = ranges.flatMap(({ from, to }) => {
    const end = to > from && text[to - 1] === '\n' ? to - 1 : to;
    return [
      { from, to: from, insert: pair.open + space },
      { from: end, to: end, insert: space + pair.close },
    ];
  });
  return { changes, cursor: Math.min(...ranges.map(({ from }) => from)) };
}

const applyEdit = (view: EditorView, edit: SurroundEdit | undefined): void => {
  if (edit === undefined) return;
  const changes = view.state.changes(edit.changes as ChangeSpec[]);
  view.dispatch({
    changes,
    selection: EditorSelection.cursor(changes.mapPos(edit.cursor, -1)),
    userEvent: 'input.vim-surround',
  });
};

/** The engine's names for its own operators. */
const DELETE = 'delete';
const CHANGE = 'change';
const YANK = 'yank';

/** The engine-side names surround's motion and operator are found by. */
const ADD = 'surround.add';

/** The keys `ds`/`cs` read, kept on the motion's args for `.`. */
const TARGET = 'surroundTarget';
const REPLACEMENT = 'surroundReplacement';
/** The key `ys`/`S` read, kept on the operator's args for `.`. */
const KEY = 'surroundKey';

/**
 * `s` after an operator. Returns `null` always but for `yss`: the engine then runs no
 * operator, and the edit is surround's own.
 */
const target: VimOperation = {
  kind: 'engine',
  type: 'motion',
  define: (engineName, nameOf) => {
    // `inputState` is the state the motion was typed in, the operator before it included:
    // the engine has already cleared `vim.inputState` for the next command.
    const motion: MotionFn = (adapter, head, engineArgs, vim, inputState) => {
      const view = viewOf(adapter);
      // Surround's own keys ride beside the engine's on the same object, which `.` replays.
      const motionArgs = engineArgs as unknown as Record<string, unknown>;
      const operator = inputState.operator;
      if (view === undefined) return null;
      if (operator === nameOf(ADD)) {
        // `yss`: the line from its first character that is not blank, as tpope's does.
        const line = view.state.doc.line(head.line + 1);
        const first = line.text.search(/\S|$/u);
        return [
          { line: head.line, ch: first },
          { line: head.line, ch: line.length },
        ];
      }
      if (operator === YANK) {
        vim.inputState.operator = nameOf(ADD);
        vim.inputState.operatorArgs = {};
        return null;
      }
      if (operator !== DELETE && operator !== CHANGE) return null;
      const offset = offsetOf(view, head);
      const run = (): void => {
        const text = view.state.doc.toString();
        const keyTarget = motionArgs[TARGET] as string;
        applyEdit(
          view,
          operator === DELETE
            ? deleteSurround(text, offset, keyTarget)
            : changeSurround(text, offset, keyTarget, motionArgs[REPLACEMENT] as string),
        );
      };
      if (typeof motionArgs[TARGET] === 'string') run();
      else {
        readVimKeys(view, operator === DELETE ? 1 : 2, (keys) => {
          motionArgs[TARGET] = keys[0];
          if (operator === CHANGE) motionArgs[REPLACEMENT] = keys[1];
          run();
        });
      }
      return null;
    };
    Vim.defineMotion(engineName, motion);
  },
};

/** `ys{motion}` and visual `S`: the ranges, waiting for the pair or wrapped in it on `.`. */
const add: VimOperation = {
  kind: 'engine',
  type: 'operator',
  isEdit: true,
  define: (engineName) => {
    const operator: OperatorFn = (adapter, engineArgs, ranges) => {
      const view = viewOf(adapter);
      const operatorArgs = engineArgs as unknown as Record<string, unknown>;
      if (view === undefined || ranges.length === 0) return undefined;
      const covered = ranges.map((range) => {
        const anchor = offsetOf(view, range.anchor);
        const head = offsetOf(view, range.head);
        return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
      });
      const wrap = (key: string): void => {
        applyEdit(view, addSurround(view.state.doc.toString(), covered, key));
      };
      if (typeof operatorArgs[KEY] === 'string') wrap(operatorArgs[KEY]);
      else {
        readVimKeys(view, 1, (keys) => {
          operatorArgs[KEY] = keys[0];
          wrap(keys[0] as string);
        });
      }
      // The engine selected the ranges for the operator; the cursor goes to the first.
      return positionOf(view, Math.min(...covered.map(({ from }) => from)));
    };
    Vim.defineOperator(engineName, operator);
  },
};

export const VIM_SURROUND_OPERATIONS: ReadonlyMap<string, VimOperation> = new Map([
  ['surround.target', target],
  [ADD, add],
]);
