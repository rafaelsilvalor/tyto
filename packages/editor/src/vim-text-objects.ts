import { type Text, countColumn } from '@codemirror/state';

import type { VimOperation, VimTextObjectRange } from './vim-contributions.js';

/**
 * The text objects the editor offers a vim contribution (TYTO-422, ADR 0142).
 *
 * Each is a `textObject` operation: it answers the range around the cursor and leaves the
 * engine bookkeeping to `defineVimOperation`. The computation is on the document alone, so it
 * is tested without a view or the engine.
 */

/** A line's indent in columns, or nothing for a blank line: a blank line has no level. */
const indentOf = (text: string, tabSize: number): number | undefined => {
  const first = text.search(/\S/);
  return first < 0 ? undefined : countColumn(text, tabSize, first);
};

/** Lines are 1-based, as `Text.line` numbers them. */
interface LineSpan {
  readonly first: number;
  readonly last: number;
}

/**
 * The run of lines around `seed` whose indent is at least `level`, blank lines inside it
 * included and blank lines at either edge left out. `seed` itself is never blank.
 */
function blockAround(doc: Text, tabSize: number, seed: number, level: number): LineSpan {
  const belongs = (line: number): boolean => {
    const indent = indentOf(doc.line(line).text, tabSize);
    return indent === undefined || indent >= level;
  };
  let first = seed;
  let last = seed;
  while (first > 1 && belongs(first - 1)) first--;
  while (last < doc.lines && belongs(last + 1)) last++;
  while (first < seed && indentOf(doc.line(first).text, tabSize) === undefined) first++;
  while (last > seed && indentOf(doc.line(last).text, tabSize) === undefined) last--;
  return { first, last };
}

/** The nearest non-blank line above `line`, with its indent, or nothing at the top. */
function headerAbove(doc: Text, tabSize: number, line: number): number | undefined {
  for (let probe = line - 1; probe >= 1; probe--) {
    if (indentOf(doc.line(probe).text, tabSize) !== undefined) return probe;
  }
  return undefined;
}

/** The non-blank line the object starts from: the cursor's, or the next one down, or up. */
function seedLine(doc: Text, tabSize: number, line: number): number | undefined {
  for (let probe = line; probe <= doc.lines; probe++) {
    if (indentOf(doc.line(probe).text, tabSize) !== undefined) return probe;
  }
  return headerAbove(doc, tabSize, line);
}

/**
 * vim-indent-object's `ii` and `ai`, as lines.
 *
 * `ii` is the block of lines at the cursor's indent or deeper; `ai` adds the line above it
 * that opens the block (the nearest non-blank line with a smaller indent), when there is one.
 * Each count past the first climbs one level: the block around that opening line. **Blank
 * lines inside the block are included and blank lines at its edges are not** (ADR 0142), so
 * `dii` on a block followed by a blank line keeps the blank line as the separator; `ai` keeps the blank lines between the
 * opening line and the block, since they sit inside the span. A cursor on a blank line starts
 * from the next non-blank line down, or up at the end of the document.
 */
export function indentBlock(
  doc: Text,
  tabSize: number,
  cursorLine: number,
  count: number,
  inner: boolean,
): LineSpan | undefined {
  const seed = seedLine(doc, tabSize, cursorLine);
  if (seed === undefined) return undefined;
  let level = indentOf(doc.line(seed).text, tabSize) ?? 0;
  let block = blockAround(doc, tabSize, seed, level);
  for (let round = 1; round < count; round++) {
    const header = headerAbove(doc, tabSize, block.first);
    if (header === undefined) break;
    level = indentOf(doc.line(header).text, tabSize) ?? 0;
    block = blockAround(doc, tabSize, header, level);
  }
  if (inner) return block;
  const header = headerAbove(doc, tabSize, block.first);
  return header === undefined ? block : { first: header, last: block.last };
}

/**
 * textobj-entire's `ae` and `ie`: every line, or every line between the first and the last
 * that is not blank. A document with no text has no `ie`.
 */
export function entireSpan(doc: Text, inner: boolean): LineSpan | undefined {
  if (!inner) return { first: 1, last: doc.lines };
  let first = 1;
  let last = doc.lines;
  const blank = (line: number): boolean => doc.line(line).text.trim().length === 0;
  while (first <= last && blank(first)) first++;
  while (last >= first && blank(last)) last--;
  return first > last ? undefined : { first, last };
}

const linewise = (doc: Text, span: LineSpan | undefined): VimTextObjectRange | undefined =>
  span === undefined
    ? undefined
    : { from: doc.line(span.first).from, to: doc.line(span.last).to, linewise: true };

/** `inner` is the contribution's own arg: `{ inner: true }` on `ii`, absent on `ai`. */
export const indentObject: VimOperation = {
  kind: 'textObject',
  select: (view, head, args, count) => {
    const { doc, tabSize } = view.state;
    return linewise(
      doc,
      indentBlock(doc, tabSize, doc.lineAt(head).number, count, args['inner'] === true),
    );
  },
};

/** The count changes nothing: there is one buffer. */
export const entireBuffer: VimOperation = {
  kind: 'textObject',
  select: (view, _head, args) =>
    linewise(view.state.doc, entireSpan(view.state.doc, args['inner'] === true)),
};

/** What `setVimContributions` registers before it reads a contribution. */
export const BUILT_IN_VIM_OPERATIONS: ReadonlyMap<string, VimOperation> = new Map([
  ['indentObject', indentObject],
  ['entireBuffer', entireBuffer],
]);
