import { err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import openAds from './__fixtures__/open-ads.recipe?raw';
import tasksJson from './__fixtures__/tasks.json';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { type RunOptions, runRecipe } from './run.js';
import type { Table } from './table.js';

const tasks = tasksJson as unknown as Table;

const options = (extra: Partial<RunOptions> = {}): RunOptions => ({
  input: tasks,
  verbs: createVerbRegistry(),
  derivations: createDerivationRegistry(),
  resolveRecipe: () => Promise.resolve(err([])),
  ...extra,
});

async function run(lines: readonly string[], extra: Partial<RunOptions> = {}) {
  const source = ['recipe test', ...lines].join('\n');
  const parsed = parseRecipe(source);
  if (!parsed.ok) throw new Error(parsed.error.map(({ message }) => message).join('\n'));
  const result = await runRecipe(parsed.value, options(extra));
  return { source, result };
}

const keys = (table: Table | undefined) => table?.rows.map((row) => row.key);
const names = (table: Table | undefined) => table?.columns.map((column) => column.name);

describe('the fixture recipe', () => {
  it('runs over the demo table into the committed result', async () => {
    const parsed = parseRecipe(openAds);
    if (!parsed.ok) throw new Error('the fixture recipe must parse');
    const result = await runRecipe(parsed.value, options());
    if (!result.ok) throw new Error('the fixture recipe must run');

    expect(result.value.cells.map((cell) => cell.status)).toEqual(Array(6).fill('ok'));
    expect(result.diagnostics).toEqual([]);
    expect(result.value.view).toBe('table');
    expect(result.value.keeps.map((kept) => kept.name)).toEqual(['open-ads']);
    expect(result.value.keeps[0]?.table).toBe(result.value.table);
    await expect(oneRowPerLine(result.value.table)).toMatchFileSnapshot(
      './__snapshots__/open-ads.expected.json',
    );
  });
});

/** The fixture's layout: one column and one row per line, so a changed row is a one-line diff. */
function oneRowPerLine(table: Table | undefined): string {
  const block = (items: readonly unknown[]) =>
    items.map((item, index) => `    ${JSON.stringify(item)}${index < items.length - 1 ? ',' : ''}`);
  return [
    '{',
    '  "columns": [',
    ...block(table?.columns ?? []),
    '  ],',
    '  "rows": [',
    ...block(table?.rows ?? []),
    '  ]',
    '}',
    '',
  ].join('\n');
}

describe('where', () => {
  it('chains as AND and folds accents and case in values', async () => {
    const { result } = await run(['where kind = ANUNCIO', 'where status in (revisão, doing)']);
    expect(result.ok && keys(result.value.table)).toEqual(['DEMO-4', 'DEMO-5', 'DEMO-10']);
  });

  it('matches column names without case', async () => {
    const { result } = await run(['where KIND = post']);
    expect(result.ok && keys(result.value.table)).toEqual(['DEMO-7', 'DEMO-12']);
  });

  it('aborts on a column the table lacks, listing the ones it has, instead of keeping nothing', async () => {
    const { source, result } = await run(['where knd = post', 'show table']);
    if (!result.ok) throw new Error('a failing cell is a value, not a failed run');
    const [cell, after] = result.value.cells;
    expect(cell?.status).toBe('failed');
    expect(after?.status).toBe('skipped');
    expect(result.value.table).toBeUndefined();
    const [problem] = cell?.diagnostics ?? [];
    expect(problem?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    expect(problem?.message).toBe(
      "No column named 'knd' in this table. Available: key, title, kind, status, team, due, points.",
    );
    expect(problem?.hint).toBe("Did you mean 'kind'?");
    expect(source.slice(problem?.range?.start, problem?.range?.end)).toBe('knd');
  });

  it('warns when it keeps no row of a table that had some', async () => {
    const { result } = await run(['where kind = podcast']);
    expect(result.ok && result.value.cells[0]?.status).toBe('ok');
    expect(result.ok && result.diagnostics.map(({ code }) => code)).toEqual([
      'W_RECIPE_WHERE_EMPTY',
    ]);
  });

  it('reports a filter error inside the recipe line', async () => {
    const { source, result } = await run(['where kind = ad OR kind = post']);
    const problem = result.ok ? result.value.cells[0]?.diagnostics[0] : undefined;
    expect(problem?.code).toBe('E_RECIPE_WHERE');
    expect(source.slice(problem?.range?.start, problem?.range?.end)).toBe('OR');
  });

  it('keeps the rows whose cell matches a pattern, case ignored and accents named', async () => {
    const launches = await run([String.raw`where title matches "^launch\b"`]);
    expect(launches.result.ok && keys(launches.result.value.table)).toEqual(['DEMO-3', 'DEMO-6']);
    const ads = await run(['where kind matches "^an[uú]ncio$" AND title not matches "sale|card"']);
    expect(ads.result.ok && keys(ads.result.value.table)).toEqual([
      'DEMO-4',
      'DEMO-5',
      'DEMO-10',
      'DEMO-11',
    ]);
  });

  it('reports a refused pattern at its construct in the recipe line', async () => {
    const { source, result } = await run(['where title matches "(sale\\s*)+banner"']);
    const problem = result.ok ? result.value.cells[0]?.diagnostics[0] : undefined;
    expect(problem?.code).toBe('E_RECIPE_PATTERN_UNSAFE');
    expect(source.slice(problem?.range?.start, problem?.range?.end)).toBe(String.raw`(sale\s*)+`);
  });

  it('reads a fully quoted expression inside its quotes', async () => {
    const { result } = await run(['where "kind = post AND team = copy"']);
    expect(result.ok && keys(result.value.table)).toEqual(['DEMO-12']);
  });
});

describe('select', () => {
  it('keeps the named columns in the order written, with a comma or a space', async () => {
    const { result } = await run(['select points,KEY title']);
    expect(result.ok && names(result.value.table)).toEqual(['points', 'key', 'title']);
    expect(result.ok && result.value.table?.rows[0]?.values).toEqual({
      points: 3,
      key: 'DEMO-1',
      title: 'Spring sale banner',
    });
    expect(result.ok && result.value.table?.rows[0]?.provenance.id).toBe('DEMO-1');
  });

  it('drops the columns given to without= and keeps the rest in place', async () => {
    const { result } = await run(['select without=title,due']);
    expect(result.ok && names(result.value.table)).toEqual([
      'key',
      'kind',
      'status',
      'team',
      'points',
    ]);
  });

  it('aborts on an unknown column in either form, listing the available ones', async () => {
    for (const line of ['select key, titel', 'select without=titel']) {
      const { result } = await run([line]);
      const problem = result.ok ? result.value.cells[0]?.diagnostics[0] : undefined;
      expect(problem?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
      expect(problem?.message).toContain('Available: key, title, kind');
    }
  });

  it.each([
    ['both forms', 'select key without=title', 'exactly one of two forms'],
    ['neither form', 'select', 'exactly one of two forms'],
    ['every column dropped', 'select without=key,title,kind,status,team,due,points', 'without any'],
    ['an argument it does not take', 'select key only=1', "does not take 'only='"],
  ])('refuses %s', async (_case, line, message) => {
    const { result } = await run([line]);
    const problem = result.ok ? result.value.cells[0]?.diagnostics[0] : undefined;
    expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
    expect(problem?.message).toContain(message);
  });
});

describe('sort', () => {
  it('orders numbers as numbers and keeps ties in their order', async () => {
    const { result } = await run(['sort points desc']);
    expect(result.ok && keys(result.value.table)?.slice(0, 5)).toEqual([
      'DEMO-3',
      'DEMO-11',
      'DEMO-5',
      'DEMO-8',
      'DEMO-9',
    ]);
  });

  it('puts an empty cell last in both directions', async () => {
    for (const line of ['sort due', 'sort due desc']) {
      const { result } = await run([line]);
      expect(result.ok && keys(result.value.table)?.at(-1)).toBe('DEMO-5');
    }
  });

  it('refuses a direction it does not know', async () => {
    const { result } = await run(['sort points down']);
    expect(result.ok && result.value.cells[0]?.diagnostics[0]?.message).toBe(
      "'sort' sorts asc or desc, not 'down'.",
    );
  });
});

describe('show and keep', () => {
  it('record the view and the kept table, and leave rows and columns alone', async () => {
    const { result } = await run(['show board', 'keep all-tasks']);
    if (!result.ok) throw new Error('expected the run to succeed');
    expect(result.value.view).toBe('board');
    expect(result.value.table).toBe(tasks);
    expect(result.value.keeps).toEqual([{ name: 'all-tasks', table: tasks }]);
  });

  it.each([['show'], ['show a b'], ['keep'], ['keep ../outside']])('refuse %j', async (line) => {
    const { result } = await run([line]);
    expect(result.ok && result.value.cells[0]?.diagnostics[0]?.code).toBe('E_RECIPE_ARGUMENTS');
  });
});

describe('the chain', () => {
  it('reports a verb nobody contributes at its line, with what is available', async () => {
    const { source, result } = await run(['jion copy', 'show table']);
    const problem = result.ok ? result.value.cells[0]?.diagnostics[0] : undefined;
    expect(problem?.code).toBe('E_RECIPE_UNKNOWN_VERB');
    expect(problem?.message).toBe(
      "No verb named 'jion' is available. Available: collect, compose, derive, join, keep, rules, run, select, show, sort, where.",
    );
    expect(source.slice(problem?.range?.start, problem?.range?.end)).toBe('jion');
    expect(result.ok && result.value.cells[1]?.status).toBe('skipped');
  });

  it('says a verb needs a table when no cell produced one', async () => {
    const { result } = await run(['show table'], { input: undefined });
    expect(result.ok && result.value.cells[0]?.diagnostics[0]?.message).toBe(
      "'show' needs a table, and no cell before it produced one.",
    );
  });

  it('awaits a contributed verb and hands its table to the next cell', async () => {
    const verbs = createVerbRegistry();
    const registered = verbs.register('demo.source', {
      kind: 'source',
      run: () => Promise.resolve(ok({ table: tasks })),
    });
    expect(registered.ok).toBe(true);
    const { result } = await run(['demo.source', 'where key = DEMO-2'], {
      input: undefined,
      verbs,
    });
    expect(result.ok && keys(result.value.table)).toEqual(['DEMO-2']);
  });

  it.each([
    ['a bare name, which is the generic vocabulary', 'where', 'namespaced'],
    ['a bare name Tyto does not use yet', 'pull', 'namespaced'],
    ['a name taken twice', 'demo.twice', 'already registered'],
  ])('refuses to register %s', (_case, name, message) => {
    const verbs = createVerbRegistry();
    const verb = { kind: 'transform' as const, run: () => err([]) };
    verbs.register('demo.twice', verb);
    const registered = verbs.register(name, verb);
    expect(registered.ok ? undefined : registered.error[0]?.message).toContain(message);
  });

  it('refuses a derivation name that is not lower-case words', () => {
    const derivations = createDerivationRegistry();
    const derivation = { requires: [], produces: [], derive: () => err([]) };
    expect(derivations.register('kind', derivation).ok).toBe(true);
    expect(derivations.register('Kind!', derivation).ok).toBe(false);
  });
});

describe('parameters', () => {
  it('fill placeholders from the run, then from the default', async () => {
    const lines = ['param kind = post', 'where kind = {kind}'];
    const byDefault = await run(lines);
    expect(byDefault.result.ok && keys(byDefault.result.value.table)).toEqual([
      'DEMO-7',
      'DEMO-12',
    ]);
    const given = await run(lines, { params: { kind: 'copy' } });
    expect(given.result.ok && keys(given.result.value.table)).toEqual(['DEMO-2', 'DEMO-6']);
  });

  it('fail the run when one has no value or an undeclared one is given', async () => {
    const missing = await run(['param kind', 'where kind = {kind}']);
    expect(missing.result.ok ? undefined : missing.result.error[0]?.message).toBe(
      "Parameter 'kind' has no value; give one when running the recipe, or a default in its 'param' line.",
    );
    const stray = await run([], { params: { kind: 'post' } });
    expect(stray.result.ok ? undefined : stray.result.error[0]?.message).toContain(
      'this recipe declares no parameter',
    );
  });
});

describe('aliases', () => {
  const aliases = {
    tipo: 'kind',
    pontos: 'points',
    equipe: 'missing',
    time: 'tipo',
    status: 'kind',
  };

  it('are read on the way in and never reach the output', async () => {
    const { result } = await run(['where TIPO = post', 'select key, pontos', 'sort pontos'], {
      aliases,
    });
    expect(result.ok && names(result.value.table)).toEqual(['key', 'points']);
    expect(result.ok && keys(result.value.table)).toEqual(['DEMO-12', 'DEMO-7']);
  });

  it.each([
    ['one spelt like a real column', 'where status = done', 'would hide that column'],
    ['one that points at another alias', 'where time = post', 'itself an alias'],
  ])('refuse %s', async (_case, line, message) => {
    const { result } = await run([line], { aliases });
    const problem = result.ok ? result.value.cells[0]?.diagnostics[0] : undefined;
    expect(problem?.code).toBe('E_RECIPE_ALIAS');
    expect(problem?.message).toContain(message);
  });

  it('never create a column', async () => {
    const { result } = await run(['select equipe'], { aliases });
    const problem = result.ok ? result.value.cells[0]?.diagnostics[0] : undefined;
    expect(problem?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    expect(problem?.hint).toBe("'equipe' is an alias for 'missing'.");
  });
});
