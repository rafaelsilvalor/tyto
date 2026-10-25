import { describe, expect, it } from 'vitest';

import { VOCABULARY, columnOf, runOverShop } from './__fixtures__/rules-harness.js';

const KINDS = 'rules into=kind,label using=@./vocabulary.json#/kinds';

describe('rules', () => {
  it('classifies each row by the first entry it satisfies', async () => {
    const { table, problem } = await runOverShop([KINDS]);
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'kind')).toEqual({
      'RW-1073960': 'poster',
      'RW-2': 'site',
      'RW-3': 'other',
      'RW-4': 'copy',
    });
    // An entry that does not set a column leaves it empty, and null clears it on purpose.
    expect(columnOf(table, 'label')).toEqual({
      'RW-1073960': null,
      'RW-2': 'Site',
      'RW-3': null,
      'RW-4': null,
    });
    expect(table?.columns.slice(-2)).toEqual([
      { name: 'kind', type: 'text', origin: 'rules' },
      { name: 'label', type: 'text', origin: 'rules' },
    ]);
  });

  it('lets an earlier entry win over a later one the row also satisfies', async () => {
    const both = [
      { when: 'team = design', set: { kind: 'first' } },
      { when: 'title matches poster', set: { kind: 'second' } },
    ];
    const { table } = await runOverShop(['rules into=kind using=@./both.json'], {
      './both.json': both,
    });
    expect(columnOf(table, 'kind')).toMatchObject({ 'RW-1073960': 'first', 'RW-4': 'second' });
  });

  it('leaves every target empty for a row no entry matches when there is no default', async () => {
    const { table } = await runOverShop(['rules into=kind using=@./one.json'], {
      './one.json': [{ when: 'team = web', set: { kind: 'site' } }],
    });
    expect(columnOf(table, 'kind')).toEqual({
      'RW-1073960': null,
      'RW-2': 'site',
      'RW-3': null,
      'RW-4': null,
    });
  });

  it('fills a set value as a template from the row', async () => {
    const { table } = await runOverShop([
      KINDS,
      'rules into=first using=@./vocabulary.json#/first',
    ]);
    expect(columnOf(table, 'first')).toEqual({
      'RW-1073960': 'Póster Grande',
      'RW-2': 'Site',
      'RW-3': 'other',
      'RW-4': 'Póster Grande',
    });
  });

  it('compares numbers in a when expression', async () => {
    const points = [5, '3', 2, null, 'many'];
    const input = {
      columns: [
        { name: 'key', type: 'text' as const, origin: 'test' },
        { name: 'points', type: 'number' as const, origin: 'test' },
      ],
      rows: points.map((value, index) => ({
        key: `P-${String(index)}`,
        values: { key: `P-${String(index)}`, points: value },
        provenance: { source: 'test', id: `P-${String(index)}`, fetchedAt: '2026-10-25' },
      })),
    };
    const sizes = [
      { when: 'points >= 3', set: { size: 'big' } },
      { when: 'points<3', set: { size: 'small' } },
      { when: '', set: { size: 'unknown' } },
    ];
    const { table, problem } = await runOverShop(
      ['rules into=size using=@./sizes.json'],
      { './sizes.json': sizes },
      input,
    );
    expect(problem).toBeUndefined();
    expect(Object.values(columnOf(table, 'size'))).toEqual([
      'big',
      'big',
      'small',
      'unknown',
      'unknown',
    ]);
  });

  it('reads a table written inline as the last argument', async () => {
    const { table, problem } = await runOverShop([
      'rules into=kind using=[{"when": "team in (web, copy)", "set": {"kind": "words {team|upper}"}}, {"when": "", "set": {"kind": "art"}}]',
    ]);
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'kind')).toEqual({
      'RW-1073960': 'art',
      'RW-2': 'words WEB',
      'RW-3': 'art',
      'RW-4': 'words COPY',
    });
  });

  it('recomputes a column the table already has, in its place', async () => {
    const { table } = await runOverShop(['rules into=Team using=@./one.json'], {
      './one.json': [{ when: '', set: { team: 'all' } }],
    });
    expect(table?.columns.map((column) => column.name)).toEqual([
      'key',
      'title',
      'team',
      'format',
      'phase',
      'deliverable',
    ]);
    expect(new Set(Object.values(columnOf(table, 'team')))).toEqual(new Set(['all']));
  });

  describe('refuses before reading any row', () => {
    async function refusal(entries: unknown, line = 'rules into=kind using=@./bad.json') {
      const { problem, at } = await runOverShop([line], { './bad.json': entries });
      return { code: problem?.code, message: problem?.message, at };
    }

    it('a when the where grammar refuses, naming the entry', async () => {
      const found = await refusal([
        { when: 'team = design', set: { kind: 'a' } },
        { when: 'team = design OR team = web', set: { kind: 'b' } },
      ]);
      expect(found.code).toBe('E_RECIPE_WHERE');
      expect(found.message).toMatch(/^At '\/1\/when' of the rules table: Filter error: 'OR'/u);
      expect(found.at).toBe('using=@./bad.json');
    });

    it('a pattern the guard refuses, keeping its code', async () => {
      const found = await refusal([{ when: 'title matches "(a+)+"', set: { kind: 'a' } }]);
      expect(found.code).toBe('E_RECIPE_PATTERN_UNSAFE');
      expect(found.message).toContain("At '/0/when'");
    });

    it('a column the table lacks, in a when or in a set template', async () => {
      const inWhen = await refusal([{ when: 'colour = red', set: { kind: 'a' } }]);
      expect([inWhen.code, inWhen.message]).toEqual([
        'E_RECIPE_UNKNOWN_COLUMN',
        expect.stringContaining("At '/0/when' of the rules table: No column named 'colour'"),
      ]);
      const inSet = await refusal([{ when: '', set: { kind: '{colour|slug}' } }]);
      expect(inSet.message).toContain("At '/0/set/kind'");
    });

    it('a set template that is malformed', async () => {
      const found = await refusal([{ when: '', set: { kind: '{title|shout}' } }]);
      expect(found.code).toBe('E_RECIPE_TEMPLATE');
      expect(found.message).toContain("at '/0/set/kind' uses the filter 'shout'");
    });

    it('a column into= does not name', async () => {
      const found = await refusal([{ when: '', set: { kind: 'a', colour: 'red' } }]);
      expect(found.code).toBe('E_RECIPE_RULES');
      expect(found.message).toContain("sets 'colour' at '/0/set/colour'");
    });

    it('an entry after the default, which no row reaches', async () => {
      const found = await refusal([
        { when: '', set: { kind: 'a' } },
        { when: 'team = web', set: { kind: 'b' } },
      ]);
      expect(found.code).toBe('E_RECIPE_RULES');
      expect(found.message).toContain("entry at '/1' after the default at '/0'");
    });

    it('a table of the wrong shape, from a file or inline', async () => {
      const fromFile = await refusal([{ when: '', set: { kind: 1 } }]);
      expect(fromFile.code).toBe('E_RECIPE_DATA_SHAPE');
      expect(fromFile.message).toContain("at '/0/set/kind'");
      const empty = await refusal([]);
      expect(empty.message).toContain('at least one entry');

      const inline = await refusal(null, 'rules into=kind using=[{"when": ""}]');
      expect([inline.code, inline.at]).toEqual(['E_RECIPE_RULES', 'using=[{"when":']);
      expect(inline.message).toContain("is not a list of rules: at '/0/set'");
      const broken = await refusal(null, 'rules into=kind using=[{"when": "", ');
      expect(broken.message).toContain('written inline is not JSON');
    });

    it.each([
      ['rules using=@./vocabulary.json#/kinds', 'takes into='],
      ['rules into=kind', 'takes into='],
      ['rules into=kind using=@./vocabulary.json#/kinds extra', 'takes into='],
      ['rules into=k!nd using=@./vocabulary.json#/kinds', "cannot write a column named 'k!nd'"],
    ])('the arguments of %s', async (line, problem) => {
      const { problem: found } = await runOverShop([line]);
      expect(found?.code).toBe('E_RECIPE_ARGUMENTS');
      expect(found?.message).toContain(problem);
    });
  });

  it('has a vocabulary fixture whose every kind entry is reachable', () => {
    expect(VOCABULARY.kinds.at(-1)?.when).toBe('');
  });
});
