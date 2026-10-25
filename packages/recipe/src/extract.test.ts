import { describe, expect, it } from 'vitest';

import { columnOf, runOverShop } from './__fixtures__/rules-harness.js';
import { SHOP_TEXT, TASKS } from './__fixtures__/text-harness.js';
import { parseReplacement } from './extract.js';

const FILES = { './shop.json': SHOP_TEXT };
const CLEAN = 'rewrite title into=clean using=@./shop.json#/noise';
const AD = 'extract clean pattern=@./shop.json#/ad';

function run(lines: readonly string[], files: Record<string, unknown> = FILES) {
  return runOverShop(lines, files, TASKS);
}

/**
 * The private plugin's noise stripping and ad parsing (TYTO-391) re-expressed as
 * configuration: a rewrite list takes the clone prefix, the team label and the due suffix off
 * a title, and one pattern with named groups splits what remains into phase, format and theme.
 */
describe('rewrite', () => {
  it('applies the steps in order, each over what the one before left', async () => {
    const { table, problem } = await run([CLEAN]);
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'clean')).toEqual({
      'PS-1': '(Launch) Poster - Spring Fair (20% OFF)',
      'PS-2': 'Banner - Single batch',
      'PS-3': 'Something new',
      'PS-4': '(Early) (Launch) Banner Poster - Two formats',
    });
    expect(table?.columns.at(-1)).toEqual({ name: 'clean', type: 'text', origin: 'rewrite' });
  });

  it('depends on the order: the team label is only a prefix once the clone prefix is gone', async () => {
    const reversed = [SHOP_TEXT.noise[1], SHOP_TEXT.noise[0], SHOP_TEXT.noise[2]];
    const { table } = await run(['rewrite title into=clean using=@./steps.json'], {
      './steps.json': reversed,
    });
    expect(columnOf(table, 'clean')['PS-1']).toBe(
      'Design - (Launch) Poster - Spring Fair (20% OFF)',
    );
  });

  it('puts named groups back with $<name>, replaces every match and writes $$ as a dollar', async () => {
    const { table, problem } = await run([
      'rewrite title into=swapped using=[{"pattern": "^(?<team>\\\\w+) - (?<rest>.*)$", "replace": "$<rest> ($<team>)"}, {"pattern": "a", "replace": "$$"}]',
    ]);
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'swapped')['PS-2']).toBe('B$nner - Single b$tch (Copy)');
  });

  it('recomputes the column in place when into= names the one it reads, and empties a blank result', async () => {
    const { table } = await run(['rewrite title into=TITLE using=@./all.json'], {
      './all.json': [{ pattern: '^something new$', replace: '' }],
    });
    expect(table?.columns.map((column) => column.name)).toEqual([
      'key',
      'title',
      'description',
      'comments',
    ]);
    expect(columnOf(table, 'title')['PS-3']).toBeNull();
    expect(columnOf(table, 'title')['PS-2']).toBe('Copy - Banner - Single batch');
  });

  it('rewrites the first 4,096 characters and passes the rest through', async () => {
    const provenance = { source: 'test', id: 'PS-1', fetchedAt: '2026-10-25' };
    const long = {
      ...TASKS,
      rows: [{ key: 'PS-1', values: { title: 'a'.repeat(5000) }, provenance }],
    };
    const { table } = await runOverShop(
      ['rewrite title into=clean using=@./steps.json'],
      { './steps.json': [{ pattern: 'a', replace: 'b' }] },
      long,
    );
    expect(columnOf(table, 'clean')['PS-1']).toBe('b'.repeat(4096) + 'a'.repeat(904));
  });

  it('reads a replacement into literal text and groups', () => {
    expect(parseReplacement('x $<a> $$', ['a'])).toMatchObject({
      ok: true,
      value: [{ text: 'x ' }, { group: 'a' }, { text: ' $' }],
    });
  });

  describe('refuses before reading any row', () => {
    async function refusal(steps: unknown) {
      const { problem, at } = await run(['rewrite title into=clean using=@./bad.json'], {
        './bad.json': steps,
      });
      return { code: problem?.code, message: problem?.message, at };
    }

    it('a group the pattern does not name', async () => {
      const found = await refusal([{ pattern: '(?<a>x)', replace: '$<b>' }]);
      expect(found.code).toBe('E_RECIPE_REWRITE');
      expect(found.message).toContain("at '/0/replace' '$<b>', and its pattern names a");
      expect(found.at).toBe('using=@./bad.json');
    });

    it('a dollar that is neither $<name> nor $$', async () => {
      const found = await refusal([{ pattern: '(x)', replace: '$1' }]);
      expect(found.code).toBe('E_RECIPE_REWRITE');
      expect(found.message).toContain('write $$ for a dollar');
    });

    it('a pattern the guard refuses, naming the step and keeping its code', async () => {
      const found = await refusal([
        { pattern: 'x', replace: '' },
        { pattern: '(a+)+', replace: '' },
      ]);
      expect(found.code).toBe('E_RECIPE_PATTERN_UNSAFE');
      expect(found.message).toMatch(/^At '\/1\/pattern' of the rewrite list:/u);
    });

    it('a list of the wrong shape', async () => {
      const found = await refusal([{ pattern: 'x' }]);
      expect(found.code).toBe('E_RECIPE_DATA_SHAPE');
    });

    it('inline JSON that is not JSON', async () => {
      const { problem } = await run(['rewrite title into=clean using=[{"pattern": "x",']);
      expect(problem?.code).toBe('E_RECIPE_REWRITE');
    });
  });
});

describe('extract', () => {
  it('writes one column per named group, in the order the groups open', async () => {
    const { table, problem } = await run([CLEAN, AD]);
    expect(problem).toBeUndefined();
    expect(table?.columns.slice(-3)).toEqual([
      { name: 'phase', type: 'text', origin: 'extract' },
      { name: 'format', type: 'text', origin: 'extract' },
      { name: 'theme', type: 'text', origin: 'extract' },
    ]);
    expect(columnOf(table, 'phase')).toEqual({
      'PS-1': 'Launch',
      'PS-2': null,
      'PS-3': null,
      'PS-4': 'Launch',
    });
    expect(columnOf(table, 'format')).toMatchObject({ 'PS-1': 'Poster', 'PS-2': 'Banner' });
    // A parenthesis after the format belongs to the theme.
    expect(columnOf(table, 'theme')).toMatchObject({
      'PS-1': 'Spring Fair (20% OFF)',
      'PS-2': 'Single batch',
    });
  });

  it('gives null in every column when the pattern does not match', async () => {
    const { table } = await run([CLEAN, AD]);
    for (const name of ['phase', 'format', 'theme']) {
      expect(columnOf(table, name)['PS-3']).toBeNull();
    }
  });

  // Declared difference (TYTO-400 measures it): the private plugin took the first format of its
  // vocabulary found anywhere in the title; a pattern takes the leftmost one in the title.
  it('takes the leftmost format when a title holds two', async () => {
    const { table } = await run([CLEAN, AD]);
    expect(columnOf(table, 'format')['PS-4']).toBe('Banner');
    expect(columnOf(table, 'theme')['PS-4']).toBe('Poster - Two formats');
  });

  it('names the columns with into=, one per group in order, or with a prefix', async () => {
    const named = await run([CLEAN, `${AD} into=stage,kind,subject`]);
    expect(columnOf(named.table, 'kind')['PS-1']).toBe('Poster');
    expect(columnOf(named.table, 'subject')['PS-2']).toBe('Single batch');
    const prefixed = await run([CLEAN, `${AD} into=ad_*`]);
    expect(prefixed.table?.columns.slice(-3).map((column) => column.name)).toEqual([
      'ad_phase',
      'ad_format',
      'ad_theme',
    ]);
  });

  it('reads a pattern written inline, and trims what a group took', async () => {
    const { table, problem } = await run([
      'extract title pattern="-\\s*(?<team>\\w+)\\s*-(?<rest>[^-]+)"',
    ]);
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'team')['PS-1']).toBe('Design');
    expect(columnOf(table, 'rest')['PS-1']).toBe('(Launch) Poster');
  });

  describe('refuses', () => {
    it('a pattern the guard refuses, pointing into the pattern', async () => {
      const { problem, at } = await run(['extract title pattern="(?<a>(x+)+)"']);
      expect(problem?.code).toBe('E_RECIPE_PATTERN_UNSAFE');
      expect(at).toBe('(x+)+');
    });

    it('a pattern with no named group', async () => {
      const { problem, at } = await run(['extract title pattern="(x)"']);
      expect([problem?.code, at]).toEqual(['E_RECIPE_PATTERN', 'pattern="(x)"']);
    });

    it('into= naming more or fewer columns than the groups', async () => {
      const { problem, at } = await run([CLEAN, `${AD} into=a,b`]);
      expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
      expect(problem?.message).toContain('3 named group(s) (phase, format, theme)');
      expect(at).toBe('into=a,b');
    });

    it('a column the table lacks', async () => {
      const { problem } = await run(['extract colour pattern="(?<a>x)"']);
      expect(problem?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    });
  });
});
