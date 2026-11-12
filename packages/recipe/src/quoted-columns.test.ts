import { err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import sheetHeaders from './__fixtures__/sheet-headers.recipe?raw';
import tasksJson from './__fixtures__/tasks.json';
import { formatStep, valuesOfStep } from './format-step.js';
import { parseRecipe } from './parse.js';
import { type Verb, createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import { columnNames } from './support.js';
import type { Table } from './table.js';

/**
 * TYTO-674: a column a recipe writes or picks may be named in quotes, with accents and blanks,
 * as a synced sheet's headers are written for people; a bare name keeps the rule it had.
 */

const tasks = tasksJson as unknown as Table;

/** Stands in for a sheet sink: it keeps the table it receives, as a plugin's sink reads it. */
function sheetSink() {
  const received: Table[] = [];
  const verb: Verb = {
    kind: 'sink',
    run: ({ table }) => {
      const input = table ?? { columns: [], rows: [] };
      received.push(input);
      return ok({ table: input, plan: { target: 'sheet', operations: [], count: 0 } });
    },
  };
  return { verb, received };
}

async function run(source: string) {
  const parsed = parseRecipe(source);
  if (!parsed.ok) throw new Error(parsed.error.map(({ message }) => message).join('\n'));
  const sink = sheetSink();
  const verbs = createVerbRegistry();
  verbs.register('test.sheet', sink.verb);
  const result = await runRecipe(parsed.value, {
    input: tasks,
    verbs,
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
  });
  return { result, received: sink.received };
}

/** One column and one row per line, as the other fixtures' snapshots are laid out. */
function oneRowPerLine(table: Table | undefined): string {
  const block = (items: readonly unknown[]) => items.map((item) => `    ${JSON.stringify(item)}`);
  return [
    '{',
    '  "columns": [',
    ...block(table?.columns ?? [])
      .join(',\n')
      .split('\n'),
    '  ],',
  ]
    .concat([
      '  "rows": [',
      ...block(table?.rows ?? [])
        .join(',\n')
        .split('\n'),
      '  ]',
      '}',
      '',
    ])
    .join('\n');
}

const lines = (...steps: string[]) => ['recipe test', ...steps].join('\n');

/** The first error a run reports, as `code: message`. */
async function refusal(...steps: string[]): Promise<string | undefined> {
  const { result } = await run(lines(...steps));
  const problems = result.ok ? result.diagnostics : result.error;
  const problem = problems.find((candidate) => candidate.severity === 'error');
  return problem === undefined ? undefined : `${problem.code}: ${problem.message}`;
}

describe('the sheet-headers fixture', () => {
  it('writes columns named with an accent and a blank, and the sink receives those names', async () => {
    const { result, received } = await run(sheetHeaders);
    if (!result.ok) throw new Error(result.error.map(({ message }) => message).join('\n'));
    expect(result.diagnostics).toEqual([]);
    expect(result.value.cells.map((cell) => cell.status)).toEqual(Array(5).fill('ok'));
    expect(received).toHaveLength(1);
    expect(received[0]?.columns.map((column) => column.name)).toEqual([
      'team',
      'Última Sync',
      'Nº de Tarefas',
    ]);
    await expect(oneRowPerLine(received[0])).toMatchFileSnapshot(
      './__snapshots__/sheet-headers.expected.json',
    );
  });

  it('round-trips every line through the form library', () => {
    const parsed = parseRecipe(sheetHeaders);
    if (!parsed.ok) throw new Error('the fixture must parse');
    const generic = parsed.value.steps.filter((step) => step.verb !== 'test.sheet');
    expect(generic).toHaveLength(4);
    for (const step of generic) {
      const values = valuesOfStep(step.verb, step);
      if (!values.ok) throw new Error(values.error.map(({ message }) => message).join('\n'));
      const line = formatStep(step.verb, values.value);
      expect(line.ok && line.value).toBe(`${step.verb} ${step.text}`);
    }
  });
});

describe('quoted column names on a line', () => {
  it('read a quoted name before = as a named argument', () => {
    const parsed = parseRecipe(lines('compose "Última Sync"="{due|slug}"'));
    if (!parsed.ok) throw new Error('must parse');
    const [argument] = parsed.value.steps[0]?.named ?? [];
    expect(argument).toMatchObject({ name: 'Última Sync', nameQuoted: true, value: '{due|slug}' });
  });

  it('keep a list with a quoted member as one word, and split it into marked names', () => {
    const parsed = parseRecipe(lines('select key,"Última Sync"', 'select key, "Última Sync"'));
    if (!parsed.ok) throw new Error('must parse');
    for (const step of parsed.value.steps) {
      expect(columnNames(step.positional).map(({ value, quoted }) => ({ value, quoted }))).toEqual([
        { value: 'key', quoted: undefined },
        { value: 'Última Sync', quoted: true },
      ]);
    }
  });

  it.each([
    ['compose', 'compose "Última Sync"="{due|slug}"', 'Última Sync'],
    ['collect', 'collect "Chave e Situação" from=key,status', 'Chave e Situação'],
    ['group into=', 'group by=team into="Tarefas do Time"', 'Tarefas do Time'],
    ['rewrite into=', 'rewrite title into="Título Limpo" using=@./v.json#/s', 'Título Limpo'],
  ])('let %s write a quoted name exactly', async (_verb, step, name) => {
    const source = lines(step);
    const parsed = parseRecipe(source);
    if (!parsed.ok) throw new Error('must parse');
    if (step.includes('@./')) {
      // rewrite reads its list from a data file; the name rule is what this checks.
      expect(parsed.value.steps[0]?.named.find((a) => a.name === 'into')).toMatchObject({
        value: name,
        quoted: true,
      });
      return;
    }
    const { result } = await run(source);
    if (!result.ok) throw new Error(result.error.map(({ message }) => message).join('\n'));
    expect(result.value.table?.columns.map((column) => column.name)).toContain(name);
  });

  it('select and select without= pick quoted names', async () => {
    const kept = await run(lines('compose "Última Sync"="x"', 'select key, "Última Sync"'));
    expect(kept.result.ok && kept.result.value.table?.columns.map(({ name }) => name)).toEqual([
      'key',
      'Última Sync',
    ]);
    const dropped = await run(
      lines('compose "Última Sync"="x"', 'select without=title,"Última Sync",kind,due,points'),
    );
    expect(
      dropped.result.ok && dropped.result.value.table?.columns.map(({ name }) => name),
    ).toEqual(['key', 'status', 'team']);
  });

  it('match a quoted name without case, so a second compose rewrites the same column', async () => {
    const { result } = await run(
      lines('compose "Última Sync"="a"', 'compose "ÚLTIMA SYNC"="b"', 'select key, "última sync"'),
    );
    if (!result.ok) throw new Error('must run');
    expect(result.value.table?.columns.map(({ name }) => name)).toEqual(['key', 'Última Sync']);
    expect(result.value.table?.rows[0]?.values['Última Sync']).toBe('b');
  });

  it.each([
    [
      'two extract names that differ only in case',
      'extract title pattern="^(?<a>\\S+) (?<b>\\S+)" into="Última Sync","última sync"',
      "E_RECIPE_ARGUMENTS: 'extract' would write the column 'última sync' twice.",
    ],
    [
      'age writing hours and month into one name in two cases',
      'age due format=yyyy-MM-dd into="Última Sync" month-into="ÚLTIMA SYNC"',
      "E_RECIPE_ARGUMENTS: 'age' writes the hours and the month into two columns, not both " +
        "into 'Última Sync'.",
    ],
    [
      'a group into= that is one of its by= columns in another case',
      'group by=team,"Última Sync" into="ÚLTIMA SYNC"',
      undefined,
    ],
  ])('refuse %s', async (_case, step, message) => {
    const found = await refusal('compose "Última Sync"="x"', step);
    if (message === undefined) expect(found).toMatch(/^E_RECIPE_ARGUMENTS: 'group'/u);
    else expect(found).toBe(message);
  });

  it.each([
    ['a blank at the start', 'compose " Sync"="x"', "cannot write a column named ' Sync'"],
    ['an empty name', 'group by=team into=""', "cannot write a column named ''"],
  ])('refuse a quoted name with %s', async (_case, step, message) => {
    expect(await refusal(step)).toContain(message);
  });
});

describe('a bare name keeps its rule', () => {
  it.each([
    [
      'compose with a blank',
      'compose Última Sync="{due|slug}"',
      "E_RECIPE_ARGUMENTS: 'compose' takes the words skip-empty and required, not 'Última'.",
    ],
    [
      'into= with a blank',
      'group by=team into=Tarefas do Time',
      "E_RECIPE_ARGUMENTS: 'group' takes by= the columns to group on and, optionally, into= " +
        'the list column of member keys, as in group by=kind,team.',
    ],
    [
      'into= with an accent',
      'group by=team into=Situação',
      "E_RECIPE_ARGUMENTS: 'group' cannot write a column named 'Situação'.",
    ],
  ])('refuses %s', async (_case, step, message) => {
    expect(await refusal(step)).toBe(message);
  });
});

describe('the form library and quoted names', () => {
  it.each([
    [
      'compose',
      { column: 'Última Sync', template: '{due|slug}' },
      'compose "Última Sync"={due|slug}',
    ],
    [
      'count',
      { column: 'Tarefas do Time', into: 'Nº de Tarefas' },
      'count "Tarefas do Time" into="Nº de Tarefas"',
    ],
    ['count', { column: 'rows', into: 'Situação' }, 'count rows into="Situação"'],
    ['group', { by: 'team, Última Sync', into: 'rows' }, 'group by=team,"Última Sync" into=rows'],
    ['select', { columns: 'team,  "Última Sync"' }, 'select team, "Última Sync"'],
    ['select', { without: 'key, "Última Sync"' }, 'select without=key,"Última Sync"'],
  ])('writes %s with its names quoted, and reads the line back', (verb, values, expected) => {
    const line = formatStep(verb, values);
    expect(line.ok && line.value).toBe(expected);
    const parsed = parseRecipe(lines(expected));
    if (!parsed.ok) throw new Error('must parse');
    const step = parsed.value.steps[0];
    if (step === undefined) throw new Error('must hold a step');
    const back = valuesOfStep(verb, step);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const again = formatStep(verb, back.value);
    expect(again.ok && again.value).toBe(expected);
  });

  it('refuses a compose column holding a double quote, which no line can carry', () => {
    const line = formatStep('compose', { column: 'say "hi"', template: 'x' });
    expect(line.ok).toBe(false);
    if (line.ok) return;
    expect(line.error[0]?.message).toContain('not a column name');
  });
});
