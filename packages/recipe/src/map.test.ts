import { describe, expect, it } from 'vitest';

import { FLOWS, tasks } from './__fixtures__/flows.js';
import { columnOf, runOverShop } from './__fixtures__/rules-harness.js';
import type { CellValue } from './table.js';

const FILES = { './flows.json': FLOWS };

/** The column `into=` wrote, in row order, after running the lines over one column's values. */
async function mapped(
  lines: readonly string[],
  values: readonly CellValue[],
  into = 'mapped',
): Promise<readonly CellValue[]> {
  const input = tasks(
    ['status'],
    values.map((value) => [value]),
  );
  const { table, problem } = await runOverShop(lines, FILES, input);
  expect(problem).toBeUndefined();
  return Object.values(columnOf(table, into));
}

async function refusal(line: string): Promise<readonly (string | undefined)[]> {
  const { problem, at } = await runOverShop([line], FILES, tasks(['status'], [['todo']]));
  return [problem?.code, at];
}

describe('map', () => {
  it('maps a sheet status to the tracker status, as the table spells it', async () => {
    const line = 'map status using=@./flows.json#/first/map into=mapped';
    expect(await mapped([line], ['review', 'done', 'todo'])).toEqual(['DOING 2', 'DONE', 'TO DO']);
  });

  it('compares without accents, case or surrounding blanks', async () => {
    const line = 'map status using=@./flows.json#/second/map reverse into=mapped';
    expect(await mapped([line], ['approval', ' Approvál ', 'FINISHED'])).toEqual([
      'approval',
      'approval',
      'done',
    ]);
  });

  // Buraqueira: test_inverso_traduz_o_que_esta_no_de_para
  it('translates back what the table maps to, and what also= adds', async () => {
    const first =
      'map status using=@./flows.json#/first/map reverse also=@./flows.json#/first/also into=mapped';
    expect(await mapped([first], ['DOING', 'DOING 2', 'FINISHED'])).toEqual([
      'doing',
      'review',
      'done',
    ]);
    const second = 'map status using=@./flows.json#/second/map reverse into=mapped';
    expect(await mapped([second], ['APPROVÁL'])).toEqual(['approval']);
  });

  // Buraqueira: test_intermediario_nao_muda_a_planilha
  it('maps a status between the ones the table names to nothing', async () => {
    const line = 'map status using=@./flows.json#/second/map reverse into=mapped';
    expect(await mapped([line], ['APPROVED', 'WAITING', 'Backlog', null, ''])).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('keeps the first key in file order when two share a value, reading back', async () => {
    const { table } = await runOverShop(
      ['map status using=@./shared.json reverse into=mapped'],
      { './shared.json': { doing: 'DOING', review: 'doing', done: 'DONE' } },
      tasks(['status'], [['Doing']]),
    );
    expect(columnOf(table, 'mapped')).toEqual({ 'T-0': 'doing' });
  });

  it('reads also= only after the table', async () => {
    const { table } = await runOverShop(
      ['map status using=@./a.json also=@./b.json into=mapped'],
      { './a.json': { x: 'from a' }, './b.json': { x: 'from b', y: 'from b' } },
      tasks(['status'], [['x'], ['y']]),
    );
    expect(columnOf(table, 'mapped')).toEqual({ 'T-0': 'from a', 'T-1': 'from b' });
  });

  it('reads a table written inline as the last argument', async () => {
    const line = 'map status into=mapped using={"todo": "TO DO", "doing": "IN PROGRESS"}';
    expect(await mapped([line], ['doing', 'todo', 'done'])).toEqual(['IN PROGRESS', 'TO DO', null]);
  });

  it('adds a text column, and recomputes one the table has in its place', async () => {
    const { table } = await runOverShop(
      ['map status using=@./flows.json#/first/map into=Status'],
      FILES,
      tasks(['status', 'note'], [['todo', 'x']]),
    );
    expect(table?.columns.map(({ name, type, origin }) => [name, type, origin])).toEqual([
      ['key', 'text', 'test'],
      ['status', 'text', 'map'],
      ['note', 'text', 'test'],
    ]);
    expect(columnOf(table, 'status')).toEqual({ 'T-0': 'TO DO' });
  });

  describe('refuses', () => {
    it('a word other than reverse', async () => {
      expect(await refusal('map status backwards using=@./flows.json#/first/map into=x')).toEqual([
        'E_RECIPE_ARGUMENTS',
        'backwards',
      ]);
    });

    it('an argument it does not take', async () => {
      expect(await refusal('map status using=@./flows.json#/first/map into=x by=y')).toEqual([
        'E_RECIPE_ARGUMENTS',
        'by=y',
      ]);
    });

    it('an argument given twice', async () => {
      expect(await refusal('map status into=y using=@./flows.json#/first/map into=x')).toEqual([
        'E_RECIPE_ARGUMENTS',
        'into=x',
      ]);
    });

    it('a missing column, using= or into=', async () => {
      for (const line of [
        'map using=@./flows.json#/first/map into=x',
        'map status into=x',
        'map status using=@./flows.json#/first/map',
      ]) {
        const { problem } = await runOverShop([line], FILES, tasks(['status'], [['todo']]));
        expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
        expect(problem?.message).toContain('takes one column, using=');
      }
    });

    it('an also= that is not a data reference', async () => {
      expect(await refusal('map status also=x using=@./flows.json#/first/map into=mapped')).toEqual(
        ['E_RECIPE_ARGUMENTS', 'also=x'],
      );
    });

    it('a column the table lacks', async () => {
      const [code] = await refusal('map phase using=@./flows.json#/first/map into=x');
      expect(code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    });

    it('a table that is not text to text, in a file or inline', async () => {
      const [fromFile] = await refusal('map status using=@./flows.json#/first/graph into=x');
      expect(fromFile).toBe('E_RECIPE_DATA_SHAPE');
      const { problem, at } = await runOverShop(
        ['map status into=x using={"todo": 1}'],
        FILES,
        tasks(['status'], [['todo']]),
      );
      expect([problem?.code, at]).toEqual(['E_RECIPE_ARGUMENTS', 'using={"todo":']);
      expect(problem?.message).toContain('using= inline');
      const broken = await refusal('map status into=x using={"todo": ');
      expect(broken[0]).toBe('E_RECIPE_ARGUMENTS');
    });
  });
});
