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
 * | brand  | the logo, top left                        | `BRAND_ROW`                        |
 * | title  | the brief's `titulo`, uppercase, centred | measured: ≤ `TITLE.maxLines` lines |
 * | table  | header, rows, bands; centred below title | measured: the fit loop             |
 * | signature | the brand's signature, centred, at the foot | `SIGNATURE`                           |
 *
 * ## What is decided by measuring, and how
 *
 * Nothing about the table's size is a token. For a body size `s`:
 *
 * 1. **Column widths.** A column can never be narrower than its widest unbreakable piece
 *    (`table-text.ts` decides what a piece is) plus its padding: that is its `min`. Its
 *    `natural` is its widest cell on one line. If every column fits at its natural width, the
 *    leftover is shared equally. If even the `min`s do not fit, `s` fails. Otherwise every
 *    column starts at its `min` and the leftover is spent **where it makes the table shortest**
 *    (see {@link columnWidths}): the whole column is read, every cell of it, so a column with
 *    one long cell in a row that is tall anyway gives way to a column whose every cell wraps.
 * 2. **Row heights.** Each cell is measured at its column's width (ADR 0038), so a row is as
 *    tall as its most-wrapped cell. A `\` the author typed in a cell is a line it always has.
 * 3. **The title** is the largest size, up to `TITLE.perBody × s`, that sets it in at most
 *    `TITLE.maxLines` lines — so neither the title nor the table dwarfs the other. A title the
 *    author broke into lines keeps exactly those lines, each whole (`titleLineLimit`).
 * 4. **The notes**, the `*` lines, are set under the table at `NOTE.perBody × s`, and their
 *    height is part of what has to fit.
 *
 * The **fit loop** is a binary search for the largest `s` between `BODY.floor` and
 * `BODY.ceiling` whose title and table fit the room between the brand row and the signature.
 * Height only grows with `s`, which is what makes the search valid. When even the floor does
 * not fit, the table is drawn at the floor and **`W_TEMPLATE_OVERFLOW` says by how much**
 * (ADR 0058) — never a silent cut.
 *
 * Widths are measured once at `REFERENCE_SIZE` and scaled: an advance is linear in the size,
 * and so is tracking written in `em`. Heights are measured at the size tried, because they
 * depend on where the lines break.
 */

import {
  colorValue,
  frame,
  group,
  lineBreak,
  numberValue,
  rect,
  run,
  solid,
  text,
} from '@tyto/core/template';
import { type Block, at, block, lines, plain, reportOverflow } from '@tyto/template-kit';

import { accentOf, drawLogo, oneInk, signatureOf } from './kit.js';
import { pieces } from './breaks.js';
import { glue, readTable } from './table-text.js';
import {
  BAND,
  BODY,
  BRAND_ROW,
  CELL,
  SIGNATURE,
  SIGNATURE_INK,
  HEADER,
  INK,
  NOTE,
  ON_ACCENT,
  OPTICAL_DROP,
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
import type { BrandKit, RichText, TemplateBuild, TemplateContext, TextRun } from '@tyto/core';
import type { NodeDraft, NonEmpty } from '@tyto/core/template';
import type { Measure } from '@tyto/template-kit';

/** The build for one brand's table. */
export function oneImageTable(own: TableBrand): TemplateBuild {
  return (context: TemplateContext) => {
    // The kit's accent over the template's own (ADR 0155).
    const brand: TableBrand = { accent: accentOf(context.brand, own.accent) };
    const width = context.size.w - PAGE.side * 2;
    const regionTop = PAGE.top + BRAND_ROW.height;
    const regionBottom = context.size.h - PAGE.bottom - SIGNATURE.height;
    const room = regionBottom - regionTop;

    const look = lookOf(context);
    const table = readTable(richTextOf(context, 'tabela') ?? []);
    const title = titleLines(richTextOf(context, 'titulo') ?? []);
    const glued = gluedCells(table);

    const plan = fit(table, glued, title, width, room, context.measure, look);
    reportOverflow(context.report, plan.height, room);

    const titleBlock = drawTitle(title, plan, width, brand.accent);
    const tableBlock = drawTable(table, glued, plan, brand.accent, look);
    const notesBlock = drawNotes(table.notes, plan, width, look);
    // The title stands under the brand row and the table a fixed gap under the title. Whatever
    // room the fit leaves goes to the foot: centring the table in it made the gap grow with
    // every table that fits by its width rather than its height.
    const tableY = regionTop + titleBlock.height + look.titleGap;

    return frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      background: solid(look.paper),
      children: [
        at(PAGE.side, PAGE.top, drawLogo(context.brand, BRAND_ROW.logo, oneInk(brand.accent))),
        at(PAGE.side, regionTop, titleBlock),
        at(PAGE.side, tableY, tableBlock),
        ...(notesBlock === undefined
          ? []
          : [at(PAGE.side, tableY + tableBlock.height + plan.notesGap, notesBlock)]),
        at(PAGE.side, regionBottom, drawSignature(context.brand, width, look)),
      ],
    });
  };
}

/* ----------------------------------------------------------------------- the look -- */

/**
 * What a configuration may change in the table (TYTO-438, ADR 0153), by the names a
 * template's manifest declares them under, each defaulting to the token it replaced. A
 * template that declares them in its manifest's `values` gets them configurable; one that
 * does not, or a context with no values, draws with these.
 *
 * Not the accent: that is the brand's, and moves with the brand kit (TYTO-455).
 */
export const TABLE_VALUE_DEFAULTS = {
  'title-gap': TITLE.gap,
  'title-floor': TITLE.floor,
  'title-ceiling': TITLE.ceiling,
  'body-floor': BODY.floor,
  'body-ceiling': BODY.ceiling,
  'optical-drop': OPTICAL_DROP,
  paper: PAPER,
  ink: INK,
  zebra: ZEBRA,
  'on-accent': ON_ACCENT,
  'signature-ink': SIGNATURE_INK,
} as const;

/** The table's configurable values, resolved for one call. */
interface TableLook {
  readonly titleGap: number;
  readonly titleFloor: number;
  readonly titleCeiling: number;
  readonly bodyFloor: number;
  readonly bodyCeiling: number;
  /** In em; see {@link OPTICAL_DROP}. */
  readonly opticalDrop: number;
  readonly paper: string;
  readonly ink: string;
  readonly zebra: string;
  readonly onAccent: string;
  readonly signatureInk: string;
}

function lookOf(context: TemplateContext): TableLook {
  const defaults = TABLE_VALUE_DEFAULTS;
  return {
    titleGap: numberValue(context, 'title-gap', defaults['title-gap']),
    titleFloor: numberValue(context, 'title-floor', defaults['title-floor']),
    titleCeiling: numberValue(context, 'title-ceiling', defaults['title-ceiling']),
    bodyFloor: numberValue(context, 'body-floor', defaults['body-floor']),
    bodyCeiling: numberValue(context, 'body-ceiling', defaults['body-ceiling']),
    opticalDrop: numberValue(context, 'optical-drop', defaults['optical-drop']),
    paper: colorValue(context, 'paper', defaults.paper),
    ink: colorValue(context, 'ink', defaults.ink),
    zebra: colorValue(context, 'zebra', defaults.zebra),
    onAccent: colorValue(context, 'on-accent', defaults['on-accent']),
    signatureInk: colorValue(context, 'signature-ink', defaults['signature-ink']),
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

function roleStyle(role: Role, look: TableLook): RoleStyle {
  switch (role) {
    case 'cell':
      return {
        weight: BOOK,
        color: look.ink,
        tracking: 0,
        lineHeight: BODY.lineHeight,
        block: BODY.padding.block,
        inline: BODY.padding.inline,
        upper: false,
      };
    case 'header':
      return {
        weight: BOOK,
        color: look.onAccent,
        tracking: HEADER.tracking,
        lineHeight: HEADER.lineHeight,
        block: BODY.padding.block * HEADER.block,
        inline: BODY.padding.inline,
        upper: true,
      };
    case 'band':
      return {
        weight: BOLD,
        color: look.onAccent,
        tracking: BAND.tracking,
        lineHeight: HEADER.lineHeight,
        block: BODY.padding.block * BAND.block,
        inline: BAND.inline,
        upper: true,
      };
  }
}

/** A cell's words as a text node's options, at a size; each `\n` in them a line break. */
function cellText(words: string, role: Role, size: number, look: TableLook) {
  const style = roleStyle(role, look);
  const runStyle = { font: FACE, size, weight: style.weight, color: style.color };
  const [first = '', ...rest] = (style.upper ? words.toLocaleUpperCase('pt-BR') : words).split(
    '\n',
  );
  return {
    runs: [
      run(first, runStyle),
      ...rest.flatMap((line) => [lineBreak(), run(line, runStyle)]),
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
  /** The notes' size, and their height under the table: 0 when there are none. */
  readonly noteSize: number;
  readonly notesHeight: number;
  /** Table → notes, in px: 0 when there are none. */
  readonly notesGap: number;
  /** Title, gap, table and notes: what has to fit the room. */
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
  look: TableLook,
): TablePlan {
  const columns = table.header.length;
  const across = width - CELL.gapX * Math.max(0, columns - 1);
  const demand = columnDemand(table, glued, measure, look);
  if (demand === undefined) return unmeasuredPlan(table, title, width, look);

  const planAt = (size: number): TablePlan | undefined => {
    const widths = columnWidths(demand, size, across);
    if (widths === undefined) return undefined;
    const heights = rowHeights(table, glued, widths, size, measure, look);
    const titleSize = titleSizeFor(title, size, width, measure, look);
    const titleHeight = titleHeightAt(title, titleSize, width, measure, look);
    const notes = notesAt(table.notes, size, width, measure, look);
    const tableHeight = sum(heights) + CELL.gapY * Math.max(0, heights.length - 1);
    return {
      size,
      title: titleSize,
      titleHeight,
      widths,
      heights,
      ...notes,
      height: titleHeight + look.titleGap + tableHeight + notes.notesGap + notes.notesHeight,
      unmeasured: false,
    };
  };

  // The largest step whose plan fits; the steps are the sizes the loop may land on.
  let low = Math.ceil(look.bodyFloor / BODY.step);
  let high = Math.floor(look.bodyCeiling / BODY.step);
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
  return (
    planAt(look.bodyFloor) ?? floorPlan(table, glued, demand, title, width, across, measure, look)
  );
}

/**
 * One cell as the width search reads it: the row it sets the height of, and the width of
 * every unbreakable piece of each of its lines, at {@link REFERENCE_SIZE}.
 */
export interface CellPieces {
  /** 0 for the header, then each body row by its index + 1. */
  readonly row: number;
  readonly role: 'cell' | 'header';
  /** One list per line the author wrote, `\` breaks splitting them. */
  readonly lines: readonly (readonly number[])[];
}

/** How much room each column asks for, measured once at {@link REFERENCE_SIZE}. */
export interface Demand {
  /** The widest unbreakable piece, text only. */
  readonly min: readonly number[];
  /** The widest line of any cell, text only. */
  readonly natural: readonly number[];
  /** Every cell of each column, for the search that shares the leftover. */
  readonly cells: readonly (readonly CellPieces[])[];
  /** The width of the space between two pieces, by role. */
  readonly space: { readonly cell: number; readonly header: number };
}

function columnDemand(
  table: TableContent,
  glued: GluedTable,
  measure: Measure,
  look: TableLook,
): Demand | undefined {
  const min: number[] = table.header.map(() => 0);
  const natural: number[] = table.header.map(() => 0);
  const cells: CellPieces[][] = table.header.map(() => []);

  const take = (words: string, role: 'cell' | 'header', column: number, row: number): boolean => {
    const cellLines: number[][] = [];
    for (const line of words.split('\n')) {
      const whole = widthAt(line, role, measure, look);
      if (whole === undefined) return false;
      natural[column] = Math.max(natural[column]!, whole);
      const widths: number[] = [];
      for (const piece of pieces(line)) {
        const one = widthAt(piece, role, measure, look);
        if (one === undefined) return false;
        min[column] = Math.max(min[column]!, one);
        widths.push(one);
      }
      if (widths.length > 0) cellLines.push(widths);
    }
    cells[column]!.push({ row, role, lines: cellLines });
    return true;
  };

  for (const [column, words] of glued.header.entries()) {
    if (!take(words, 'header', column, 0)) return undefined;
  }
  for (const [index, row] of table.rows.entries()) {
    if (row.kind !== 'cells') continue;
    for (const [column, words] of glued.rows[index]!.entries()) {
      if (!take(words, 'cell', column, index + 1)) return undefined;
    }
  }

  const spaceOf = (role: Role): number | undefined => {
    // A space measured between two letters: alone, a layout may trim it to nothing.
    const pair = widthAt('n n', role, measure, look);
    const one = widthAt('n', role, measure, look);
    return pair === undefined || one === undefined ? undefined : Math.max(0, pair - 2 * one);
  };
  const cellSpace = spaceOf('cell');
  const headerSpace = spaceOf('header');
  if (cellSpace === undefined || headerSpace === undefined) return undefined;

  return { min, natural, cells, space: { cell: cellSpace, header: headerSpace } };
}

/** One line's width at the reference size, or nothing when nothing can measure. */
function widthAt(words: string, role: Role, measure: Measure, look: TableLook): number | undefined {
  if (words === '') return 0;
  const measured = measure(text({ ...cellText(words, role, REFERENCE_SIZE, look), box: {} }));
  return measured?.width;
}

/**
 * Each column's width at `size`, padding included, or nothing when even the minimums do not
 * fit across `room`.
 *
 * When the natural widths do not fit, every column starts at its minimum and the leftover is
 * spent in steps, each one the widening that **shortens the table most per pixel it costs**.
 * The candidates are the widths at which some cell of a column loses a line; for each one,
 * the table's height is worked out from every cell of every row, the way the layout breaks a
 * line (greedily, at a space). So a column with one long cell does not win room for it when
 * that cell's row is held tall by another column anyway — the column whose cells set the
 * heights does. Ties between two cells holding one row are broken by a small credit for every
 * line saved anywhere, so the search does not stall where two columns must both widen.
 *
 * When no widening shortens anything, what is left goes to each column in proportion to how
 * much it still wants (`natural − width`), as it always did.
 *
 * This only shares the width out; the heights the plan keeps are measured afterwards by the
 * layout itself, so a guess off by a rounding error costs a little room, never a cut line.
 */
export function columnWidths(demand: Demand, size: number, room: number): number[] | undefined {
  const scale = size / REFERENCE_SIZE;
  const padding = 2 * BODY.padding.inline * size;
  // A pixel of slack, so a box made exactly as wide as its piece never wraps it over a
  // rounding error between the scaled width and the one measured at this size.
  const toPx = (value: number) => Math.ceil(value * scale + padding) + 1;
  const min = demand.min.map(toPx);
  const natural = demand.natural.map((value, column) => Math.max(min[column]!, toPx(value)));

  if (sum(natural) <= room) {
    const share = (room - sum(natural)) / natural.length;
    return natural.map((value) => value + share);
  }
  if (sum(min) > room) return undefined;

  const widths = shortestTable(demand, min, room - sum(min), size, toPx);
  const leftover = room - sum(widths);
  const wants = natural.map((value, column) => Math.max(0, value - widths[column]!));
  const wanted = sum(wants);
  return widths.map((value, column) =>
    wanted === 0 ? value + leftover / widths.length : value + (leftover * wants[column]!) / wanted,
  );
}

/** How much a line saved anywhere counts against a row made shorter: a tie-breaker only. */
const LINE_CREDIT = 0.01;

/** The search's step limit: far more steps than any table has candidate widths. */
const MAX_STEPS = 400;

/** The widths, from `start`, that the leftover spent greedily makes the shortest table. */
function shortestTable(
  demand: Demand,
  start: readonly number[],
  leftover: number,
  size: number,
  toPx: (value: number) => number,
): number[] {
  const widths = [...start];
  const scale = size / REFERENCE_SIZE;
  const inline = BODY.padding.inline * size;
  const rows = 1 + Math.max(0, ...demand.cells.flat().map((cell) => cell.row));

  // The lines a cell takes at a column width, as the layout breaks: at a space, greedily.
  const linesOf = (cell: CellPieces, width: number): number => {
    const inner = (width - 2 * inline) / scale;
    const space = demand.space[cell.role];
    let count = 0;
    for (const line of cell.lines) {
      count += 1;
      let used = -1;
      for (const piece of line) {
        if (used < 0) used = piece;
        else if (used + space + piece <= inner) used += space + piece;
        else {
          count += 1;
          used = piece;
        }
      }
    }
    return count;
  };
  const lineHeight = (cell: CellPieces) =>
    (cell.role === 'header' ? HEADER.lineHeight : BODY.lineHeight) * size;

  // Each column's height per row, and its line count, at the column's width.
  const columnAt = (column: number, width: number) => {
    const heights = new Array<number>(rows).fill(0);
    let lineCount = 0;
    for (const cell of demand.cells[column]!) {
      const count = linesOf(cell, width);
      lineCount += count;
      heights[cell.row] = Math.max(heights[cell.row]!, count * lineHeight(cell));
    }
    return { heights, lines: lineCount };
  };
  const cost = (columns: readonly { heights: number[]; lines: number }[]): number => {
    let total = 0;
    for (let row = 0; row < rows; row += 1) {
      total += Math.max(0, ...columns.map((column) => column.heights[row]!));
    }
    return total + LINE_CREDIT * sum(columns.map((column) => column.lines)) * size;
  };

  // Every width at which a cell of the column can lose a line: the width of each run of
  // consecutive pieces of one of its lines.
  const candidates = demand.cells.map((cells) => {
    const found = new Set<number>();
    for (const cell of cells) {
      const space = demand.space[cell.role];
      for (const line of cell.lines) {
        for (let from = 0; from < line.length; from += 1) {
          let span = 0;
          for (let to = from; to < line.length; to += 1) {
            span += (to > from ? space : 0) + line[to]!;
            found.add(toPx(span) + 1);
          }
        }
      }
    }
    return [...found].sort((a, b) => a - b);
  });

  const state = widths.map((width, column) => columnAt(column, width));
  let current = cost(state);
  let left = leftover;
  for (let step = 0; step < MAX_STEPS && left > 0; step += 1) {
    let best: { column: number; width: number; ratio: number; next: number } | undefined;
    for (const [column, list] of candidates.entries()) {
      for (const width of list) {
        const extra = width - widths[column]!;
        if (extra <= 0) continue;
        if (extra > left) break;
        const trial = [...state];
        trial[column] = columnAt(column, width);
        const next = cost(trial);
        const ratio = (current - next) / extra;
        if (ratio <= 1e-9) continue;
        if (best === undefined || ratio > best.ratio) best = { column, width, ratio, next };
      }
    }
    if (best === undefined) break;
    left -= best.width - widths[best.column]!;
    widths[best.column] = best.width;
    state[best.column] = columnAt(best.column, best.width);
    current = best.next;
  }
  return widths;
}

/** The header's height, then each body row's, at `size` with these widths. */
function rowHeights(
  table: TableContent,
  glued: GluedTable,
  widths: readonly number[],
  size: number,
  measure: Measure,
  look: TableLook,
): number[] {
  const whole = sum(widths) + CELL.gapX * Math.max(0, widths.length - 1);
  const rowOf = (cells: readonly string[], role: Role, spans: readonly number[]): number => {
    const style = roleStyle(role, look);
    let tallest = style.lineHeight * size;
    for (const [column, words] of cells.entries()) {
      if (words === '') continue;
      const inner = spans[column]! - 2 * style.inline * size;
      const measured = measure(text({ ...cellText(words, role, size, look), box: { w: inner } }));
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

/**
 * The most lines the title may take (TYTO-775). A title the author broke into lines keeps
 * exactly those: each must fit whole, and the size comes down until it does. One left
 * unbroken may wrap to `TITLE.maxLines`. When even the floor cannot fit a line whole, it is
 * drawn at the floor and wraps.
 */
export function titleLineLimit(title: readonly string[]): number {
  return title.length > 1 ? title.length : TITLE.maxLines;
}

/** The largest title size up to its share of `size` that sets in {@link titleLineLimit} lines. */
export function titleSizeFor(
  title: readonly string[],
  size: number,
  width: number,
  measure: Measure,
  look: TableLook,
): number {
  const ceiling = Math.max(
    look.titleFloor,
    Math.min(look.titleCeiling, Math.floor(TITLE.perBody * size)),
  );
  let low = look.titleFloor;
  let high = ceiling;
  let best = look.titleFloor;
  const limit = titleLineLimit(title);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const measured = measureTitle(title, middle, width, measure, look);
    if (measured === undefined || measured.lines <= limit) {
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
  look: TableLook,
): number {
  if (title.length === 0) return 0;
  const measured = measureTitle(title, size, width, measure, look);
  return measured?.height ?? titleLineLimit(title) * TITLE.lineHeight * size;
}

/** When nothing can measure: equal columns, the approved art's sizes, and guessed heights. */
function unmeasuredPlan(
  table: TableContent,
  title: readonly string[],
  width: number,
  look: TableLook,
): TablePlan {
  const columns = Math.max(1, table.header.length);
  const size = UNMEASURED.body;
  const column = (width - CELL.gapX * (columns - 1)) / columns;
  const line = (role: Role) => {
    const style = roleStyle(role, look);
    return style.lineHeight * size + 2 * style.block * size;
  };
  const heights = [
    line('header'),
    ...table.rows.map((row) => line(row.kind === 'cells' ? 'cell' : 'band')),
  ];
  const titleHeight = title.length === 0 ? 0 : title.length * TITLE.lineHeight * UNMEASURED.title;
  const noteSize = noteSizeFor(size);
  const notes =
    table.notes.length === 0
      ? { noteSize, notesHeight: 0, notesGap: 0 }
      : {
          noteSize,
          notesHeight: table.notes.length * NOTE.lineHeight * noteSize,
          notesGap: NOTE.gap * size,
        };
  return {
    size,
    title: UNMEASURED.title,
    titleHeight,
    widths: table.header.map(() => column),
    heights,
    ...notes,
    height:
      titleHeight +
      look.titleGap +
      sum(heights) +
      CELL.gapY * Math.max(0, heights.length - 1) +
      notes.notesGap +
      notes.notesHeight,
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
  look: TableLook,
): TablePlan {
  const size = look.bodyFloor;
  const total = sum(demand.min);
  const widths = demand.min.map((value) =>
    total === 0 ? room / demand.min.length : (room * value) / total,
  );
  const heights = rowHeights(table, glued, widths, size, measure, look);
  const titleHeight = titleHeightAt(title, look.titleFloor, width, measure, look);
  const notes = notesAt(table.notes, size, width, measure, look);
  return {
    size,
    title: look.titleFloor,
    titleHeight,
    widths,
    heights,
    ...notes,
    height:
      titleHeight +
      look.titleGap +
      sum(heights) +
      CELL.gapY * Math.max(0, heights.length - 1) +
      notes.notesGap +
      notes.notesHeight,
    unmeasured: false,
  };
}

/* -------------------------------------------------------------------------- notes -- */

function noteSizeFor(size: number): number {
  return Math.max(NOTE.floor, Math.round(NOTE.perBody * size * 2) / 2);
}

/** The notes as a text node's options: one line per note as written, set left, in ink. */
function notesText(notes: readonly string[], size: number, look: TableLook) {
  const style = { font: FACE, size, weight: BOOK, color: look.ink };
  const [first = '', ...rest] = notes;
  return {
    name: 'notes',
    runs: [
      run(first, style),
      ...rest.flatMap((line) => [lineBreak(), run(line, style)]),
    ] as NonEmpty<TextRun>,
    align: 'left' as const,
    lineHeight: NOTE.lineHeight,
  };
}

/** The notes' size, height and gap at a body size: all nothing when there are no notes. */
function notesAt(
  notes: readonly string[],
  size: number,
  width: number,
  measure: Measure,
  look: TableLook,
): { noteSize: number; notesHeight: number; notesGap: number } {
  const noteSize = noteSizeFor(size);
  if (notes.length === 0) return { noteSize, notesHeight: 0, notesGap: 0 };
  const measured = measure(text({ ...notesText(notes, noteSize, look), box: { w: width } }));
  return {
    noteSize,
    notesHeight: measured?.height ?? notes.length * NOTE.lineHeight * noteSize,
    notesGap: NOTE.gap * size,
  };
}

function drawNotes(
  notes: readonly string[],
  plan: TablePlan,
  width: number,
  look: TableLook,
): Block | undefined {
  if (notes.length === 0) return undefined;
  const node = text({
    ...notesText(notes, plan.noteSize, look),
    box: { w: width, h: plan.notesHeight },
    ...(plan.unmeasured ? { overflow: 'shrink' as const } : {}),
  });
  return block(width, plan.notesHeight, group({ name: 'notes', children: [node] }));
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
function measureTitle(
  title: readonly string[],
  size: number,
  width: number,
  measure: Measure,
  look: TableLook,
) {
  return measure(titleNode(title, size, width - 2 * TITLE.inset, look.ink));
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
function drawTable(
  table: TableContent,
  glued: GluedTable,
  plan: TablePlan,
  accent: string,
  look: TableLook,
): Block {
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
    const style = roleStyle(role, look);
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
        // Lowered by trimming the box's top twice the drop, so the centre moves by the drop and
        // the box stays inside the cell; the block padding is far wider than the trim.
        const padX = style.inline * plan.size;
        const trim = 2 * look.opticalDrop * plan.size;
        cellNodes.push(
          text({
            ...cellText(words, role, plan.size, look),
            name: 'cell-text',
            box: { w: span - 2 * padX, h: height - trim },
            align: 'center',
            valign: 'middle',
            ...(plan.unmeasured ? { overflow: 'shrink' as const } : {}),
            transform: { x: x + padX, y: y + trim },
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
        striped % 2 === 0 ? look.zebra : undefined,
        height,
      );
      striped += 1;
    }
    y += height + CELL.gapY;
  }

  const height = Math.max(0, y - CELL.gapY);
  return block(whole, height, group({ name: 'table', children }));
}

/** The signature, centred and tracked out, standing on the foot of its row. */
function drawSignature(kit: BrandKit, width: number, look: TableLook): Block {
  const words = text({
    name: 'signature',
    runs: [
      run(signatureOf(kit), {
        font: FACE,
        size: SIGNATURE.size,
        weight: BOOK,
        color: look.signatureInk,
      }),
    ],
    box: { w: width, h: SIGNATURE.height },
    align: 'center',
    valign: 'bottom',
    letterSpacing: SIGNATURE.tracking * SIGNATURE.size,
  });
  return block(width, SIGNATURE.height, group({ name: 'sign-off', children: [words] }));
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
