import { err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import campaignJson from './__fixtures__/campaign.json';
import { pairKey } from './__fixtures__/pair-key.js';
import { parseRecipe } from './parse.js';
import { type Derivation, createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { Table } from './table.js';

const campaign = campaignJson as unknown as Table;

async function run(lines: readonly string[], registered: Record<string, Derivation> = {}) {
  const source = ['recipe test', ...lines].join('\n');
  const parsed = parseRecipe(source);
  if (!parsed.ok) throw new Error('the recipe must parse');
  const derivations = createDerivationRegistry();
  for (const [name, derivation] of Object.entries(registered))
    derivations.register(name, derivation);
  const result = await runRecipe(parsed.value, {
    input: campaign,
    verbs: createVerbRegistry(),
    derivations,
    resolveRecipe: () => Promise.resolve(err([])),
  });
  if (!result.ok) throw new Error('the run must start');
  const problem = result.value.cells.flatMap((cell) => cell.diagnostics)[0];
  const at = problem?.range ? source.slice(problem.range.start, problem.range.end) : undefined;
  return { result: result.value, problem, at };
}

/** A derivation that answers later, as one in another process will. */
const shout: Derivation = {
  requires: ['deliverable'],
  produces: ['loud'],
  derive: async (table) => {
    await Promise.resolve();
    return ok({
      table: {
        columns: [...table.columns, { name: 'loud', type: 'text', origin: 'derive shout' }],
        rows: table.rows.map((row) => ({
          ...row,
          values: { ...row.values, loud: String(row.values['deliverable']).toUpperCase() },
        })),
      },
    });
  },
};

describe('derive', () => {
  it('runs derivations in the order written, each reading the table the one before made', async () => {
    const { result } = await run(['derive pair-key shout'], { 'pair-key': pairKey, shout });
    expect(result.table?.columns.map((column) => column.name).slice(-3)).toEqual([
      'deliverable',
      'pair_key',
      'loud',
    ]);
    expect(result.table?.rows[0]?.values).toMatchObject({
      deliverable: 'Banner Spring sale',
      pair_key: ['name:Banner Spring sale'],
      loud: 'BANNER SPRING SALE',
    });
  });

  it('names a required column the table lacks, at the derivation, with what it has', async () => {
    const { problem, at } = await run(['derive shout'], { shout });
    expect(problem?.code).toBe('E_RECIPE_DERIVATION');
    expect(problem?.message).toBe(
      "Derivation 'shout' needs the column deliverable, which this table lacks; it has key, " +
        'title, team, status, due.',
    );
    expect(at).toBe('shout');
  });

  it('lists what is registered for an unknown name, and says when nothing is', async () => {
    const some = await run(['derive pair-kee'], { 'pair-key': pairKey });
    expect(some.problem?.message).toBe(
      "Derivation 'pair-kee' is not registered; registered: pair-key.",
    );
    expect(some.problem?.hint).toBe("Did you mean 'pair-key'?");
    const none = await run(['derive pair-key']);
    expect(none.problem?.message).toContain(
      'no derivation is; derivations come with installed plugins',
    );
  });

  it.each([
    [
      'a promised column it did not add',
      (table: Table) => ok({ table }),
      'declares that it produces deliverable, and its table lacks it',
    ],
    [
      'rows it dropped',
      (table: Table) =>
        ok({
          table: {
            columns: [
              ...table.columns,
              { name: 'deliverable', type: 'text' as const, origin: 'x' },
            ],
            rows: table.rows.slice(1),
          },
        }),
      'returned 12 rows for 13',
    ],
  ])('refuses %s', async (_case, derive, message) => {
    const broken: Derivation = { requires: [], produces: ['deliverable'], derive };
    const { problem } = await run(['derive broken'], { broken });
    expect(problem?.code).toBe('E_RECIPE_DERIVATION');
    expect(problem?.message).toContain(message);
  });

  it('refuses a line without a name', async () => {
    const { problem } = await run(['derive']);
    expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
  });
});
