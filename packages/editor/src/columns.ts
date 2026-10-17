import { language } from '@codemirror/language';
import { type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { type SyntaxNode } from '@lezer/common';

import { treeAt } from './syntax.js';
import { palette, panels } from './theme.js';

/**
 * The columns of a `|` line, told apart in the editor (TYTO-298, ADR 0097).
 *
 * **`|` is not in the grammar.** It is a character of `Text`, and only a template gives it a
 * meaning: `fields()` in `@tyto/template-kit` (`rows.ts`) cuts a line of a block body at every
 * `|` that sits in top-level plain text. This module reads the same tree the same way, so what
 * the editor marks as a column is what a table template will read as one:
 *
 * - a `|` inside `**bold**`, `*italic*` or a `{cor:x}…{/}` mark does not split — those are
 *   atomic to `fields()` and join whichever column is open. **They keep their own colour, too:**
 *   a column's colour is painted on its plain text only, so emphasis looks the same in every
 *   column and in every style;
 * - columns restart on every line of a block, and at a `\` hard break, which is the same
 *   `Break` the line between two body lines is;
 * - there is no `\|` escape, because the language has none;
 * - an inline body — text on the directive's own line — is a line like any other.
 *
 * A line with no top-level `|` gets nothing: to a grouped table it is a heading.
 *
 * Four looks, the desktop's `briefColumns` setting (Rafael chose all four, from a sheet of the
 * same brief in four themes): `off`; `separator`, the default — the `|` in the function colour,
 * the one look that passes its floor (3:1) in all thirteen adjusted and built-in themes;
 * `alternate`, every even column in the muted text colour too, which is legible everywhere but
 * barely differs from the text in eight of them; and `perColumn`, the columns cycling through
 * keyword, constant and warning, under 4.5:1 in seven. **No colour here is a token of its own:**
 * each is a role the theme already sets.
 */

/** The looks, in the order the setting lists them. */
export const BRIEF_COLUMN_STYLES = ['off', 'separator', 'alternate', 'perColumn'] as const;

export type BriefColumnStyle = (typeof BRIEF_COLUMN_STYLES)[number];

/** The look an editor starts with. */
export const DEFAULT_BRIEF_COLUMNS: BriefColumnStyle = 'separator';

/** A stretch of one column's plain text, and which column it is (1-based). */
export interface Column {
  readonly from: number;
  readonly to: number;
  readonly index: number;
}

/** What one stretch of the document holds: the separators and the columns' plain text. */
export interface ColumnMarks {
  readonly separators: readonly number[];
  readonly columns: readonly Column[];
}

/** The nodes that hold a line's inlines: an inline body, and the text of a body line. */
const LINE_HOLDERS = new Set(['InlineBody', 'BlockText']);

/** The inlines a separator may sit in, as `fields()` cuts only `text`. */
const PLAIN = 'Text';

/**
 * The inlines a column's colour is painted on. A `Space` is the space between an emphasis and
 * the next word, plain text to `parseBrief`; everything else — bold, italic, a mark — is atomic.
 */
const PAINTED = new Set([PLAIN, 'Space', 'EscapedDirective']);

/** A break ends a row, top-level only: one inside bold is inside an atomic inline. */
const BREAK = 'Break';

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

/** The rows of one line holder: its top-level inlines, cut at each top-level `Break`. */
function rowsOf(holder: SyntaxNode): SyntaxNode[][] {
  const rows: SyntaxNode[][] = [[]];
  for (const child of childrenOf(holder)) {
    if (child.name === BREAK) rows.push([]);
    else rows[rows.length - 1]!.push(child);
  }
  return rows.filter((row) => row.length > 0);
}

/** One row's separators and columns, or nothing when it has no top-level `|`. */
function marksOfRow(state: EditorState, row: readonly SyntaxNode[]): ColumnMarks {
  const separators: number[] = [];
  for (const inline of row) {
    if (inline.name !== PLAIN) continue;
    const text = state.sliceDoc(inline.from, inline.to);
    for (let at = text.indexOf('|'); at >= 0; at = text.indexOf('|', at + 1)) {
      separators.push(inline.from + at);
    }
  }
  if (separators.length === 0) return { separators, columns: [] };

  // Each painted inline, cut at the separators inside it; a stretch of spaces alone is left
  // out, since it paints nothing.
  const columns: Column[] = [];
  for (const inline of row) {
    if (!PAINTED.has(inline.name)) continue;
    const cuts = [
      inline.from - 1,
      ...separators.filter((at) => at >= inline.from && at < inline.to),
      inline.to,
    ];
    for (let piece = 1; piece < cuts.length; piece += 1) {
      const from = cuts[piece - 1]! + 1;
      const to = cuts[piece]!;
      if (state.sliceDoc(from, to).trim() === '') continue;
      const index = 1 + separators.filter((at) => at < from).length;
      columns.push({ from, to, index });
    }
  }
  return { separators, columns };
}

/** Every separator and column in `from`–`to`, in document order. */
export function columnMarks(state: EditorState, from: number, to: number): ColumnMarks {
  const separators: number[] = [];
  const columns: Column[] = [];
  treeAt(state, to).iterate({
    from,
    to,
    enter: (node) => {
      if (!LINE_HOLDERS.has(node.name)) return undefined;
      for (const row of rowsOf(node.node)) {
        const marks = marksOfRow(state, row);
        separators.push(...marks.separators);
        columns.push(...marks.columns);
      }
      // A holder's inlines were read above; nothing below it holds a line.
      return false;
    },
  });
  return { separators, columns };
}

const separatorMark = Decoration.mark({ class: 'cm-brief-column-separator' });
const evenMark = Decoration.mark({ class: 'cm-brief-column-even' });
const cycleMarks = [1, 2, 3].map((cycle) =>
  Decoration.mark({ class: `cm-brief-column-cycle-${String(cycle)}` }),
);

/** The mark a column gets in `style`, or none: `separator` paints the `|` alone. */
function columnMark(style: BriefColumnStyle, index: number): Decoration | undefined {
  if (style === 'alternate') return index % 2 === 0 ? evenMark : undefined;
  if (style === 'perColumn') return cycleMarks[(index - 1) % cycleMarks.length];
  return undefined;
}

function decorations(view: EditorView, style: BriefColumnStyle): DecorationSet {
  // A JSON tab and the template mode's buffers hold no brief: nothing to read.
  if (view.state.facet(language)?.name !== 'brief') return Decoration.none;
  const ranges: { from: number; to: number; mark: Decoration }[] = [];
  for (const visible of view.visibleRanges) {
    const marks = columnMarks(view.state, visible.from, visible.to);
    for (const at of marks.separators) ranges.push({ from: at, to: at + 1, mark: separatorMark });
    for (const column of marks.columns) {
      const mark = columnMark(style, column.index);
      if (mark !== undefined) ranges.push({ from: column.from, to: column.to, mark });
    }
  }
  ranges.sort((one, two) => one.from - two.from || one.to - two.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, range.mark);
  return builder.finish();
}

const columnPlugin = (style: BriefColumnStyle): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorations(view, style);
      }
      update(update: ViewUpdate): void {
        // Any transaction, not only an edit: a background parse that reaches further lands as
        // one with no changes, and the columns past the old tree's end appear with it.
        if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
          this.decorations = decorations(update.view, style);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

/**
 * One sheet for every look, because CodeMirror never unmounts a theme's rules: a look swapped
 * out by the setting would leave its colours behind. The look decides which classes it marks
 * the text with instead.
 */
const columnTheme = EditorView.baseTheme({
  '.cm-brief-column-separator': { color: palette.functionName },
  '.cm-brief-column-even': { color: panels.muted },
  '.cm-brief-column-cycle-1': { color: palette.keyword },
  '.cm-brief-column-cycle-2': { color: palette.literal },
  '.cm-brief-column-cycle-3': { color: panels.warning },
});

/** Made once per look, so a compartment can tell whether a tab already holds the one in force. */
const extensions = new Map<BriefColumnStyle, Extension>(
  BRIEF_COLUMN_STYLES.map((style) => [
    style,
    style === 'off' ? [] : [columnPlugin(style), columnTheme],
  ]),
);

/** The columns of a `|` line in `style`, for a compartment the `briefColumns` setting swaps. */
export function briefColumns(style: BriefColumnStyle = DEFAULT_BRIEF_COLUMNS): Extension {
  return extensions.get(style)!;
}
