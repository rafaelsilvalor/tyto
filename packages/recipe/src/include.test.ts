import { type Diagnostic, type Result, err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import campaignJson from './__fixtures__/campaign.json';
import campaignMap from './__fixtures__/campaign-map.recipe?raw';
import { pairKey } from './__fixtures__/pair-key.js';
import type { RecipeAst } from './ast.js';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { Table } from './table.js';

const campaign = campaignJson as unknown as Table;

function parsed(text: string): RecipeAst {
  const result = parseRecipe(text);
  if (!result.ok) throw new Error(result.error.map(({ message }) => message).join('\n'));
  return result.value;
}

/** A host's resolver over files held in memory, as the pure package sees any host. */
function library(files: Record<string, string>) {
  const asked: string[] = [];
  const resolve = (name: string): Promise<Result<RecipeAst, readonly Diagnostic[]>> => {
    asked.push(name);
    const text = files[name];
    return Promise.resolve(text === undefined ? err([]) : ok(parsed(text)));
  };
  return { resolve, asked };
}

async function run(lines: readonly string[], files: Record<string, string>) {
  const source = ['recipe outer', ...lines].join('\n');
  const derivations = createDerivationRegistry();
  derivations.register('pair-key', pairKey);
  const { resolve, asked } = library(files);
  const result = await runRecipe(parsed(source), {
    input: campaign,
    verbs: createVerbRegistry(),
    derivations,
    resolveRecipe: resolve,
  });
  if (!result.ok) throw new Error('the run must start');
  const problem = result.value.cells.flatMap((cell) => cell.diagnostics)[0];
  const at = problem?.range ? source.slice(problem.range.start, problem.range.end) : undefined;
  return { result: result.value, problem, at, asked };
}

describe('run', () => {
  it('includes a recipe at its line, and the lines after it read what it produced', async () => {
    const { result } = await run(['run campaign-map', 'where copy_match = paired', 'show board'], {
      'campaign-map': campaignMap,
    });
    expect(result.cells.map((cell) => cell.status)).toEqual(['ok', 'ok', 'ok']);
    expect(result.table?.rows.map((row) => row.key)).toEqual(['DEMO-101', 'DEMO-103']);
    expect(result.view).toBe('board');
    expect(result.keeps.map((kept) => kept.name)).toEqual(['campaign-map']);
  });

  it('passes its name=value pairs as the included recipe parameters', async () => {
    const { result } = await run(['run campaign-map team=social'], { 'campaign-map': campaignMap });
    expect(result.table?.rows.map((row) => row.key)).toEqual(['DEMO-401']);
  });

  it('lists the parameters the recipe declares when given one it does not', async () => {
    const { problem, at } = await run(['run campaign-map parent=DEMO-1'], {
      'campaign-map': campaignMap,
    });
    expect(problem?.message).toBe(
      "Parameter 'parent' is not a parameter of recipe 'campaign-map', which declares team.",
    );
    expect(at).toBe('parent=DEMO-1');
  });

  it('refuses a cycle before reading a recipe twice', async () => {
    const { problem, at, asked } = await run(['run first'], {
      first: 'recipe first\nrun second',
      second: 'recipe second\nrun first',
    });
    expect(problem?.code).toBe('E_RECIPE_RUN');
    expect(problem?.message).toBe(
      "'run first' would run a recipe that is already running: outer → first → second → first.",
    );
    expect(problem?.hint).toBe("In recipe 'first'. In recipe 'second'.");
    expect(at).toBe('run first');
    expect(asked).toEqual(['first', 'second']);
  });

  it('refuses a recipe that names itself under another file name', async () => {
    const { problem } = await run(['run alias'], { alias: 'recipe outer\nshow table' });
    expect(problem?.message).toContain('outer → outer');
  });

  it('says when no recipe answers to the name', async () => {
    const { problem } = await run(['run nowhere'], {});
    expect(problem?.message).toBe("'run nowhere' names no recipe that was found.");
  });

  it('reports a failure inside the included recipe at the run line', async () => {
    const { result, problem, at } = await run(['run broken', 'show table'], {
      broken: 'recipe broken\nwhere colour = red',
    });
    expect(problem?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    expect(problem?.hint).toBe("In recipe 'broken'.");
    expect(at).toBe('run broken');
    expect(result.cells.map((cell) => cell.status)).toEqual(['failed', 'skipped']);
  });
});
