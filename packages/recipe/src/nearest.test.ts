import { describe, expect, it } from 'vitest';

import { columnOf, runOverShop } from './__fixtures__/rules-harness.js';
import { wordsOf } from './nearest.js';
import type { CellValue, Table } from './table.js';

/**
 * A neutral print shop's tasks: design tasks and the copy tasks that hold their text, grouped
 * under a parent, shaped like the rows the private plugin paired by title (TYTO-391).
 */
const ROWS: readonly (readonly [string, string | null, string, string, string | null])[] = [
  ['A-1', 'P1', 'design', 'Poster Spring Fair', null],
  ['A-2', 'P1', 'copy', 'Copy for the poster Spring Fair', 'https://files.example.com/2'],
  ['A-3', 'P1', 'copy', 'Copy for the banner Summer Sale', 'https://files.example.com/3'],
  ['A-4', 'P1', 'design', 'Banner Summer Sale', null],
  ['A-5', 'P2', 'design', 'Flyer Autumn', null],
  ['A-6', 'P2', 'copy', 'Text for a leaflet', 'https://files.example.com/6'],
  ['A-7', 'P3', 'design', 'Poster Winter', null],
  ['A-8', 'P3', 'copy', 'Brochure Rain', 'https://files.example.com/8'],
  ['A-9', 'P3', 'copy', 'Brochure Snow', 'https://files.example.com/9'],
  ['A-10', null, 'design', 'Poster Spring Fair', null],
  ['A-11', 'P4', 'design', 'Poster Night Market', null],
  ['A-12', 'P4', 'copy', 'Poster Day', 'https://files.example.com/12'],
  ['A-13', 'P4', 'copy', 'Market Stall', 'https://files.example.com/13'],
  ['A-14', 'P5', 'design', 'The poster for kids', null],
  ['A-15', 'P5', 'copy', 'The flyer for adults', 'https://files.example.com/15'],
  ['A-16', 'P5', 'copy', 'Kids corner', 'https://files.example.com/16'],
  ['A-17', 'P6', 'design', 'Go big', null],
  ['A-18', 'P6', 'copy', 'Go home', 'https://files.example.com/18'],
  ['A-19', 'P6', 'copy', 'Big day', 'https://files.example.com/19'],
];

const TASKS: Table = {
  columns: [
    { name: 'key', type: 'text', origin: 'test' },
    { name: 'parent', type: 'text', origin: 'test' },
    { name: 'team', type: 'text', origin: 'test' },
    { name: 'title', type: 'text', origin: 'test' },
    { name: 'folder', type: 'link', origin: 'test' },
  ],
  rows: ROWS.map(([key, parent, team, title, folder]) => ({
    key,
    values: { key, parent, team, title, folder } satisfies Record<string, CellValue>,
    provenance: { source: 'test', id: key, fetchedAt: '2026-10-25' },
  })),
};

const FILES = { './shop.json': { stopwords: ['The', 'for'] } };
const COPY = 'among="team = copy" by=words(title)';
const NEAREST = `nearest copy within=parent ${COPY} stopwords=the,for bring=key`;

function run(lines: readonly string[], files: Record<string, unknown> = FILES) {
  return runOverShop(lines, files, TASKS);
}

async function chosen(line: string): Promise<Record<string, CellValue>> {
  const { table, problem } = await run([line]);
  expect(problem).toBeUndefined();
  return columnOf(table, 'copy_key');
}

describe('nearest', () => {
  it('chooses the candidate sharing the most words', async () => {
    const copy = await chosen(NEAREST);
    expect([copy['A-1'], copy['A-4']]).toEqual(['A-2', 'A-3']);
  });

  it('chooses a single candidate whatever its words', async () => {
    expect((await chosen(NEAREST))['A-5']).toBe('A-6');
  });

  it('keeps the first in table order on a tie', async () => {
    expect((await chosen(NEAREST))['A-11']).toBe('A-12');
  });

  it('chooses none when no candidate shares a word, though another group would', async () => {
    expect((await chosen(NEAREST))['A-7']).toBeNull();
  });

  it('never chooses the row itself', async () => {
    const copy = await chosen(NEAREST);
    expect([copy['A-2'], copy['A-3'], copy['A-6']]).toEqual(['A-3', 'A-2', null]);
  });

  it('gives a row with an empty group no candidate', async () => {
    expect((await chosen(NEAREST))['A-10']).toBeNull();
  });

  it('draws the candidates among the rows the expression keeps', async () => {
    const copy = await chosen(
      'nearest copy within=parent among="team = design" by=words(title) stopwords=the bring=key',
    );
    expect([copy['A-1'], copy['A-2'], copy['A-3']]).toEqual(['A-4', 'A-1', 'A-4']);
  });

  it('drops the stopwords, written inline or read from a data file, in any case', async () => {
    expect((await chosen(NEAREST))['A-14']).toBe('A-16');
    const fromFile = await chosen(
      `nearest copy within=parent ${COPY} stopwords=@./shop.json#/stopwords bring=key`,
    );
    expect(fromFile['A-14']).toBe('A-16');
    const without = await chosen(`nearest copy within=parent ${COPY} stopwords=none bring=key`);
    expect(without['A-14']).toBe('A-15');
  });

  it('drops words shorter than min-length, two letters by default', async () => {
    expect((await chosen(NEAREST))['A-17']).toBe('A-18');
    const longer = await chosen(`${NEAREST} min-length=3`);
    expect(longer['A-17']).toBe('A-19');
  });

  it('brings each column named under the prefix, with its type, and keeps every row', async () => {
    const { table } = await run([
      `nearest copy within=parent ${COPY} stopwords=the,for bring=key,folder`,
    ]);
    expect(table?.rows).toHaveLength(ROWS.length);
    expect(table?.columns.slice(-2)).toEqual([
      { name: 'copy_key', type: 'text', origin: 'nearest copy' },
      { name: 'copy_folder', type: 'link', origin: 'nearest copy' },
    ]);
    expect(columnOf(table, 'copy_folder')['A-1']).toBe('https://files.example.com/2');
    expect(columnOf(table, 'copy_folder')['A-7']).toBeNull();
  });

  it('reads the words of a cell in lower case, by code point, with no accent folded', () => {
    expect([...wordsOf('Ação é acao, ok_1 — Ação!', new Set(['ok_1']), 2)]).toEqual([
      'ação',
      'acao',
    ]);
    expect([...wordsOf(null, new Set(), 2)]).toEqual([]);
  });

  describe('refuses', () => {
    async function refusal(line: string) {
      const { problem, at } = await run([line]);
      return [problem?.code, at];
    }

    it('a by= other than words(<column>)', async () => {
      const [code, at] = await refusal(
        'nearest copy within=parent among="team = copy" by=title stopwords=the bring=key',
      );
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'by=title']);
    });

    it('a prefix whose columns the table already has', async () => {
      const { problem, at } = await run([NEAREST, NEAREST]);
      expect([problem?.code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'copy']);
      expect(problem?.message).toContain('copy_key');
    });

    it('an argument given twice', async () => {
      const [code, at] = await refusal(`${NEAREST} within=team`);
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'within=team']);
    });

    it('an argument it does not take', async () => {
      const [code, at] = await refusal(`${NEAREST} near=3`);
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'near=3']);
    });

    it('a missing argument, naming it', async () => {
      const { problem } = await run([`nearest copy within=parent ${COPY} bring=key`]);
      expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
      expect(problem?.message).toContain('needs stopwords=');
    });

    it('a min-length that is not a whole number', async () => {
      const [code, at] = await refusal(`${NEAREST} min-length=two`);
      expect([code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'min-length=two']);
    });

    it('a column the table lacks', async () => {
      const [code] = await refusal(
        `nearest copy within=parent ${COPY} stopwords=the bring=key,notes`,
      );
      expect(code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    });

    it('a stopword list of the wrong shape in a file', async () => {
      const [code] = await refusal(
        `nearest copy within=parent ${COPY} stopwords=@./shop.json bring=key`,
      );
      expect(code).toBe('E_RECIPE_DATA_SHAPE');
    });
  });
});
