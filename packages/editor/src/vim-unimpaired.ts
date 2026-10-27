import { EditorSelection, type Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { VimOperation } from './vim-contributions.js';

/**
 * The part of vim-unimpaired that edits text (TYTO-419, ADR 0143 amendment): `[<Space>` and
 * `]<Space>` add blank lines above or below, `[e` and `]e` move the line up or down. Both
 * take a count, and the contribution's `up` arg says which bracket it is.
 *
 * The rest of unimpaired is not here: `[b`, `[f`, `[q` and `[o` drive windows, buffers and
 * options, which a vim contribution cannot name; `[x` encodes markup, and a template's editor
 * has no vim; `[p` and `]p` are the engine's own.
 */

/** A text change, and where the cursor goes, in the document after it. */
export interface UnimpairedEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly cursor: number;
}

/** `count` blank lines above or below the cursor's line; the cursor stays on its text. */
export function blankLines(doc: Text, head: number, up: boolean, count: number): UnimpairedEdit {
  const line = doc.lineAt(head);
  const at = up ? line.from : line.to;
  return { from: at, to: at, insert: '\n'.repeat(count), cursor: up ? head + count : head };
}

/**
 * The cursor's line moved `count` lines up or down, past the lines between, as one change so
 * one `u` undoes it. Stops at the first or last line; nothing to do there is `undefined`.
 */
export function moveLine(
  doc: Text,
  head: number,
  up: boolean,
  count: number,
): UnimpairedEdit | undefined {
  const line = doc.lineAt(head);
  const target = up ? Math.max(1, line.number - count) : Math.min(doc.lines, line.number + count);
  if (target === line.number) return undefined;
  const column = head - line.from;
  const textBetween = (first: number, last: number): string =>
    doc.sliceString(doc.line(first).from, doc.line(last).to);
  if (up) {
    const from = doc.line(target).from;
    const insert = `${line.text}\n${textBetween(target, line.number - 1)}`;
    return { from, to: line.to, insert, cursor: from + column };
  }
  const between = textBetween(line.number + 1, target);
  const to = doc.line(target).to;
  return {
    from: line.from,
    to,
    insert: `${between}\n${line.text}`,
    cursor: line.from + between.length + 1 + column,
  };
}

const run = (view: EditorView, edit: UnimpairedEdit | undefined): void => {
  if (edit === undefined) return;
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.cursor(edit.cursor),
    userEvent: 'input.vim-unimpaired',
  });
};

const head = (view: EditorView): number => view.state.selection.main.head;

const blank: VimOperation = {
  kind: 'action',
  isEdit: true,
  run: (view, args, repeat) => {
    run(view, blankLines(view.state.doc, head(view), args['up'] === true, Math.max(1, repeat)));
  },
};

const move: VimOperation = {
  kind: 'action',
  isEdit: true,
  run: (view, args, repeat) => {
    run(view, moveLine(view.state.doc, head(view), args['up'] === true, Math.max(1, repeat)));
  },
};

export const VIM_UNIMPAIRED_OPERATIONS: ReadonlyMap<string, VimOperation> = new Map([
  ['unimpaired.blank', blank],
  ['unimpaired.move', move],
]);
