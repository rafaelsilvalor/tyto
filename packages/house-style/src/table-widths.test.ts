import { describe, expect, it } from 'vitest';

import { pieces } from './breaks.js';
import { columnWidths } from './table.js';
import { glue } from './table-text.js';
import { BODY, REFERENCE_SIZE } from './table-tokens.js';

import type { CellPieces, Demand } from './table.js';

/**
 * How the table shares its width between columns (TYTO-775): by reading every cell of a
 * column, not its single widest one.
 *
 * Widths here are a monospace stand-in — every character 50 units at the reference size, a
 * space 25 — so a case reads as its characters. The search only shares width out; the
 * heights a real table keeps are measured by the layout afterwards.
 */

const CHARACTER = 50;
const SPACE = 25;

/** A table's demand from its header and rows, as `table.ts` builds it from measurements. */
function demandOf(header: readonly string[], rows: readonly (readonly string[])[]): Demand {
  const min = header.map(() => 0);
  const natural = header.map(() => 0);
  const cells: CellPieces[][] = header.map(() => []);
  const take = (words: string, role: 'cell' | 'header', column: number, row: number) => {
    const lines: number[][] = [];
    for (const line of glue(words).split('\n')) {
      natural[column] = Math.max(natural[column]!, [...line].length * CHARACTER);
      const widths = pieces(line).map((piece) => [...piece].length * CHARACTER);
      for (const width of widths) min[column] = Math.max(min[column]!, width);
      if (widths.length > 0) lines.push(widths);
    }
    cells[column]!.push({ row, role, lines });
  };
  header.forEach((words, column) => take(words, 'header', column, 0));
  rows.forEach((row, index) =>
    row.forEach((words, column) => take(words, 'cell', column, index + 1)),
  );
  return { min, natural, cells, space: { cell: SPACE, header: SPACE } };
}

/** The lines each cell takes at these widths, breaking greedily at a space as the layout does. */
function linesAt(demand: Demand, widths: readonly number[], size: number): number[][] {
  const scale = size / REFERENCE_SIZE;
  return demand.cells.map((cells, column) =>
    cells.map((cell) => {
      const inner = (widths[column]! - 2 * BODY.padding.inline * size) / scale;
      let count = 0;
      for (const line of cell.lines) {
        count += 1;
        let used = -1;
        for (const piece of line) {
          if (used < 0) used = piece;
          else if (used + SPACE + piece <= inner) used += SPACE + piece;
          else {
            count += 1;
            used = piece;
          }
        }
      }
      return count;
    }),
  );
}

/** The table's height in lines: each row as tall as its most-wrapped cell. */
function rowLines(demand: Demand, widths: readonly number[], size: number): number {
  const lines = linesAt(demand, widths, size);
  const rows = new Map<number, number>();
  demand.cells.forEach((cells, column) =>
    cells.forEach((cell, index) =>
      rows.set(cell.row, Math.max(rows.get(cell.row) ?? 0, lines[column]![index]!)),
    ),
  );
  return [...rows.values()].reduce((total, value) => total + value, 0);
}

/** The rule this replaced: the leftover in proportion to `natural − min`. The control. */
function proportional(demand: Demand, size: number, room: number): number[] {
  const scale = size / REFERENCE_SIZE;
  const padding = 2 * BODY.padding.inline * size;
  const min = demand.min.map((value) => Math.ceil(value * scale + padding) + 1);
  const natural = demand.natural.map((value, column) =>
    Math.max(min[column]!, Math.ceil(value * scale + padding) + 1),
  );
  const leftover = room - min.reduce((a, b) => a + b, 0);
  const wants = natural.map((value, column) => value - min[column]!);
  const wanted = wants.reduce((a, b) => a + b, 0);
  return min.map((value, column) => value + (leftover * wants[column]!) / wanted);
}

/** The table of the request that asked for this: one long cell in `Vagas previstas`. */
const EDUCATION = demandOf(
  ['Concurso', 'Status', 'Vagas previstas', 'Salários previstos'],
  [
    [
      'SEDF (DF)',
      'Banca contratada — Quadrix',
      '10.604 (2.650 imediatas + 7.954 CR)',
      'R$ 4.037,17 a R$ 6.749,10',
    ],
    ['SEDUC AM', 'Banca contratada — Cesgranrio', '7.862', 'R$ 1.525,06 a R$ 4.143,06*'],
    ['SEE SP', 'Banca definida — FGV; comissão formada', '5.000', 'R$ 3.125,00 a R$ 5.000,00'],
    ['SEDUC MA', 'Banca definida — FCC', '2.300', 'R$ 3.625,25 a R$ 10.755,32'],
  ],
);

/** A size where the rule this replaced wraps the table to 13 lines and this one to 10. */
const SIZE = 26;
const ROOM = 934;

describe('sharing the width between columns', () => {
  it('gives the room to the column whose cells set the heights, not to one long cell', () => {
    const widths = columnWidths(EDUCATION, SIZE, ROOM)!;
    const before = proportional(EDUCATION, SIZE, ROOM);

    // Status, every cell of which wraps, gets wider; Vagas, one long cell in a row Status
    // holds tall anyway, gets narrower.
    expect(widths[1]!).toBeGreaterThan(before[1]!);
    expect(widths[2]!).toBeLessThan(before[2]!);
    expect(rowLines(EDUCATION, widths, SIZE)).toBeLessThan(rowLines(EDUCATION, before, SIZE));
  });

  it('never wraps the table to more lines than the rule it replaced, at any size', () => {
    const sizes = Array.from({ length: 17 }, (_, index) => 18 + index);
    const compared = sizes.flatMap((size) => {
      const widths = columnWidths(EDUCATION, size, ROOM);
      if (widths === undefined) return [];
      const before = proportional(EDUCATION, size, ROOM);
      return [{ after: rowLines(EDUCATION, widths, size), was: rowLines(EDUCATION, before, size) }];
    });

    expect(compared.length).toBeGreaterThan(10);
    for (const { after, was } of compared) expect(after).toBeLessThanOrEqual(was);
  });

  it('uses the whole room and never goes below a column’s minimum', () => {
    const widths = columnWidths(EDUCATION, SIZE, ROOM)!;
    const padding = 2 * BODY.padding.inline * SIZE;
    const scale = SIZE / REFERENCE_SIZE;

    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(ROOM, 6);
    widths.forEach((width, column) =>
      expect(width).toBeGreaterThanOrEqual(EDUCATION.min[column]! * scale + padding),
    );
  });

  it('still shares the leftover equally when every column fits on one line', () => {
    const small = demandOf(['A', 'B'], [['um', 'dois']]);
    const widths = columnWidths(small, SIZE, ROOM)!;

    expect(widths[0]! - widths[1]!).toBeCloseTo(
      Math.ceil(small.natural[0]! * (SIZE / REFERENCE_SIZE) + BODY.padding.inline * 2 * SIZE) -
        Math.ceil(small.natural[1]! * (SIZE / REFERENCE_SIZE) + BODY.padding.inline * 2 * SIZE),
      6,
    );
  });

  it('fails a size whose minimums do not fit across', () => {
    expect(columnWidths(EDUCATION, SIZE, 300)).toBeUndefined();
  });

  it('counts a line the author broke by hand as a line the cell always has', () => {
    const typed = demandOf(['A', 'B'], [['Banca contratada\nQuadrix', 'x']]);

    expect(typed.cells[0]![1]!.lines).toHaveLength(2);
    expect(linesAt(typed, columnWidths(typed, SIZE, ROOM)!, SIZE)[0]![1]).toBe(2);
  });
});
