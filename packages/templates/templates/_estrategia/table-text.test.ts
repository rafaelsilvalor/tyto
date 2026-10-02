import { describe, expect, it } from 'vitest';

import { NO_BREAK_SPACE, glue, pieces, readTable } from './table-text.js';

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
    const table = readTable(rich('Concurso | Banca | Vagas\nPC PE | Cebraspe | 1.315'));

    expect(table.header).toEqual(['Concurso', 'Banca', 'Vagas']);
    expect(table.rows).toEqual([{ kind: 'cells', cells: ['PC PE', 'Cebraspe', '1.315'] }]);
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
    'Banca definida (Vunesp)',
    'Grupo de Trabalho Formado',
    'Câmara dos Deputados',
    'Polícia Penal PE',
  ])('leaves the words of %s free to break', (cell) => {
    expect(glue(cell)).toBe(cell);
  });

  it('does not glue a connector that is a word, not a range', () => {
    // "e" between two words is prose; only a value before and after makes a range.
    expect(shown('Analista e Técnico')).toBe('Analista e Técnico');
  });

  it('breaks a range into its two values and nowhere else', () => {
    expect(pieces(glue('R$ 9.776,74 a R$ 18.380,18'))).toEqual([
      `R$${NO_BREAK_SPACE}9.776,74${NO_BREAK_SPACE}a`,
      `R$${NO_BREAK_SPACE}18.380,18`,
    ]);
  });
});
