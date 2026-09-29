import { describe, expect, it } from 'vitest';

import { bold, rich, span } from './rich-text.fixture.js';
import { fields, lines, plain, rowGroups } from './rows.js';

import type { RichText } from '@tyto/core';

/**
 * Reading one slot as a small table. The first five cases came with the code from
 * `agenda-semana` (TYTO-173); `rowGroups` is what TYTO-185 added so a table component can
 * read any slot the same way.
 */

describe('lines and fields', () => {
  it('keeps a line with no separator whole, which is how a heading is told apart', () => {
    const [heading, session] = lines(
      rich('FARMÁCIA\n16/09 - 14:00 | Farmacologia | Profª. Marcela'),
    );

    expect(fields(heading ?? [])).toHaveLength(1);
    expect(fields(session ?? []).length).toBeGreaterThan(1);
  });

  it('drops a blank line rather than reading it as a row with no fields', () => {
    expect(lines(rich('Pediatria\n\n27/09 | Febre | Dra. Lúcia'))).toHaveLength(2);
  });

  it('splits a line into fields, without the spaces around the bars', () => {
    const [line] = lines(rich('22/09 | Insuficiência cardíaca | Dra. Helena Prado'));

    expect(fields(line ?? [], 3).map(plain)).toEqual([
      '22/09',
      'Insuficiência cardíaca',
      'Dra. Helena Prado',
    ]);
  });

  it('leaves a bar in the last field, because the limit stops the split and not the text', () => {
    const [line] = lines(rich('22/09 | Revisão | Dra. Helena | Dr. Vitor'));

    expect(fields(line ?? [], 3).map(plain)).toEqual([
      '22/09',
      'Revisão',
      'Dra. Helena | Dr. Vitor',
    ]);
  });

  it('never splits inside emphasis, where a bar is the author doing something else', () => {
    const line: RichText = [span('22/09 | '), bold('Revisão | final'), span(' | Dra. Helena')];

    expect(fields(line, 3).map(plain)).toEqual(['22/09', 'Revisão | final', 'Dra. Helena']);
  });
});

describe('rowGroups', () => {
  const shape = (text: RichText, count: number, grouped: boolean) =>
    rowGroups(text, count, grouped).map((group) => ({
      heading: plain(group.heading),
      rows: group.rows.map((row) => row.map(plain)),
    }));

  it('starts a group at each line with no separator, when grouped', () => {
    expect(shape(rich('A\n1 | um\nB\n2 | dois\n3 | três'), 2, true)).toEqual([
      { heading: 'A', rows: [['1', 'um']] },
      {
        heading: 'B',
        rows: [
          ['2', 'dois'],
          ['3', 'três'],
        ],
      },
    ]);
  });

  it('keeps rows written before any heading, under an empty one', () => {
    expect(shape(rich('1 | solto\nA\n2 | um'), 2, true)).toEqual([
      { heading: '', rows: [['1', 'solto']] },
      { heading: 'A', rows: [['2', 'um']] },
    ]);
  });

  it('reads every line as a row when not grouped, separator or not', () => {
    expect(shape(rich('1º | Ana\nsem colocação\n43º | Bruno'), 2, false)).toEqual([
      { heading: '', rows: [['1º', 'Ana'], ['sem colocação'], ['43º', 'Bruno']] },
    ]);
  });

  it('reads a two-field heading when told to, and the one-field lines under it as rows', () => {
    const groups = rowGroups(
      rich('Domingo | às 8h\nSimulado A\nSimulado B\nSábado | às 9h\nC'),
      1,
      true,
      2,
    );

    expect(
      groups.map((group) => ({
        heading: plain(group.heading),
        rest: group.headingRest.map(plain),
        rows: group.rows.map((row) => row.map(plain)),
      })),
    ).toEqual([
      { heading: 'Domingo', rest: ['às 8h'], rows: [['Simulado A'], ['Simulado B']] },
      { heading: 'Sábado', rest: ['às 9h'], rows: [['C']] },
    ]);
  });

  it('leaves a one-field heading with nothing after it', () => {
    expect(rowGroups(rich('A\n1 | um'), 2, true)[0]?.headingRest).toEqual([]);
  });

  it('answers no groups for an empty slot', () => {
    expect(rowGroups([], 2, true)).toEqual([]);
  });
});
