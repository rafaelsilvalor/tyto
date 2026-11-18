import { describe, expect, it } from 'vitest';

import { NO_BREAK_SPACE, pieces } from './breaks.js';
import { glue, readTable } from './table-text.js';

import type { Inline, RichText } from '@tyto/core';

let cursor = 0;

/** Rich text from a string, `\n` becoming the `Break` between two lines of a block. */
function rich(source: string): RichText {
  const parts: Inline[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) parts.push({ kind: 'break', range: { start: cursor, end: cursor++ } });
    const start = cursor;
    cursor += line.length;
    parts.push({ kind: 'text', value: line, range: { start, end: cursor } });
  }
  return parts;
}

/** The glued cell with its no-break spaces written as `~`, so a case reads at a glance. */
const shown = (cell: string): string => glue(cell).replaceAll(NO_BREAK_SPACE, '~');

describe('reading the table a brief wrote', () => {
  it('takes the header from the first line and the column count from it', () => {
    const table = readTable(rich('Concurso | Banca | Vagas\nGM VR | Alfabeta | 1.315'));

    expect(table.header).toEqual(['Concurso', 'Banca', 'Vagas']);
    expect(table.rows).toEqual([{ kind: 'cells', cells: ['GM VR', 'Alfabeta', '1.315'] }]);
  });

  it('pads a short row and keeps a long row’s extra separators in its last cell', () => {
    const table = readTable(rich('A | B | C\none | two\nx | y | z | w'));

    expect(table.rows).toEqual([
      { kind: 'cells', cells: ['one', 'two', ''] },
      { kind: 'cells', cells: ['x', 'y', 'z | w'] },
    ]);
  });

  it('reads a line with no separator as a band across the table', () => {
    const table = readTable(rich('A | B\nNível superior\nx | y'));

    expect(table.rows[0]).toEqual({ kind: 'band', text: 'Nível superior' });
  });

  it('reads a line with no separator that starts with * as a note, not a band', () => {
    const table = readTable(rich('A | B\nx | y*\n*Valores do último edital.\nNível superior'));

    expect(table.notes).toEqual(['*Valores do último edital.']);
    expect(table.rows).toEqual([
      { kind: 'cells', cells: ['x', 'y*'] },
      { kind: 'band', text: 'Nível superior' },
    ]);
  });

  it('keeps a typed break inside its cell and the row going after it', () => {
    const text: RichText = [
      ...rich('A | B | C\nBanca contratada'),
      { kind: 'break', typed: true, range: { start: cursor, end: ++cursor } },
      ...rich('Quadrix | 7.862 | R$ 1,00'),
    ];
    const table = readTable(text);

    expect(table.rows).toEqual([
      { kind: 'cells', cells: ['Banca contratada\nQuadrix', '7.862', 'R$ 1,00'] },
    ]);
  });
});

describe('where a cell may break', () => {
  it.each([
    ['R$ 33.820,39', 'R$~33.820,39'],
    ['R$ 5.667,92 a R$ 13.560,00', 'R$~5.667,92~a R$~13.560,00'],
    ['R$ 17.687,12 e R$ 39.877,31', 'R$~17.687,12~e R$~39.877,31'],
    ['R$ 24.102,21 a R$ 33.820,39 (bruto)', 'R$~24.102,21~a R$~33.820,39~(bruto)'],
    ['5 + CR', '5~+~CR'],
    ['200 + CR', '200~+~CR'],
    ['5 mil', '5~mil'],
    ['10 %', '10~%'],
  ])('glues %s', (cell, expected) => {
    expect(shown(cell)).toBe(expected);
  });

  it.each([
    'Banca definida (Ômegas)',
    'Grupo de Trabalho Formado',
    'Conselho das Marinhas',
    'Guarda Fluvial VX',
  ])('leaves the words of %s free to break', (cell) => {
    expect(glue(cell)).toBe(cell);
  });

  it('does not glue a connector that is a word, not a range', () => {
    // "e" between two words is prose; only a value before and after makes a range.
    expect(shown('Analista e Técnico')).toBe('Analista e Técnico');
  });

  it('leaves a long parenthesised phrase free to break, and glues a short one', () => {
    expect(shown('10.604 (2.650 imediatas + 7.954 CR)')).toBe(
      '10.604 (2.650 imediatas~+~7.954~CR)',
    );
    expect(shown('1.000 (nível superior)')).toBe('1.000~(nível~superior)');
  });

  it('keeps a dash with the word before it', () => {
    expect(shown('Banca contratada — Quadrix')).toBe('Banca contratada~— Quadrix');
  });

  it('glues each line of a cell the author broke on its own', () => {
    expect(shown('R$ 1,00\nR$ 2,00')).toBe('R$~1,00\nR$~2,00');
  });

  it('breaks a range into its two values and nowhere else', () => {
    expect(pieces(glue('R$ 9.776,74 a R$ 18.380,18'))).toEqual([
      `R$${NO_BREAK_SPACE}9.776,74${NO_BREAK_SPACE}a`,
      `R$${NO_BREAK_SPACE}18.380,18`,
    ]);
  });
});
