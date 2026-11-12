import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import { type RecipeFetch, type RecipeFetchInit, recipeStateStore } from '@tyto/io';
import type { RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import type { JsonValue, Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';
import { type RecipeRunDocument, recipeRunCommand } from './recipe-run.js';

/**
 * `tyto recipe run` (TYTO-673) through the real shared runner (ADR 0188), the real state store
 * in a scratch `TYTO_HOME` and the real trust store: only the verbs are a fixture, a source of
 * rows and a sink modelled on the example plugin's `example.mark`, handed in as the MCP tests
 * hand theirs, since no plugin process is started here.
 */

const ROWS = 120;

interface Sink {
  /** Every operation `apply` was handed, over every call. */
  readonly applied: string[];
  /** How many times the source was asked for a page. */
  pulls: number;
}

const row = (key: string) => ({
  key,
  values: { key, status: 'open' },
  provenance: { source: 'acme', id: key, fetchedAt: '2026-11-11T09:00:00.000Z' },
});

const tableOf = (count: number): Table => ({
  columns: [
    { name: 'key', type: 'text', origin: 'acme' },
    { name: 'status', type: 'text', origin: 'acme' },
  ],
  rows: Array.from({ length: count }, (_, index) => row(`EX-${String(index + 1)}`)),
});

function verbs(sink: Sink): RecipeContributions {
  const pull: RecipeVerbContribution = {
    id: 'acme.pull',
    kind: 'source',
    arguments: [{ name: 'count', type: 'number' }],
    page: ({ arguments: values }) => {
      sink.pulls += 1;
      return Promise.resolve(ok({ table: tableOf(Number(values.count ?? ROWS)) }));
    },
  };
  const mark: RecipeVerbContribution = {
    id: 'example.mark',
    kind: 'sink',
    arguments: [{ name: 'label', type: 'text', positional: true, required: true }],
    writes: ['mark'],
    plan: ({ arguments: values, table }) => {
      const label = String(values.label);
      const operations = table.rows.map((each) => ({
        write: 'mark',
        rowKey: each.key,
        description: `Mark ${each.key} as '${label}'`,
        payload: { id: `${label}/${each.key}` } as JsonValue,
      }));
      return Promise.resolve(ok({ target: 'example items', operations, count: operations.length }));
    },
    apply: ({ operations }) => {
      for (const operation of operations) sink.applied.push(operation.rowKey ?? '');
      return Promise.resolve(
        ok({ operations: operations.map(() => ({ status: 'applied' as const })) }),
      );
    },
  };
  return {
    recipeVerbs: () => [pull, mark],
    ownedRecipeVerbs: () => [
      { plugin: 'example', verb: pull },
      { plugin: 'example', verb: mark },
    ],
    recipeDerivations: () => [],
  };
}

/** A recipe whose sink plans one operation per row: 120 of them. */
const SYNC = [
  'recipe sync',
  'param label = done',
  'acme.pull',
  'remember pushed columns=status',
  'example.mark {label}',
  '',
].join('\n');

/** TYTO-650: a recipe whose one plan holds no operation, so a Run commits its `remember`. */
const AGREE = [
  'recipe agree',
  'acme.pull',
  'remember pushed columns=status',
  'where status = closed',
  'example.mark done',
  '',
].join('\n');

let scratch: string;
let workspace: string;
let home: string;
let out: string;
let err: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-run-')));
  workspace = join(scratch, 'promo');
  home = join(scratch, 'home');
  await mkdir(join(workspace, '.tyto'), { recursive: true });
  await mkdir(join(workspace, 'recipes'), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(workspace, '.tyto', 'project.json'), '{}');
  await writeFile(join(workspace, 'recipes', 'sync.recipe'), SYNC);
  await writeFile(join(workspace, 'recipes', 'agree.recipe'), AGREE);
  out = '';
  err = '';
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function environment(variables: Record<string, string> = {}): CliEnvironment {
  return {
    console: {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
    version: '0.0.0-test',
    cwd: workspace,
    home,
    variables,
    confirm: () => Promise.resolve(true),
    rasterizer: () => {
      throw new Error('a recipe run starts no browser');
    },
  };
}

async function trust(): Promise<void> {
  expect(await run(['trust', 'add', workspace], environment())).toBe(EXIT_OK);
  out = '';
  err = '';
}

const newSink = (): Sink => ({ applied: [], pulls: 0 });

/** What the recipe's store holds, by key. */
async function stored(recipe: string, store = 'pushed'): Promise<Record<string, unknown>> {
  const entries = await recipeStateStore({
    home,
    workspace,
    recipe: join(workspace, 'recipes', recipe),
  }).entries(store);
  if (!entries.ok) throw new Error('the store did not read');
  return Object.fromEntries([...entries.value].map(([key, entry]) => [key, entry.values]));
}

describe('tyto recipe run', () => {
  it('prints all 120 operations with --json, and writes nothing and commits no state', async () => {
    await trust();
    const sink = newSink();

    const code = await recipeRunCommand('recipes/sync.recipe', { json: true }, environment(), {
      contributions: verbs(sink),
    });

    expect(err).toBe('');
    expect(code).toBe(EXIT_OK);
    const document = JSON.parse(out) as RecipeRunDocument;
    expect(document).toMatchObject({
      recipe: join('recipes', 'sync.recipe'),
      workspace: { trust: 'trusted' },
      apply: false,
      status: 'ok',
    });
    expect(document.cells.map((cell) => cell.status)).toEqual(['ok', 'ok', 'ok']);
    const table = document.cells[0]?.table;
    expect(table?.total).toBe(ROWS);
    expect(table?.rows).toHaveLength(ROWS);
    expect(table?.rows[ROWS - 1]?.provenance.id).toBe('EX-120');
    const plan = document.cells[2]?.plan;
    expect(plan).toMatchObject({ count: ROWS, applicable: true, target: 'example items' });
    expect(plan?.operations).toHaveLength(ROWS);
    expect(plan?.operations[ROWS - 1]).toEqual({
      write: 'mark',
      rowKey: 'EX-120',
      description: "Mark EX-120 as 'done'",
      payload: { id: 'done/EX-120' },
    });
    expect(document.cells[2]?.applied).toBeUndefined();
    expect(sink.applied).toEqual([]);
    expect(await stored('sync.recipe')).toEqual({});
  });

  it('prints every operation as text, with the value --param gave', async () => {
    await trust();

    const code = await recipeRunCommand(
      'recipes/sync.recipe',
      { param: { label: 'shipped' } },
      environment(),
      { contributions: verbs(newSink()) },
    );

    expect(code).toBe(EXIT_OK);
    expect(out).toContain('cell 1 (line 3): ok, 120 rows');
    expect(out).toContain('plan: 120 operations on example items');
    const operations = out.split('\n').filter((line) => line.startsWith('    mark EX-'));
    expect(operations).toHaveLength(ROWS);
    expect(operations[ROWS - 1]).toBe("    mark EX-120: Mark EX-120 as 'shipped'");
  });

  it('commits no state for a run whose plans hold no operation, until --apply', async () => {
    await trust();

    const planned = await recipeRunCommand('recipes/agree.recipe', { json: true }, environment(), {
      contributions: verbs(newSink()),
    });
    expect(planned).toBe(EXIT_OK);
    expect((JSON.parse(out) as RecipeRunDocument).cells[3]?.plan?.count).toBe(0);
    expect(await stored('agree.recipe')).toEqual({});

    const applied = await recipeRunCommand('recipes/agree.recipe', { apply: true }, environment(), {
      contributions: verbs(newSink()),
    });
    expect(applied).toBe(EXIT_OK);
    expect(Object.keys(await stored('agree.recipe'))).toHaveLength(ROWS);
  });

  it('hands the sink every operation and commits the state with --apply in a trusted folder', async () => {
    await trust();
    const sink = newSink();

    const code = await recipeRunCommand(
      'recipes/sync.recipe',
      { json: true, apply: true },
      environment(),
      { contributions: verbs(sink) },
    );

    expect(code).toBe(EXIT_OK);
    expect(sink.applied).toHaveLength(ROWS);
    expect(new Set(sink.applied).size).toBe(ROWS);
    const document = JSON.parse(out) as RecipeRunDocument;
    expect(document.apply).toBe(true);
    const applied = document.cells[2]?.applied?.operations ?? [];
    expect(applied).toHaveLength(ROWS);
    expect(applied.every((operation) => operation.status === 'applied')).toBe(true);
    const state = await stored('sync.recipe');
    expect(Object.keys(state)).toHaveLength(ROWS);
    expect(state['EX-120']).toMatchObject({ status: 'open', applied_at: expect.any(String) });
  });

  it('applies an apply auto recipe once under --apply', async () => {
    await trust();
    await writeFile(
      join(workspace, 'recipes', 'sync.recipe'),
      SYNC.replace('recipe sync\n', 'recipe sync\napply auto\n'),
    );
    const sink = newSink();

    const code = await recipeRunCommand('recipes/sync.recipe', { apply: true }, environment(), {
      contributions: verbs(sink),
    });

    expect(code).toBe(EXIT_OK);
    expect(sink.applied).toHaveLength(ROWS);
    expect(Object.keys(await stored('sync.recipe'))).toHaveLength(ROWS);
  });

  it('plans an apply auto recipe without --apply in a trusted folder, and applies nothing', async () => {
    // TYTO-684: the window's command panel refuses only `--apply`, because a plan-only run of
    // an `apply auto` recipe is a save's, not a Run's, and so applies nothing (ADR 0170).
    await trust();
    await writeFile(
      join(workspace, 'recipes', 'sync.recipe'),
      SYNC.replace('recipe sync\n', 'recipe sync\napply auto\n'),
    );
    const sink = newSink();

    const code = await recipeRunCommand('recipes/sync.recipe', { json: true }, environment(), {
      contributions: verbs(sink),
    });

    expect(code).toBe(EXIT_OK);
    expect(sink.pulls).toBe(1);
    expect(sink.applied).toEqual([]);
    const document = JSON.parse(out) as RecipeRunDocument;
    expect(document.cells[2]?.plan?.operations).toHaveLength(ROWS);
    expect(document.cells[2]?.applied).toBeUndefined();
    expect(await stored('sync.recipe')).toEqual({});
  });

  it('refuses --apply in a restricted folder before any cell runs', async () => {
    const sink = newSink();

    const code = await recipeRunCommand('recipes/sync.recipe', { apply: true }, environment(), {
      contributions: verbs(sink),
    });

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(err).toContain('--apply applies a recipe');
    expect(err).toContain('a workspace folder nobody trusted');
    expect(out).toBe('');
    expect(sink.pulls).toBe(0);
    expect(sink.applied).toEqual([]);
    expect(await stored('sync.recipe')).toEqual({});
  });

  it('control: plans in a restricted folder without --apply, and commits nothing', async () => {
    const sink = newSink();

    const code = await recipeRunCommand('recipes/agree.recipe', { json: true }, environment(), {
      contributions: verbs(sink),
    });

    expect(code).toBe(EXIT_OK);
    const document = JSON.parse(out) as RecipeRunDocument;
    expect(document.workspace).toMatchObject({ trust: 'restricted' });
    expect(document.cells.map((cell) => cell.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(sink.pulls).toBe(1);
    expect(sink.applied).toEqual([]);
    expect(await stored('agree.recipe')).toEqual({});
  });

  it('exits 1 when a cell failed, and says why on stderr', async () => {
    await trust();
    await writeFile(join(workspace, 'recipes', 'broken.recipe'), 'recipe broken\nnope.verb\n');

    const code = await recipeRunCommand('recipes/broken.recipe', {}, environment(), {
      contributions: verbs(newSink()),
    });

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(out).toContain('cell 1 (line 2): failed');
    expect(err).toContain('nope.verb');
  });

  it('exits 1 for a parameter the recipe does not declare', async () => {
    await trust();

    const code = await recipeRunCommand(
      'recipes/sync.recipe',
      { json: true, param: { colour: 'red' } },
      environment(),
      { contributions: verbs(newSink()) },
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(out).toContain('E_RECIPE_PARAM');
  });

  it('exits 1 for a bad command line: a --param without a value, a file that is no recipe', async () => {
    expect(
      await run(['recipe', 'run', 'recipes/sync.recipe', '--param', 'label'], environment()),
    ).toBe(EXIT_DIAGNOSTICS);
    expect(err).toContain('<name>=<value>');
    expect(await run(['recipe', 'run', '.tyto/project.json'], environment())).toBe(
      EXIT_DIAGNOSTICS,
    );
    expect(err).toContain('runs a .recipe file');
  });
});

/** TYTO-671, ADR 0193 decision 5: the CLI lends `call` a `send` under `--apply` only. */
describe('tyto recipe run and call', () => {
  const TOKEN = 'tok-cli-never-printed';
  const DISPATCH = [
    'recipe dispatch',
    'acme.pull count=2',
    'call url=https://hooks.example.com/run token=routine body={"key": "{key|}"}',
    '',
  ].join('\n');

  beforeEach(async () => {
    await writeFile(
      join(workspace, '.tyto', 'project.json'),
      JSON.stringify({ recipes: { call: { hosts: ['hooks.example.com'] } } }),
    );
    await writeFile(join(workspace, 'recipes', 'dispatch.recipe'), DISPATCH);
  });

  function recording(): { readonly fetch: RecipeFetch; readonly sent: RecipeFetchInit[] } {
    const sent: RecipeFetchInit[] = [];
    return {
      sent,
      fetch: (_url, init) => {
        sent.push(init);
        return Promise.resolve({ status: 204, body: null });
      },
    };
  }

  it('sends one request per row with the environment credential under --apply', async () => {
    await trust();
    const { fetch, sent } = recording();

    const code = await recipeRunCommand(
      'recipes/dispatch.recipe',
      { json: true, apply: true },
      environment({ TYTO_RECIPE_CREDENTIAL_ROUTINE: TOKEN }),
      { contributions: verbs(newSink()), fetch },
    );

    expect(err).toBe('');
    expect(code).toBe(EXIT_OK);
    expect(sent.map((init) => init.body)).toEqual(['{"key":"EX-1"}', '{"key":"EX-2"}']);
    expect(Object.values(sent[0]?.headers ?? {})).toContain(`Bearer ${TOKEN}`);
    expect(out).not.toContain(TOKEN);
    const applied = (JSON.parse(out) as RecipeRunDocument).cells[1]?.applied?.operations;
    expect(applied?.map((operation) => operation.status)).toEqual(['applied', 'applied']);
  });

  it('control: sends nothing without --apply, and plans both requests', async () => {
    await trust();
    const { fetch, sent } = recording();

    const code = await recipeRunCommand(
      'recipes/dispatch.recipe',
      { json: true },
      environment({ TYTO_RECIPE_CREDENTIAL_ROUTINE: TOKEN }),
      { contributions: verbs(newSink()), fetch },
    );

    expect(code).toBe(EXIT_OK);
    expect(sent).toEqual([]);
    expect((JSON.parse(out) as RecipeRunDocument).cells[1]?.plan?.count).toBe(2);
  });
});
