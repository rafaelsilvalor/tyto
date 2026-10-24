import { err } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import campaignJson from './__fixtures__/campaign.json';
import campaignMap from './__fixtures__/campaign-map.recipe?raw';
import { pairKey } from './__fixtures__/pair-key.js';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { type RunOptions, runRecipe } from './run.js';
import type { Table } from './table.js';

const campaign = campaignJson as unknown as Table;

function options(extra: Partial<RunOptions> = {}): RunOptions {
  const derivations = createDerivationRegistry();
  derivations.register('pair-key', pairKey);
  return {
    input: campaign,
    verbs: createVerbRegistry(),
    derivations,
    resolveRecipe: () => Promise.resolve(err([])),
    ...extra,
  };
}

async function run(lines: readonly string[], extra: Partial<RunOptions> = {}) {
  const source = ['recipe test', ...lines].join('\n');
  const parsed = parseRecipe(source);
  if (!parsed.ok) throw new Error(parsed.error.map(({ message }) => message).join('\n'));
  const result = await runRecipe(parsed.value, options(extra));
  if (!result.ok) throw new Error(result.error.map(({ message }) => message).join('\n'));
  return { source, run: result.value, diagnostics: result.diagnostics };
}

const column = (table: Table | undefined, name: string) =>
  Object.fromEntries(table?.rows.map((row) => [row.key, row.values[name]]) ?? []);

const copyJoin = 'join copy left="team = design" right="team = copy" on=pair_key';

describe('the campaign map fixture', () => {
  it('runs over the demo campaign into the committed result', async () => {
    const parsed = parseRecipe(campaignMap);
    if (!parsed.ok) throw new Error('the fixture recipe must parse');
    const result = await runRecipe(parsed.value, options());
    if (!result.ok) throw new Error('the fixture recipe must run');

    expect(result.value.cells.map((cell) => cell.status)).toEqual(Array(7).fill('ok'));
    expect(result.diagnostics.map(({ code, message }) => [code, message])).toEqual([
      [
        'W_RECIPE_JOIN_AMBIGUOUS',
        "1 row(s) of join 'copy' have more than one candidate and stay unpaired: DEMO-102.",
      ],
    ]);
    expect(result.value.keeps.map((kept) => kept.name)).toEqual(['campaign-map']);
    await expect(oneRowPerLine(result.value.table)).toMatchFileSnapshot(
      './__snapshots__/campaign-map.expected.json',
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

describe('join', () => {
  it('says how each left row paired, and never pairs an ambiguous key', async () => {
    const { run: result } = await run(['derive pair-key', copyJoin]);
    expect(column(result.table, 'copy_match')).toEqual({
      'DEMO-101': 'paired',
      'DEMO-102': 'ambiguous (2 candidates)',
      'DEMO-103': 'paired',
      'DEMO-104': 'no key',
      'DEMO-105': 'no pair',
      'DEMO-301': null,
      'DEMO-302': null,
      'DEMO-303': null,
      'DEMO-401': null,
    });
    expect(column(result.table, 'copy_key')).toMatchObject({
      'DEMO-101': 'DEMO-201',
      'DEMO-102': null,
      'DEMO-103': 'DEMO-204',
    });
  });

  it('consumes the right side, so a paired copy is never also a row of its own', async () => {
    const { run: result } = await run(['derive pair-key', copyJoin]);
    const keys = result.table?.rows.map((row) => row.key) ?? [];
    expect(keys.filter((key) => key.startsWith('DEMO-2'))).toEqual([]);
    expect(keys).toHaveLength(campaign.rows.length - 4);
  });

  it('keeps each left row its own provenance and types the new columns from the brought ones', async () => {
    const { run: result } = await run(['derive pair-key', `${copyJoin} bring=key,due`]);
    expect(result.table?.rows[0]?.provenance.id).toBe('DEMO-101');
    expect(result.table?.columns.slice(-3)).toEqual([
      { name: 'copy_key', type: 'text', origin: 'join copy' },
      { name: 'copy_due', type: 'date', origin: 'join copy' },
      { name: 'copy_match', type: 'text', origin: 'join copy' },
    ]);
  });

  it('warns once per cell about ambiguous rows, at the line', async () => {
    const { source, run: result } = await run(['derive pair-key', copyJoin]);
    const [warning] = result.cells[1]?.diagnostics ?? [];
    expect(warning?.code).toBe('W_RECIPE_JOIN_AMBIGUOUS');
    expect(source.slice(warning?.range?.start, warning?.range?.end)).toBe(
      copyJoin.slice('join '.length),
    );
  });

  it.each([
    ['no prefix', 'join left="team = design" right="team = copy" on=pair_key', 'takes one prefix'],
    [
      'a prefix in capitals',
      'join Copy left="team = a" right="team = b" on=pair_key',
      'lower-case',
    ],
    ['a missing side', 'join copy left="team = design" on=pair_key', 'needs right='],
    ['a repeated name', `${copyJoin} on=title`, "takes 'on=' once"],
    ['a stray name', `${copyJoin} with=key`, "does not take 'with='"],
    ['a prefix already used', `${copyJoin}\n${copyJoin}`, 'already has'],
  ])('refuses %s', async (_case, line, message) => {
    const { run: result } = await run(['derive pair-key', ...line.split('\n')]);
    const problem = result.cells
      .flatMap((cell) => cell.diagnostics)
      .find((found) => found.severity === 'error');
    expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
    expect(problem?.message).toContain(message);
  });

  it('names the key column it cannot find, at the line, with what the table has', async () => {
    const { source, run: result } = await run([copyJoin]);
    const problem = result.cells[0]?.diagnostics[0];
    expect(problem?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    expect(problem?.message).toBe(
      "No column named 'pair_key' in this table. Available: key, title, team, status, due.",
    );
    expect(source.slice(problem?.range?.start, problem?.range?.end)).toBe('on=pair_key');
  });

  it('points a filter mistake inside the quoted side', async () => {
    const { source, run: result } = await run([
      'join copy left="tem = design" right="team = copy" on=title',
    ]);
    const problem = result.cells[0]?.diagnostics[0];
    expect(problem?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    expect(source.slice(problem?.range?.start, problem?.range?.end)).toBe('tem');
  });
});
