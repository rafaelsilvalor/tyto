import { group, rect, solid } from '@tyto/core/template';

import { type Block, at, block, stack } from './blocks.js';
import { type RowGroup, rowGroups } from './rows.js';
import { type Measure, type TextStyle, grownTextBlock, naturalWidth, textBlock } from './text.js';

import type { RichText } from '@tyto/core';
import type { NodeDraft, TextOptions } from '@tyto/core/template';

/**
 * A table whose rows are read from one slot and whose cells can be pills.
 *
 * The first configurable component (TYTO-185, ADR 0047). One structure — one line of the
 * brief is one row, `|` separates its cells, an optional line with no `|` heads a group —
 * drawn by a {@link PillTableStyle} that says everything about the look: the Saúde agenda's
 * sessions (`date | title | professor`, a blue pill laid over a grey one), the Saúde approved
 * list (`rank | name`), or a plain table with no shapes at all.
 *
 * **The style holds no brand.** Colours, faces and sizes arrive in it; a preset beside the
 * templates of one brand is where they are chosen (`packages/templates/templates/_<brand>/`).
 */

/** A pill behind a cell. Absent on a column means the cell draws its words alone. */
export interface CellShape {
  readonly fill: string;
  readonly radius: number;
}

/**
 * A column that holds one field in a box as tall as the row, like a date or a rank badge.
 *
 * The words are laid out in the whole cell, so `valign: 'middle'` centres them on the row
 * whatever its height — which is how a badge stays centred beside a cell that grew.
 */
export interface LabelColumn {
  readonly kind: 'label';
  /** The cell's group. */
  readonly name: string;
  readonly width: number;
  readonly shape?: CellShape;
  readonly text: {
    /** The text node's name. */
    readonly name: string;
    readonly style: TextStyle;
    readonly align?: TextOptions['align'];
    readonly valign?: TextOptions['valign'];
    /** What the brief wrote, turned into what is drawn — `1º` into `1º Lugar`, say. */
    readonly rewrite?: Rewrite;
  };
}

/**
 * A column that holds one or more fields stacked, each as tall as its words.
 *
 * The agenda's grey pill is one: the session title over the professor. Each line grows with
 * measured text and never drops below its `minHeight`, and the cell grows with its lines.
 */
export interface LinesColumn {
  readonly kind: 'lines';
  readonly name: string;
  /** `fill` takes whatever the fixed columns leave. At most one column should fill. */
  readonly width: number | 'fill';
  readonly shape?: CellShape;
  readonly lines: readonly {
    readonly name: string;
    readonly style: TextStyle;
    readonly minHeight: number;
    readonly rewrite?: Rewrite;
  }[];
  readonly lineGap: number;
  /**
   * Room between the cell's edge and its lines. The lines are centred in what `top` and
   * `bottom` leave, so an unequal pair nudges them optically — capitals sit high in their
   * line box, and a list of names in capitals reads centred only with more room above.
   */
  readonly padding: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
}

export type PillTableColumn = LabelColumn | LinesColumn;

/**
 * A field as the brief wrote it, turned into what a cell draws. Runs on non-empty fields
 * only, so a rewrite that adds words never makes an empty field draw something.
 */
export type Rewrite = (value: RichText) => RichText;

function rewritten(value: RichText, rewrite: Rewrite | undefined): RichText {
  return rewrite === undefined || value.length === 0 ? value : rewrite(value);
}

export interface PillTableStyle {
  readonly columns: readonly PillTableColumn[];
  /**
   * `side-by-side`: each cell sits in its own slot, `columnGap` apart.
   *
   * `overlap`: each cell's shape runs from the row's left edge to its own right edge, and
   * earlier cells are painted over later ones. With two columns that is the agenda's row — a
   * grey pill the width of the row with a blue pill laid over its left end, reading as one
   * shape with no gap and no second rounded edge between them. The cells' words still start
   * where the cell starts.
   */
  readonly layering: 'side-by-side' | 'overlap';
  /** Space between cells; used by `side-by-side` only. */
  readonly columnGap?: number;
  readonly rowGap: number;
  /** A row is never shorter than this, however short its words. */
  readonly minRowHeight: number;
  /**
   * Rows as wide as their words rather than as the table.
   *
   * Every row of a group takes the width of that group's widest row — the widest name, plus
   * the fixed columns and the padding — so one long name widens its whole list, and each list
   * is centred on its own (the Saúde approved list, 2026-09-27). Past `max` a row stops
   * growing and its words wrap. Where nothing can measure, every row is `max` wide.
   *
   * Absent, every row is the table's width.
   */
  readonly fit?: { readonly max: number };
  /**
   * With `groups`, a line with no `|` heads the rows under it; without, every line is a row.
   */
  readonly groups?: {
    readonly heading: {
      readonly name: string;
      readonly height: number;
      readonly style: TextStyle;
      readonly align?: TextOptions['align'];
      readonly overflow?: TextOptions['overflow'];
    };
    /** Between a heading and its first row — or its caption, when there is one. */
    readonly headingGap: number;
    /** Between one group's last row and the next group's heading. */
    readonly gap: number;
    /**
     * A band between a heading and its rows, as wide as the rows, holding the heading line's
     * second field: `Domingo 26/10 | Aplicação às 08h30 & correção às 14h` draws the day as
     * the heading and the schedule on the band (the weekly mock-exam agenda, TYTO-200).
     *
     * **With a caption, a heading is the line with one separator**, and a row the line with
     * none — which is how a table of one-field rows tells the two apart. Rows of more than
     * one field and a caption cannot share a table.
     */
    readonly caption?: CaptionStyle;
  };
  /** The groups the table draws, so a scene reads back in the preset's words. */
  readonly names: {
    readonly table: string;
    /** A heading and its rows; used with `groups` only. */
    readonly group?: string;
    /** A group's rows under its heading; used with `groups` only. */
    readonly rows?: string;
    readonly row: string;
  };
}

/** The band under a group heading: {@link PillTableStyle}'s `groups.caption`. */
export interface CaptionStyle {
  readonly name: string;
  readonly height: number;
  /** Corners as `[top-left, top-right, bottom-right, bottom-left]`, or one for all four. */
  readonly shape: {
    readonly fill: string;
    readonly radius: number | readonly [number, number, number, number];
  };
  readonly text: {
    readonly name: string;
    readonly style: TextStyle;
    readonly align?: TextOptions['align'];
  };
  /** Room between the band's ends and its words. */
  readonly padding: { readonly left: number; readonly right: number };
  /** Between the band and the first row under it. */
  readonly gap: number;
}

export interface PillTableContent {
  /** The slot's value: one line per row. */
  readonly text: RichText;
  readonly width: number;
  readonly measure: Measure;
}

/** A column resolved against the table's width: where it starts and how wide it is. */
interface Placed {
  readonly column: PillTableColumn;
  readonly x: number;
  readonly width: number;
}

/**
 * The table, drawn. As wide as `width`, as tall as its rows and headings.
 *
 * Under `fit` a group's rows can be narrower than `width`; they are centred in it.
 */
export function pillTable(style: PillTableStyle, content: PillTableContent): Block {
  const fieldCount = style.columns.reduce((sum, column) => sum + fieldsOf(column), 0);
  const caption = style.groups?.caption;
  const groups = rowGroups(
    content.text,
    fieldCount,
    style.groups !== undefined,
    caption === undefined ? 1 : 2,
  );

  const drawRows = (
    rows: RowGroup['rows'],
    name: string | undefined,
    gap: number,
    band?: RichText,
  ) => {
    const width = rowWidth(style, rows, content);
    const placed = placeColumns(style, width);
    const drawn = stack({
      ...(name === undefined ? {} : { name }),
      gap,
      items: rows.map((fields) => drawRow(style, placed, fields, width, content.measure)),
    });
    if (caption === undefined || band === undefined) return centred(drawn, content.width);
    return centred(
      stack({ gap: caption.gap, items: [captionBand(caption, band, width), drawn] }),
      content.width,
    );
  };

  const grouping = style.groups;
  if (grouping === undefined) {
    return drawRows(
      groups.flatMap((each) => each.rows),
      style.names.table,
      style.rowGap,
    );
  }

  return stack({
    name: style.names.table,
    gap: grouping.gap,
    items: groups.map((each) => {
      const heading = textBlock(
        each.heading,
        { w: content.width, h: grouping.heading.height },
        grouping.heading.style,
        {
          name: grouping.heading.name,
          ...(grouping.heading.align === undefined ? {} : { align: grouping.heading.align }),
          ...(grouping.heading.overflow === undefined
            ? {}
            : { overflow: grouping.heading.overflow }),
        },
      );
      return stack({
        ...(style.names.group === undefined ? {} : { name: style.names.group }),
        gap: grouping.headingGap,
        items: [
          heading,
          drawRows(
            each.rows,
            style.names.rows,
            style.rowGap,
            // Rows written before any heading have no heading line, so no band either.
            each.headingRest.length === 0 ? undefined : each.headingRest[0],
          ),
        ],
      });
    }),
  });
}

/** The caption band: its shape the rows' width, its words centred on its height. */
function captionBand(caption: CaptionStyle, value: RichText, width: number): Block {
  const words = textBlock(
    value,
    { w: width - caption.padding.left - caption.padding.right, h: caption.height },
    caption.text.style,
    {
      name: caption.text.name,
      valign: 'middle',
      ...(caption.text.align === undefined ? {} : { align: caption.text.align }),
    },
  );
  return block(
    width,
    caption.height,
    group({
      name: caption.name,
      children: [
        rect({
          size: { w: width, h: caption.height },
          radius: caption.shape.radius,
          fill: solid(caption.shape.fill),
        }),
        shift(words.draft, caption.padding.left, 0),
      ],
    }),
  );
}

/** A block narrower than `width`, centred in it; one exactly `width` wide is itself. */
function centred(item: Block, width: number): Block {
  if (item.width >= width) return item;
  return block(width, item.height, group({ children: [at((width - item.width) / 2, 0, item)] }));
}

/** The width a group's rows are drawn at: the table's, or under `fit` their widest row's. */
function rowWidth(
  style: PillTableStyle,
  rows: RowGroup['rows'],
  content: PillTableContent,
): number {
  if (style.fit === undefined) return content.width;
  const cap = Math.min(style.fit.max, content.width);

  let widest = 0;
  for (const fields of rows) {
    const natural = naturalRowWidth(style, fields, content.measure);
    if (natural === undefined) return cap;
    widest = Math.max(widest, natural);
  }
  return Math.min(cap, widest);
}

/** How wide one row is with every line on one line, or nothing when nothing can measure. */
function naturalRowWidth(
  style: PillTableStyle,
  fields: readonly RichText[],
  measure: Measure,
): number | undefined {
  const gap = style.layering === 'side-by-side' ? (style.columnGap ?? 0) : 0;
  let total = gap * Math.max(0, style.columns.length - 1);
  let next = 0;

  for (const column of style.columns) {
    const count = fieldsOf(column);
    const own = fields.slice(next, next + count);
    next += count;

    if (column.width !== 'fill') {
      total += column.width;
      continue;
    }
    if (column.kind === 'label') return undefined;

    let widest = 0;
    for (const [index, line] of column.lines.entries()) {
      const width = naturalWidth(rewritten(own[index] ?? [], line.rewrite), line.style, measure);
      if (width === undefined) return undefined;
      widest = Math.max(widest, width);
    }
    total += column.padding.left + widest + column.padding.right;
  }
  return total;
}

function fieldsOf(column: PillTableColumn): number {
  return column.kind === 'label' ? 1 : column.lines.length;
}

function placeColumns(style: PillTableStyle, width: number): Placed[] {
  const gap = style.layering === 'side-by-side' ? (style.columnGap ?? 0) : 0;
  const fixed = style.columns.reduce(
    (sum, column) => sum + (column.width === 'fill' ? 0 : column.width),
    0,
  );
  const fill = width - fixed - gap * Math.max(0, style.columns.length - 1);

  let x = 0;
  return style.columns.map((column) => {
    const columnWidth = column.width === 'fill' ? fill : column.width;
    const result = { column, x, width: columnWidth };
    x += columnWidth + gap;
    return result;
  });
}

/** One row: every cell as tall as the tallest one needs, and never below the minimum. */
function drawRow(
  style: PillTableStyle,
  placed: readonly Placed[],
  fields: readonly RichText[],
  width: number,
  measure: Measure,
): Block {
  // Each column takes its fields in order; a field the brief did not write is empty.
  let next = 0;
  const cells = placed.map((each) => {
    const count = fieldsOf(each.column);
    const own = Array.from({ length: count }, (_, index) => fields[next + index] ?? []);
    next += count;
    return { ...each, fields: own };
  });

  const stacks = cells.map((cell) =>
    cell.column.kind === 'lines'
      ? linesOf(cell.column, cell.width, cell.fields, measure)
      : undefined,
  );

  const height = cells.reduce((tallest, cell, index) => {
    const lines = stacks[index];
    if (lines === undefined || cell.column.kind !== 'lines') return tallest;
    return Math.max(tallest, lines.height + cell.column.padding.top + cell.column.padding.bottom);
  }, style.minRowHeight);

  const drawn = cells.map((cell, index) =>
    drawCell(style, cell, cell.fields, stacks[index], height),
  );

  return block(
    width,
    height,
    group({
      name: style.names.row,
      // Painted in order, so under `overlap` the earlier cells go last and cover the
      // rounded left ends of the later ones.
      children: style.layering === 'overlap' ? drawn.reverse() : drawn,
    }),
  );
}

/** A lines column's words, stacked, before the row's height is known. */
function linesOf(
  column: LinesColumn,
  width: number,
  fields: readonly RichText[],
  measure: Measure,
): Block {
  const inner = width - column.padding.left - column.padding.right;
  return stack({
    gap: column.lineGap,
    items: column.lines.map((line, index) =>
      grownTextBlock(
        rewritten(fields[index] ?? [], line.rewrite),
        inner,
        line.minHeight,
        line.style,
        measure,
        {
          name: line.name,
        },
      ),
    ),
  });
}

function drawCell(
  style: PillTableStyle,
  cell: Placed,
  fields: readonly RichText[],
  lines: Block | undefined,
  height: number,
): NodeDraft {
  const overlap = style.layering === 'overlap';
  // Under `overlap` the cell's group sits at the row's left edge and its shape reaches from
  // there to the cell's right edge; the words are offset to where the cell starts.
  const origin = overlap ? 0 : cell.x;
  const start = overlap ? cell.x : 0;
  const shapeWidth = overlap ? cell.x + cell.width : cell.width;

  const children: NodeDraft[] = [];
  if (cell.column.shape !== undefined) {
    children.push(
      rect({
        size: { w: shapeWidth, h: height },
        radius: cell.column.shape.radius,
        fill: solid(cell.column.shape.fill),
      }),
    );
  }

  if (cell.column.kind === 'label') {
    const words = textBlock(
      rewritten(fields[0] ?? [], cell.column.text.rewrite),
      { w: cell.width, h: height },
      cell.column.text.style,
      {
        name: cell.column.text.name,
        ...(cell.column.text.align === undefined ? {} : { align: cell.column.text.align }),
        ...(cell.column.text.valign === undefined ? {} : { valign: cell.column.text.valign }),
      },
    );
    children.push(shift(words.draft, start, 0));
  } else if (lines !== undefined) {
    children.push(
      shift(
        lines.draft,
        start + cell.column.padding.left,
        cell.column.padding.top +
          (height - cell.column.padding.top - cell.column.padding.bottom - lines.height) / 2,
      ),
    );
  }

  return shift(group({ name: cell.column.name, children }), origin, 0);
}

/** A draft moved by an offset, added to the coordinate it already carries. */
function shift(draft: NodeDraft, dx: number, dy: number): NodeDraft {
  if (dx === 0 && dy === 0) return draft;
  return at(dx, dy, block(0, 0, draft));
}
