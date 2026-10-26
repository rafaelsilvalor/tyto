import { err, ok } from '@tyto/core';
import { type Plan, type Table, parseRecipe, runRecipe } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import { type Plugin, type PluginHost, createPluginHost } from './host.js';
import { type RecipeRegistries, recipeRegistriesOf } from './recipes.js';

/**
 * `recipe-verb` and `recipe-derivation` in process (TYTO-376, ADR 0135): the namespace a
 * manifest declares, who may own it, and what the adapter hands the recipe runner. The same
 * contributions across a process boundary are `isolation/isolated-plugin.test.ts`'s.
 */

const ROWS: Table = {
  columns: [{ name: 'number', type: 'number', origin: 'test' }],
  rows: [1, 2].map((number) => ({
    key: `N-${String(number)}`,
    values: { number },
    provenance: { source: 'test', id: `N-${String(number)}`, fetchedAt: '2026-10-24' },
  })),
};

function pluginOf(
  id: string,
  activate: (host: PluginHost) => void,
  manifest: Record<string, unknown> = {},
): Plugin {
  return {
    id,
    manifest: {
      name: id,
      version: '0.1.0',
      engine: '>=0.1',
      contributes: ['recipe-verb', 'recipe-derivation'],
      permissions: [],
      namespace: 'demo',
      ...manifest,
    },
    activate,
  };
}

const numbers = (host: PluginHost, id = 'demo.numbers') =>
  host.registerRecipeVerb({
    id,
    kind: 'source',
    arguments: [{ name: 'label', type: 'text', values: ['a', 'b'] }],
    page: () => ok({ table: ROWS }),
  });

async function run(registries: RecipeRegistries, ...lines: string[]) {
  const parsed = parseRecipe(['recipe test', ...lines].join('\n'));
  if (!parsed.ok) throw new Error('the recipe must parse');
  const result = await runRecipe(parsed.value, {
    ...registries,
    resolveRecipe: () => Promise.resolve(err([])),
  });
  if (!result.ok) throw new Error('the run must start');
  const problem = result.value.cells.flatMap((cell) => cell.diagnostics)[0];
  return { table: result.value.table, problem: problem?.message };
}

describe('a recipe namespace (ADR 0135)', () => {
  it('belongs to the plugin loaded first; a second claiming it is refused whole', async () => {
    const host = createPluginHost();
    expect(host.tryActivate(pluginOf('first', (plugin) => numbers(plugin))).ok).toBe(true);
    const second = host.tryActivate(pluginOf('second', (plugin) => numbers(plugin, 'demo.other')));
    expect(second.ok ? '' : second.error[0]?.message).toBe(
      "Plugin 'second' was refused: the namespace 'demo' belongs to plugin 'first'.",
    );
    expect(host.registry.recipeVerbs().map((verb) => verb.id)).toEqual(['demo.numbers']);
  });

  it('is required of a manifest that contributes to the recipe points', () => {
    const host = createPluginHost();
    const refused = host.tryActivate(pluginOf('first', numbers, { namespace: undefined }));
    expect(refused.ok ? '' : refused.error[0]?.message).toContain(
      "at 'namespace': is required by a plugin that contributes recipe-verb or recipe-derivation",
    );
  });

  it('names every verb and derivation; a bare or foreign name is refused at load', () => {
    const cases: [(host: PluginHost) => void, string][] = [
      [(host) => numbers(host, 'numbers'), "registered the verb 'numbers', and its names"],
      [(host) => numbers(host, 'jira.pull'), "registered the verb 'jira.pull', and its names"],
      [
        (host) =>
          host.registerRecipeDerivation({
            id: 'parity',
            requires: [],
            produces: [],
            derive: (table) => ok(table),
          }),
        "registered the derivation 'parity', and its names are written 'demo.<name>'",
      ],
    ];
    for (const [activate, problem] of cases) {
      const refused = createPluginHost().tryActivate(pluginOf('first', activate));
      expect(refused.ok ? '' : refused.error[0]?.message).toContain(problem);
    }
  });
});

describe('a recipe verb kind', () => {
  const marking = (writes: readonly string[] | undefined, kind: 'action' | 'sink' = 'action') =>
    pluginOf(
      'first',
      (host) =>
        host.registerRecipeVerb({
          id: 'demo.mark',
          kind,
          arguments: [],
          ...(writes === undefined ? {} : { writes }),
          plan: () => ok({ target: 'demo', operations: [], count: 0 }),
        }),
      { writes: ['mark', 'assign'] },
    );
  const refusal = (plugin: Plugin) => {
    const activated = createPluginHost().tryActivate(plugin);
    return activated.ok ? '' : activated.error[0]?.message;
  };

  it('accepts an action and a sink whose writes the manifest declares', () => {
    expect(refusal(marking(['mark']))).toBe('');
    expect(refusal(marking(['mark', 'assign'], 'sink'))).toBe('');
  });

  it('refuses at load a write the manifest does not declare, naming what it does', () => {
    expect(refusal(marking(['mark', 'delete']))).toBe(
      "Plugin 'first' failed to activate: Plugin 'first' registered the verb 'demo.mark' as an " +
        "action writing 'delete', which its tyto-plugin.json does not declare in 'writes' " +
        '(mark, assign).',
    );
  });

  it("refuses an action with no 'writes', and a source or a transform with some", () => {
    expect(refusal(marking(undefined))).toContain("as an action with no 'writes'");
    expect(refusal(marking([]))).toContain("as an action with no 'writes'");
    const writingSource = pluginOf(
      'first',
      (host) =>
        host.registerRecipeVerb({
          id: 'demo.pull',
          kind: 'source',
          arguments: [],
          writes: ['mark'],
          page: () => ok({ table: ROWS }),
        }),
      { writes: ['mark'] },
    );
    expect(refusal(writingSource)).toContain(
      "registered the verb 'demo.pull' as a source with 'writes', and only an action or a sink " +
        'writes',
    );
  });

  it("refuses an action with no 'plan'", () => {
    const planless = pluginOf(
      'first',
      (host) =>
        host.registerRecipeVerb({ id: 'demo.mark', kind: 'action', arguments: [], writes: [] }),
      { writes: ['mark'] },
    );
    expect(refusal(planless)).toContain("as an action with no 'plan'");
  });

  it('refuses a source with nothing to call', () => {
    const refused = createPluginHost().tryActivate(
      pluginOf('first', (host) =>
        host.registerRecipeVerb({ id: 'demo.pull', kind: 'source', arguments: [] }),
      ),
    );
    expect(refused.ok ? '' : refused.error[0]?.message).toContain("as a source with no 'page'");
  });
});

describe('recipeRegistriesOf', () => {
  function registries(): RecipeRegistries {
    const host = createPluginHost();
    host.tryActivate(
      pluginOf('first', (plugin) => {
        numbers(plugin);
        plugin.registerRecipeDerivation({
          id: 'demo.parity',
          requires: ['number'],
          produces: ['parity'],
          derive: (table) =>
            ok({
              columns: [...table.columns, { name: 'parity', type: 'text', origin: 'demo' }],
              rows: table.rows.map((row) => ({
                ...row,
                values: {
                  ...row.values,
                  parity: Number(row.values['number']) % 2 ? 'odd' : 'even',
                },
              })),
            }),
        });
      }),
    );
    return recipeRegistriesOf(host.registry);
  }

  it('runs a contributed source and a namespaced derivation beside the generic verbs', async () => {
    const { table, problem } = await run(
      registries(),
      'demo.numbers label=a',
      'derive demo.parity',
      'where parity = odd',
    );
    expect(problem).toBeUndefined();
    expect(table?.rows.map((row) => row.values)).toEqual([{ number: 1, parity: 'odd' }]);
  });

  it('checks the arguments against what the verb declared before calling it', async () => {
    const answers = await Promise.all([
      run(registries(), 'demo.numbers label=c'),
      run(registries(), 'demo.numbers colour=a'),
      run(registries(), 'demo.numbers a'),
    ]);
    expect(answers.map((answer) => answer.problem)).toEqual([
      "'demo.numbers' label is 'c', and may be a, b.",
      "'demo.numbers' does not take 'colour='; it accepts label.",
      "'demo.numbers' takes no bare word, and 'a' is one more.",
    ]);
  });

  it('lists the contributed names with the generic ones, for an unknown verb', async () => {
    const { problem } = await run(registries(), 'demo.number');
    expect(problem).toBe(
      "No verb named 'demo.number' is available. Available: age, collect, compose, decide, " +
        'demo.numbers, derive, extract, join, keep, last, map, nearest, path, recall, remember, ' +
        'rewrite, rollup, rules, run, select, show, sort, stamp, urls, where.',
    );
  });
});

describe('an action or a sink in a recipe (ADR 0129, ADR 0135)', () => {
  async function planned(plan: (table: Table) => Plan) {
    const host = createPluginHost();
    const activated = host.tryActivate(
      pluginOf(
        'first',
        (plugin) => {
          numbers(plugin);
          plugin.registerRecipeVerb({
            id: 'demo.mark',
            kind: 'action',
            arguments: [],
            writes: ['mark'],
            plan: ({ table }) => ok(plan(table)),
          });
        },
        { writes: ['mark', 'assign'] },
      ),
    );
    if (!activated.ok) throw new Error(activated.error[0]?.message);
    const parsed = parseRecipe('recipe test\ndemo.numbers\ndemo.mark\nwhere number = 2');
    if (!parsed.ok) throw new Error('the recipe must parse');
    const result = await runRecipe(parsed.value, {
      ...recipeRegistriesOf(host.registry),
      resolveRecipe: () => Promise.resolve(err([])),
    });
    if (!result.ok) throw new Error('the run must start');
    return result.value.cells;
  }

  const operations = (table: Table, write = 'mark') =>
    table.rows.map((row) => ({ write, rowKey: row.key, description: `Mark ${row.key}` }));

  it('answers a plan in its cell, writes nothing, and hands the next cell the same rows', async () => {
    const cells = await planned((table) => ({
      target: 'demo items',
      operations: operations(table),
      count: table.rows.length,
    }));
    expect(cells.map((cell) => cell.status)).toEqual(['ok', 'ok', 'ok']);
    expect(cells[1]?.plan).toEqual({
      target: 'demo items',
      operations: [
        { write: 'mark', rowKey: 'N-1', description: 'Mark N-1' },
        { write: 'mark', rowKey: 'N-2', description: 'Mark N-2' },
      ],
      count: 2,
    });
    expect(cells[1]?.table).toEqual(ROWS);
    expect(cells[2]?.table?.rows.map((row) => row.key)).toEqual(['N-2']);
  });

  it('refuses a write the verb did not declare, even one the manifest does, at its line', async () => {
    const cells = await planned((table) => ({
      target: 'demo items',
      operations: operations(table, 'assign'),
      count: table.rows.length,
    }));
    expect(cells.map((cell) => cell.status)).toEqual(['ok', 'failed', 'skipped']);
    expect(cells[1]?.plan).toBeUndefined();
    const [problem] = cells[1]?.diagnostics ?? [];
    expect(problem?.message).toBe(
      "'demo.mark' answered a plan that operation 1 writes 'assign', and the verb declares " +
        "mark; operation 2 writes 'assign', and the verb declares mark.",
    );
    expect(problem?.range).toEqual(cells[1]?.step.verbRange);
  });

  it('refuses a plan whose count is not its number of operations', async () => {
    const cells = await planned((table) => ({
      target: 'demo items',
      operations: operations(table),
      count: 1,
    }));
    expect(cells[1]?.diagnostics[0]?.message).toBe(
      "'demo.mark' answered a plan that counts 1 operations and lists 2.",
    );
  });
});
