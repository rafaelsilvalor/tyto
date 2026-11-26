/*
 * `table.ts` as it was before TYTO-891, copied whole from origin/main (4a253f22) by a script that
 * only renames its exported functions (`table` → `oldTable`) and points it at the other copy, so the tests
 * can hold the new forms to it byte for byte.
 */
import { group, rect, solid } from '@tyto/core/template';

import { type Block, at, block, stack } from './blocks.js';

import type { NodeDraft } from '@tyto/core/template';

/**
 * A table: rows of cells laid out in columns, with each cell's or row's fill and corners
 * (TYTO-859).
 *
 * **The table lays out cells and draws no words.** A cell's content is a block built by the
 * components that draw words or pictures (`textBlock`, `grownTextBlock`, `levelStack`, an
 * image…), handed in as a function of the cell's width so the table can measure how tall the
 * row must be. What a row says, and how a slot becomes rows, is the caller's: `rows.ts` reads
 * `|`-separated lines, and {@link slotTable} is that reading with words drawn by column.
 *
 * What the table owns:
 * - **columns**: a fixed width, whatever the others leave (`fill`), or as wide as their widest
 *   content (`measured`, never below a minimum);
 * - **row kinds**, named by the caller (`plain`, `highlight`, …): each kind's fill per column,
 *   and zebra, fills that alternate along the rows of that kind;
 * - **bands**: a row of one cell across every column;
 * - **corners**: a radius on every cell, or on the table's four outer corners only;
 * - the gaps between columns and rows, each column's padding, and where a cell's content sits
 *   when the row is taller than it.
 *
 * **The style holds no brand.** Colours and sizes arrive in it (ADR 0047).
 */

/** Corners as `[top-left, top-right, bottom-right, bottom-left]`, or one for all four. */
export type Corners = number | readonly [number, number, number, number];

/** Room between a cell's edge and its content. */
export interface CellPadding {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

const NO_PADDING: CellPadding = { top: 0, bottom: 0, left: 0, right: 0 };

export interface TableColumn {
  /** The cell's group in the scene. */
  readonly name: string;
  /**
   * `fill` takes whatever the fixed and measured columns leave; at most one column should
   * fill. `measured` is as wide as the column's widest content plus its padding, and never
   * narrower than `min`.
   */
  readonly width: number | 'fill' | { readonly measured: { readonly min: number } };
  readonly padding?: CellPadding;
  /** Where the content sits when the row is taller than it. Default `middle`. */
  readonly valign?: 'top' | 'middle' | 'bottom';
  /** This column's cells' corners, over the table's {@link TableStyle.corners}. */
  readonly radius?: Corners;
}

/** How the rows of one kind are painted. */
export interface TableRowKind {
  /** A colour for every cell of the row, or one per column (`undefined`: no shape). */
  readonly fill?: string | readonly (string | undefined)[];
  /**
   * Colours that alternate along the rows of this kind, from the first; over `fill`. A row of
   * another kind between two does not break the alternation. `null` is a row with no shape:
   * `[stripe, null]` stripes every other row and leaves the rest bare. `null` and not
   * `undefined`, so the entry survives a style written out as JSON.
   */
  readonly zebra?: readonly (string | null)[];
  /** A row of this kind is never shorter than this. Over the table's `minRowHeight`. */
  readonly minHeight?: number;
  /** The group a row of this kind is drawn in, over the table's {@link TableStyle.names}. */
  readonly name?: string;
}

export interface TableStyle {
  readonly columns: readonly TableColumn[];
  /** The row kinds by name; a row whose kind is not here draws no shapes. */
  readonly kinds: Readonly<Record<string, TableRowKind>>;
  /**
   * `side-by-side` (the default): each cell sits in its own slot, `columnGap` apart.
   *
   * `overlap`: each cell's shape runs from the row's left edge to its own right edge, and
   * earlier cells are painted over later ones — a badge laid over the left end of a pill
   * the width of the row. The cells' content still starts where the cell starts.
   */
  readonly layering?: 'side-by-side' | 'overlap';
  /** Space between cells; used by `side-by-side` only. */
  readonly columnGap?: number;
  readonly rowGap: number;
  /** A row is never shorter than this, however short its content. */
  readonly minRowHeight: number;
  /**
   * `every-cell` rounds each cell; `outer` rounds only the table's four outer corners, so the
   * rows read as one shape cut by the gaps. A column's own `radius` wins over both.
   */
  readonly corners?: { readonly radius: number; readonly at: 'every-cell' | 'outer' };
  /** The groups the table draws, so a scene reads back in the caller's words. */
  readonly names: {
    /** The stack of rows; absent, the stack has no name. */
    readonly table?: string;
    /** A row's group, unless its kind names its own. */
    readonly row: string;
    /** A band's cell; default `band`. */
    readonly band?: string;
  };
}

export interface TableCell {
  /**
   * The content at the cell's inner width. While the table measures, `height` is absent;
   * when it draws, `height` is the row's inner height, so content laid out in the whole cell
   * (a badge centred on the row) can take it. Content that ignores it is placed by the
   * column's `valign`.
   */
  readonly draw: (width: number, height?: number) => Block;
  /** Whether the content's height sets the row's. Default `true`. */
  readonly sizesRow?: boolean;
  /** How wide the content is on one line, for a `measured` column; absent when unknown. */
  readonly naturalWidth?: () => number | undefined;
}

export interface TableRow {
  /** The kind that paints it: a key of {@link TableStyle.kinds}. */
  readonly kind: string;
  /** One per column; a missing cell draws its shape and no content. */
  readonly cells: readonly (TableCell | undefined)[];
  /** A band: the row's first cell across every column, with the outer columns' padding. */
  readonly span?: boolean;
}

/** A column resolved against the table's width: where it starts and how wide it is. */
interface Placed {
  readonly column: TableColumn;
  readonly index: number;
  readonly x: number;
  readonly width: number;
}

/** The table, drawn: `width` wide, as tall as its rows. */
export function oldTable(style: TableStyle, rows: readonly TableRow[], width: number): Block {
  const placed = placeColumns(style, rows, width);
  const seen = new Map<string, number>();

  const drawn = rows.map((row, index) => {
    const count = seen.get(row.kind) ?? 0;
    seen.set(row.kind, count + 1);
    const edges = { first: index === 0, last: index === rows.length - 1 };
    return row.span === true
      ? drawBand(style, placed, row, count, edges, width)
      : drawRow(style, placed, row, count, edges, width);
  });

  return stack({
    ...(style.names.table === undefined ? {} : { name: style.names.table }),
    gap: style.rowGap,
    items: drawn,
  });
}

function gapOf(style: TableStyle): number {
  return (style.layering ?? 'side-by-side') === 'side-by-side' ? (style.columnGap ?? 0) : 0;
}

function paddingOf(column: TableColumn): CellPadding {
  return column.padding ?? NO_PADDING;
}

/** Where each column starts and how wide it is, measured columns first. */
function placeColumns(style: TableStyle, rows: readonly TableRow[], width: number): Placed[] {
  const gap = gapOf(style);
  const widths = style.columns.map((column, index) => {
    if (typeof column.width === 'number' || column.width === 'fill') return column.width;
    const padding = paddingOf(column);
    let widest = 0;
    for (const row of rows) {
      if (row.span === true) continue;
      const natural = row.cells[index]?.naturalWidth?.();
      if (natural !== undefined) widest = Math.max(widest, natural);
    }
    return Math.max(column.width.measured.min, padding.left + widest + padding.right);
  });

  const taken = widths.reduce<number>((sum, each) => sum + (each === 'fill' ? 0 : each), 0);
  const fill = width - taken - gap * Math.max(0, style.columns.length - 1);

  let x = 0;
  return style.columns.map((column, index) => {
    const own = widths[index]!;
    const columnWidth = own === 'fill' ? fill : own;
    const result = { column, index, x, width: columnWidth };
    x += columnWidth + gap;
    return result;
  });
}

interface Edges {
  readonly first: boolean;
  readonly last: boolean;
}

/** The fill a kind gives one column, on the `count`-th row of that kind. */
function fillOf(style: TableStyle, kind: string, column: number, count: number) {
  const paint = style.kinds[kind];
  if (paint === undefined) return undefined;
  if (paint.zebra !== undefined && paint.zebra.length > 0) {
    return paint.zebra[count % paint.zebra.length] ?? undefined;
  }
  return typeof paint.fill === 'string' ? paint.fill : paint.fill?.[column];
}

/** A cell's corners: its column's, or the table's on every cell or on its outer edge. */
function cornersOf(
  style: TableStyle,
  column: TableColumn | undefined,
  edges: Edges,
  left: boolean,
  right: boolean,
): Corners | undefined {
  if (column?.radius !== undefined) return column.radius;
  const corners = style.corners;
  if (corners === undefined) return undefined;
  if (corners.at === 'every-cell') return corners.radius;
  const r = corners.radius;
  const tuple = [
    edges.first && left ? r : 0,
    edges.first && right ? r : 0,
    edges.last && right ? r : 0,
    edges.last && left ? r : 0,
  ] as const;
  return tuple.every((each) => each === 0) ? undefined : tuple;
}

/** One row: every cell as tall as the tallest one needs, and never below the minimum. */
function drawRow(
  style: TableStyle,
  placed: readonly Placed[],
  row: TableRow,
  count: number,
  edges: Edges,
  width: number,
): Block {
  const measured = placed.map((cell) => {
    const content = row.cells[cell.index];
    if (content === undefined) return undefined;
    const padding = paddingOf(cell.column);
    return content.draw(cell.width - padding.left - padding.right);
  });

  const height = placed.reduce(
    (tallest, cell, index) => {
      const content = row.cells[cell.index];
      const own = measured[index];
      if (content === undefined || own === undefined || content.sizesRow === false) {
        return tallest;
      }
      const padding = paddingOf(cell.column);
      return Math.max(tallest, own.height + padding.top + padding.bottom);
    },
    minHeightOf(style, row.kind),
  );

  const overlap = style.layering === 'overlap';
  const drawn = placed.map((cell) => {
    const padding = paddingOf(cell.column);
    const inner = {
      w: cell.width - padding.left - padding.right,
      h: height - padding.top - padding.bottom,
    };
    const content = row.cells[cell.index]?.draw(inner.w, inner.h);
    // Under `overlap` the cell's group sits at the row's left edge and its shape reaches from
    // there to the cell's right edge; the content is offset to where the cell starts.
    const origin = overlap ? 0 : cell.x;
    const start = overlap ? cell.x : 0;
    const shapeWidth = overlap ? cell.x + cell.width : cell.width;
    const fill = fillOf(style, row.kind, cell.index, count);
    const corners = cornersOf(
      style,
      cell.column,
      edges,
      cell.index === 0,
      cell.index === placed.length - 1,
    );
    return shift(
      cellGroup(cell.column.name, { w: shapeWidth, h: height }, fill, corners, content, {
        x: start + padding.left,
        y: padding.top + offsetOf(cell.column.valign, inner.h, content),
      }),
      origin,
      0,
    );
  });

  return block(
    width,
    height,
    group({
      name: rowNameOf(style, row.kind),
      // Painted in order, so under `overlap` the earlier cells go last and cover the
      // rounded left ends of the later ones.
      children: overlap ? drawn.reverse() : drawn,
    }),
  );
}

/** A band: one cell across the table, padded by the outer columns. */
function drawBand(
  style: TableStyle,
  placed: readonly Placed[],
  row: TableRow,
  count: number,
  edges: Edges,
  width: number,
): Block {
  const first = placed[0]?.column;
  const last = placed[placed.length - 1]?.column;
  const padding = {
    top: first === undefined ? 0 : paddingOf(first).top,
    bottom: first === undefined ? 0 : paddingOf(first).bottom,
    left: first === undefined ? 0 : paddingOf(first).left,
    right: last === undefined ? 0 : paddingOf(last).right,
  };
  const innerWidth = width - padding.left - padding.right;
  const content = row.cells[0];
  const measured = content?.draw(innerWidth);
  const height = Math.max(
    minHeightOf(style, row.kind),
    measured === undefined || content?.sizesRow === false
      ? 0
      : measured.height + padding.top + padding.bottom,
  );
  const innerHeight = height - padding.top - padding.bottom;
  const drawn = content?.draw(innerWidth, innerHeight);
  const corners = cornersOf(style, undefined, edges, true, true);

  return block(
    width,
    height,
    group({
      name: rowNameOf(style, row.kind),
      children: [
        cellGroup(
          style.names.band ?? 'band',
          { w: width, h: height },
          fillOf(style, row.kind, 0, count),
          corners,
          drawn,
          { x: padding.left, y: padding.top + offsetOf(first?.valign, innerHeight, drawn) },
        ),
      ],
    }),
  );
}

function rowNameOf(style: TableStyle, kind: string): string {
  return style.kinds[kind]?.name ?? style.names.row;
}

function minHeightOf(style: TableStyle, kind: string): number {
  return style.kinds[kind]?.minHeight ?? style.minRowHeight;
}

/** How far down a cell's content sits in the room it has. */
function offsetOf(valign: TableColumn['valign'], room: number, content: Block | undefined): number {
  if (content === undefined) return 0;
  const spare = room - content.height;
  if (spare <= 0) return 0;
  const where = valign ?? 'middle';
  if (where === 'top') return 0;
  return where === 'bottom' ? spare : spare / 2;
}

/** A cell: its shape when it has a fill, and its content at `place`. */
function cellGroup(
  name: string,
  size: { readonly w: number; readonly h: number },
  fill: string | undefined,
  corners: Corners | undefined,
  content: Block | undefined,
  place: { readonly x: number; readonly y: number },
): NodeDraft {
  const children: NodeDraft[] = [];
  if (fill !== undefined) {
    children.push(
      rect({ size, ...(corners === undefined ? {} : { radius: corners }), fill: solid(fill) }),
    );
  }
  if (content !== undefined) children.push(shift(content.draft, place.x, place.y));
  return group({ name, children });
}

/** A draft moved by an offset, added to the coordinate it already carries. */
function shift(draft: NodeDraft, dx: number, dy: number): NodeDraft {
  if (dx === 0 && dy === 0) return draft;
  return at(dx, dy, block(0, 0, draft));
}
