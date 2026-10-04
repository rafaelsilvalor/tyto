/**
 * The one-image table (TYTO-218): a title over a table, the **whole table in one 1080×1350
 * image**, however small it has to get — the social team's brief says people zoom in.
 *
 * Composed once for any brand of the house, as the weekly agenda is (ADR 0055): a template is
 * this function applied to a {@link TableBrand}. Only roxo draws it today.
 *
 * ## The page, top to bottom
 *
 * | row    | what                                     | size                               |
 * | ------ | ---------------------------------------- | ---------------------------------- |
 * | brand  | the owl, top left                        | `BRAND_ROW`                        |
 * | title  | the brief's `titulo`, uppercase, centred | measured: ≤ `TITLE.maxLines` lines |
 * | table  | header, rows, bands; centred below title | measured: the fit loop             |
 * | handle | the brand's handle, centred, at the foot | `HANDLE`                           |
 *
 * ## What is decided by measuring, and how
 *
 * Nothing about the table's size is a token. For a body size `s`:
 *
 * 1. **Column widths.** A column can never be narrower than its widest unbreakable piece
 *    (`table-text.ts` decides what a piece is) plus its padding: that is its `min`. Its
 *    `natural` is its widest cell on one line. If every column fits at its natural width, the
 *    leftover is shared equally. If not, every column starts at its `min` and the leftover
 *    goes to each in proportion to how much it still wants (`natural − min`) — the columns
 *    that would wrap most get the most room. If even the `min`s do not fit, `s` fails.
 * 2. **Row heights.** Each cell is measured at its column's width (ADR 0038), so a row is as
 *    tall as its most-wrapped cell.
 * 3. **The title** is the largest size, up to `TITLE.perBody × s`, that sets it in at most
 *    `TITLE.maxLines` lines — so neither the title nor the table dwarfs the other.
 *
 * The **fit loop** is a binary search for the largest `s` between `BODY.floor` and
 * `BODY.ceiling` whose title and table fit the room between the brand row and the handle.
 * Height only grows with `s`, which is what makes the search valid. When even the floor does
 * not fit, the table is drawn at the floor and **`W_TEMPLATE_OVERFLOW` says by how much**
 * (ADR 0058) — never a silent cut.
 *
 * Widths are measured once at `REFERENCE_SIZE` and scaled: an advance is linear in the size,
 * and so is tracking written in `em`. Heights are measured at the size tried, because they
 * depend on where the lines break.
 */

import { frame, group, lineBreak, rect, run, solid, text } from '@tyto/core/template';
import { type Block, at, block, lines, mark, plain, reportOverflow } from '@tyto/template-kit';

import { OWL } from './marks.js';
import { pieces } from './breaks.js';
import { glue, readTable } from './table-text.js';
import {
  BAND,
  BODY,
  BRAND_ROW,
  CELL,
  HANDLE,
  HANDLE_INK,
  HEADER,
  INK,
  ON_ACCENT,
  PAGE,
  PAPER,
  REFERENCE_SIZE,
  TITLE,
  UNMEASURED,
  ZEBRA,
} from './table-tokens.js';
import { BLACK, BOLD, BOOK, FACE } from './tokens.js';

import type { TableBrand } from './brands.js';
import type { TableContent, TableRow } from './table-text.js';
import type { RichText, TemplateBuild, TemplateContext, TextRun } from '@tyto/core';
import type { NodeDraft, NonEmpty } from '@tyto/core/template';
import type { Measure } from '@tyto/template-kit';

/** The build for one brand's table. */
export function oneImageTable(brand: TableBrand): TemplateBuild {
  return (context: TemplateContext) => {
    const width = context.size.w - PAGE.side * 2;
    const regionTop = PAGE.top + BRAND_ROW.height;
    const regionBottom = context.size.h - PAGE.bottom - HANDLE.height;
    const room = regionBottom - regionTop;

    const table = readTable(richTextOf(context, 'tabela') ?? []);
    const title = titleLines(richTextOf(context, 'titulo') ?? []);
    const glued = gluedCells(table);

    const plan = fit(table, glued, title, width, room, context.measure);
    reportOverflow(context.report, plan.height, room);

    const titleBlock = drawTitle(title, plan, width, brand.accent);
    const tableBlock = drawTable(table, glued, plan, brand.accent);
    // The title stands under the brand row; the table is centred in what the title leaves.
    const tableTop = regionTop + titleBlock.height + TITLE.gap;
    const tableY = tableTop + Math.max(0, (regionBottom - tableTop - tableBlock.height) / 2);

    return frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      background: solid(PAPER),
      children: [
        at(PAGE.side, PAGE.top, mark(OWL, BRAND_ROW.owl, brand.accent, 'owl')),
        at(PAGE.side, regionTop, titleBlock),
        at(PAGE.side, tableY, tableBlock),
        at(PAGE.side, regionBottom, drawHandle(brand, width)),
      ],
    });
  };
}

/* --------------------------------------------------------------------- the styles -- */

type Role = 'cell' | 'header' | 'band';

interface RoleStyle {
  readonly weight: number;
  readonly color: string;
  /** Tracking, in em. */
  readonly tracking: number;
  readonly lineHeight: number;
  /** Padding, in em. */
  readonly block: number;
  readonly inline: number;
  readonly upper: boolean;
}

function roleStyle(role: Role): RoleStyle {
  switch (role) {
    case 'cell':
      return {
        weight: BOOK,
        color: INK,
        tracking: 0,
        lineHeight: BODY.lineHeight,
        block: BODY.padding.block,
        inline: BODY.padding.inline,
        upper: false,
      };
    case 'header':
      return {
        weight: BOOK,
        color: ON_ACCENT,
        tracking: HEADER.tracking,
        lineHeight: HEADER.lineHeight,
        block: BODY.padding.block * HEADER.block,
        inline: BODY.padding.inline,
        upper: true,
      };
    case 'band':
      return {
        weight: BOLD,
        color: ON_ACCENT,
        tracking: BAND.tracking,
        lineHeight: HEADER.lineHeight,
        block: BODY.padding.block * BAND.block,
        inline: BAND.inline,
        upper: true,
      };
  }
}

/** A cell's words as a text node's options, at a size. */
function cellText(words: string, role: Role, size: number) {
  const style = roleStyle(role);
  return {
    runs: [
      run(style.upper ? words.toLocaleUpperCase('pt-BR') : words, {
        font: FACE,
        size,
        weight: style.weight,
        color: style.color,
      }),
    ] as NonEmpty<TextRun>,
    lineHeight: style.lineHeight,
    letterSpacing: style.tracking * size,
  };
}

/* ---------------------------------------------------------------------- the words -- */

/** Every cell glued (`table-text.ts`), in the table's shape. */
interface GluedTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function gluedCells(table: TableContent): GluedTable {
  return {
    header: table.header.map(glue),
    rows: table.rows.map((row) => (row.kind === 'cells' ? row.cells.map(glue) : [glue(row.text)])),
  };
}

/** The title's lines as the author broke them, uppercase. */
function titleLines(titulo: RichText): string[] {
  return lines(titulo).map((line) =>
    plain(line).replace(/\s+/gu, ' ').trim().toLocaleUpperCase('pt-BR'),
  );
}

/* ------------------------------------------------------------------- the fit loop -- */

/** What the fit loop decided. */
export interface TablePlan {
  /** The body size. */
  readonly size: number;
  /** The title size. */
  readonly title: number;
  readonly titleHeight: number;
  /** Each column's width, padding included, in px. */
  readonly widths: readonly number[];
  /** The header's height, then each body row's, in px. */
  readonly heights: readonly number[];
  /** Title, gap and table: what has to fit the room. */
  readonly height: number;
  /** Whether nothing could measure, and every cell shrinks into a guessed box. */
  readonly unmeasured: boolean;
}

function fit(
  table: TableContent,
  glued: GluedTable,
  title: readonly string[],
  width: number,
  room: number,
  measure: Measure,
): TablePlan {
  const columns = table.header.length;
  const across = width - CELL.gapX * Math.max(0, columns - 1);
  const demand = columnDemand(table, glued, measure);
  if (demand === undefined) return unmeasuredPlan(table, title, width);

  const planAt = (size: number): TablePlan | undefined => {
    const widths = columnWidths(demand, size, across);
    if (widths === undefined) return undefined;
    const heights = rowHeights(table, glued, widths, size, measure);
    const titleSize = titleSizeFor(title, size, width, measure);
    const titleHeight = titleHeightAt(title, titleSize, width, measure);
    const tableHeight = sum(heights) + CELL.gapY * Math.max(0, heights.length - 1);
    return {
      size,
      title: titleSize,
      titleHeight,
      widths,
      heights,
      height: titleHeight + TITLE.gap + tableHeight,
      unmeasured: false,
    };
  };

  // The largest step whose plan fits; the steps are the sizes the loop may land on.
  let low = Math.ceil(BODY.floor / BODY.step);
  let high = Math.floor(BODY.ceiling / BODY.step);
  let best: TablePlan | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const plan = planAt(middle * BODY.step);
    if (plan !== undefined && plan.height <= room) {
      best = plan;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (best !== undefined) return best;

  // Not even the floor fits: draw it at the floor, and the caller reports the overflow. If
  // the floor's pieces do not fit across either, they share the width by their minimums.
  return planAt(BODY.floor) ?? floorPlan(table, glued, demand, title, width, across, measure);
}

/** How much room each column asks for, measured once at {@link REFERENCE_SIZE}. */
interface Demand {
  /** The widest unbreakable piece, text only. */
  readonly min: readonly number[];
  /** The widest cell on one line, text only. */
  readonly natural: readonly number[];
}

function columnDemand(
  table: TableContent,
  glued: GluedTable,
  measure: Measure,
): Demand | undefined {
  const min: number[] = table.header.map(() => 0);
  const natural: number[] = table.header.map(() => 0);

  const take = (words: string, role: Role, column: number): boolean => {
    const whole = widthAt(words, role, measure);
    if (whole === undefined) return false;
    natural[column] = Math.max(natural[column]!, whole);
    for (const piece of pieces(words)) {
      const one = widthAt(piece, role, measure);
      if (one === undefined) return false;
      min[column] = Math.max(min[column]!, one);
    }
    return true;
  };

  for (const [column, words] of glued.header.entries()) {
    if (!take(words, 'header', column)) return undefined;
  }
  for (const [index, row] of table.rows.entries()) {
    if (row.kind !== 'cells') continue;
    for (const [column, words] of glued.rows[index]!.entries()) {
      if (!take(words, 'cell', column)) return undefined;
    }
  }
  return { min, natural };
}

/** One line's width at the reference size, or nothing when nothing can measure. */
function widthAt(words: string, role: Role, measure: Measure): number | undefined {
  if (words === '') return 0;
  const measured = measure(text({ ...cellText(words, role, REFERENCE_SIZE), box: {} }));
  return measured?.width;
}

/**
 * Each column's width at `size`, padding included, or nothing when even the minimums do not
 * fit across `room`.
 */
export function columnWidths(demand: Demand, size: number, room: number): number[] | undefined {
  const scale = size / REFERENCE_SIZE;
  const padding = 2 * BODY.padding.inline * size;
  // A pixel of slack, so a box made exactly as wide as its piece never wraps it over a
  // rounding error between the scaled width and the one measured at this size.
  const min = demand.min.map((value) => Math.ceil(value * scale + padding) + 1);
  const natural = demand.natural.map((value, column) =>
    Math.max(min[column]!, Math.ceil(value * scale + padding) + 1),
  );

  if (sum(natural) <= room) {
    const share = (room - sum(natural)) / natural.length;
    return natural.map((value) => value + share);
  }
  if (sum(min) > room) return undefined;

  const leftover = room - sum(min);
  const wants = natural.map((value, column) => value - min[column]!);
  const wanted = sum(wants);
  return min.map((value, column) => value + (leftover * wants[column]!) / wanted);
}

/** The header's height, then each body row's, at `size` with these widths. */
function rowHeights(
  table: TableContent,
  glued: GluedTable,
  widths: readonly number[],
  size: number,
  measure: Measure,
): number[] {
  const whole = sum(widths) + CELL.gapX * Math.max(0, widths.length - 1);
  const rowOf = (cells: readonly string[], role: Role, spans: readonly number[]): number => {
    const style = roleStyle(role);
    let tallest = style.lineHeight * size;
    for (const [column, words] of cells.entries()) {
      if (words === '') continue;
      const inner = spans[column]! - 2 * style.inline * size;
      const measured = measure(text({ ...cellText(words, role, size), box: { w: inner } }));
      tallest = Math.max(tallest, measured?.height ?? style.lineHeight * size);
    }
    return tallest + 2 * style.block * size;
  };

  return [
    rowOf(glued.header, 'header', widths),
    ...table.rows.map((row: TableRow, index) =>
      row.kind === 'cells'
        ? rowOf(glued.rows[index]!, 'cell', widths)
        : rowOf(glued.rows[index]!, 'band', [whole]),
    ),
  ];
}

/** The largest title size up to its share of `size` that sets in `TITLE.maxLines` lines. */
function titleSizeFor(
  title: readonly string[],
  size: number,
  width: number,
  measure: Measure,
): number {
  const ceiling = Math.max(TITLE.floor, Math.min(TITLE.ceiling, Math.floor(TITLE.perBody * size)));
  let low: number = TITLE.floor;
  let high = ceiling;
  let best: number = TITLE.floor;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const measured = measureTitle(title, middle, width, measure);
    if (measured === undefined || measured.lines <= TITLE.maxLines) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

function titleHeightAt(
  title: readonly string[],
  size: number,
  width: number,
  measure: Measure,
): number {
  if (title.length === 0) return 0;
  const measured = measureTitle(title, size, width, measure);
  return measured?.height ?? TITLE.maxLines * TITLE.lineHeight * size;
}

/** When nothing can measure: equal columns, the approved art's sizes, and guessed heights. */
function unmeasuredPlan(table: TableContent, title: readonly string[], width: number): TablePlan {
  const columns = Math.max(1, table.header.length);
  const size = UNMEASURED.body;
  const column = (width - CELL.gapX * (columns - 1)) / columns;
  const line = (role: Role) => {
    const style = roleStyle(role);
    return style.lineHeight * size + 2 * style.block * size;
  };
  const heights = [
    line('header'),
    ...table.rows.map((row) => line(row.kind === 'cells' ? 'cell' : 'band')),
  ];
  const titleHeight = title.length === 0 ? 0 : title.length * TITLE.lineHeight * UNMEASURED.title;
  return {
    size,
    title: UNMEASURED.title,
    titleHeight,
    widths: table.header.map(() => column),
    heights,
    height: titleHeight + TITLE.gap + sum(heights) + CELL.gapY * Math.max(0, heights.length - 1),
    unmeasured: true,
  };
}

/** At the floor, when the pieces themselves do not fit across: widths in proportion to them. */
function floorPlan(
  table: TableContent,
  glued: GluedTable,
  demand: Demand,
  title: readonly string[],
  width: number,
  room: number,
  measure: Measure,
): TablePlan {
  const size = BODY.floor;
  const total = sum(demand.min);
  const widths = demand.min.map((value) =>
    total === 0 ? room / demand.min.length : (room * value) / total,
  );
  const heights = rowHeights(table, glued, widths, size, measure);
  const titleHeight = titleHeightAt(title, TITLE.floor, width, measure);
  return {
    size,
    title: TITLE.floor,
    titleHeight,
    widths,
    heights,
    height: titleHeight + TITLE.gap + sum(heights) + CELL.gapY * Math.max(0, heights.length - 1),
    unmeasured: false,
  };
}

/* ------------------------------------------------------------------------ drawing -- */

/** The title's text node: its lines as the author broke them, centred, in heavy type. */
function titleNode(
  title: readonly string[],
  size: number,
  width: number,
  color: string,
  height?: number,
) {
  const [first = '', ...rest] = title;
  const style = { font: FACE, size, weight: BLACK, color };
  const runs: NonEmpty<TextRun> = [
    run(first, style),
    ...rest.flatMap((line) => [lineBreak(), run(line, style)]),
  ];
  return text({
    name: 'title',
    runs,
    box: height === undefined ? { w: width } : { w: width, h: height },
    align: 'center',
    lineHeight: TITLE.lineHeight,
    letterSpacing: TITLE.tracking * size,
  });
}

/** The title measured as it will be drawn: inside the page and its own inset. */
function measureTitle(title: readonly string[], size: number, width: number, measure: Measure) {
  return measure(titleNode(title, size, width - 2 * TITLE.inset, INK));
}

function drawTitle(
  title: readonly string[],
  plan: TablePlan,
  width: number,
  accent: string,
): Block {
  if (title.length === 0) return block(width, 0, group({ name: 'title', children: [] }));
  const inner = width - 2 * TITLE.inset;
  const node = titleNode(title, plan.title, inner, accent, plan.titleHeight);
  return block(
    width,
    plan.titleHeight,
    group({ children: [at(TITLE.inset, 0, block(inner, plan.titleHeight, node))] }),
  );
}

/**
 * The table: the header row in the accent, the body rows zebra-striped from the first, a
 * band across every column in the accent. Rounded cells with small gaps between them.
 */
function drawTable(table: TableContent, glued: GluedTable, plan: TablePlan, accent: string): Block {
  const whole = sum(plan.widths) + CELL.gapX * Math.max(0, plan.widths.length - 1);
  const children: NodeDraft[] = [];
  let y = 0;
  let striped = 0;

  const drawRow = (
    name: string,
    cells: readonly string[],
    role: Role,
    spans: readonly number[],
    fill: string | undefined,
    height: number,
  ): void => {
    const style = roleStyle(role);
    const cellNodes: NodeDraft[] = [];
    let x = 0;
    for (const [column, words] of cells.entries()) {
      const span = spans[column]!;
      if (fill !== undefined) {
        cellNodes.push(
          rect({
            name: 'cell',
            size: { w: span, h: height },
            radius: CELL.radius,
            fill: solid(fill),
            transform: { x, y },
          }),
        );
      }
      if (words !== '') {
        // The full height of the cell, centred: its block padding is the room around the
        // words, and subtracting it back out would leave a box a rounding error shorter than
        // the lines it was measured for.
        const padX = style.inline * plan.size;
        cellNodes.push(
          text({
            ...cellText(words, role, plan.size),
            name: 'cell-text',
            box: { w: span - 2 * padX, h: height },
            align: 'center',
            valign: 'middle',
            ...(plan.unmeasured ? { overflow: 'shrink' as const } : {}),
            transform: { x: x + padX, y },
          }),
        );
      }
      x += span + CELL.gapX;
    }
    children.push(group({ name, children: cellNodes }));
  };

  drawRow('header-row', glued.header, 'header', plan.widths, accent, plan.heights[0]!);
  y += plan.heights[0]! + CELL.gapY;

  for (const [index, row] of table.rows.entries()) {
    const height = plan.heights[index + 1]!;
    if (row.kind === 'band') {
      drawRow('band-row', glued.rows[index]!, 'band', [whole], accent, height);
    } else {
      // The first body row is striped, as in the approved art; a band does not count.
      drawRow(
        'body-row',
        glued.rows[index]!,
        'cell',
        plan.widths,
        striped % 2 === 0 ? ZEBRA : undefined,
        height,
      );
      striped += 1;
    }
    y += height + CELL.gapY;
  }

  const height = Math.max(0, y - CELL.gapY);
  return block(whole, height, group({ name: 'table', children }));
}

/** The handle, centred and tracked out, standing on the foot of its row. */
function drawHandle(brand: TableBrand, width: number): Block {
  const words = text({
    name: 'handle',
    runs: [run(brand.handle, { font: FACE, size: HANDLE.size, weight: BOOK, color: HANDLE_INK })],
    box: { w: width, h: HANDLE.height },
    align: 'center',
    valign: 'bottom',
    letterSpacing: HANDLE.tracking * HANDLE.size,
  });
  return block(width, HANDLE.height, group({ name: 'sign-off', children: [words] }));
}

/* ------------------------------------------------------------------------ helpers -- */

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** A rich-text slot's value, or nothing when the brief left it unset. */
function richTextOf(context: TemplateContext, name: string): RichText | undefined {
  const value = context.slots[name]?.value;
  return value?.kind === 'rich-text' ? value.text : undefined;
}
