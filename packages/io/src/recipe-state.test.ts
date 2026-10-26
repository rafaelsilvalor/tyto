import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RecipeState } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RECIPE_STATE_LIMIT_BYTES, recipeStateStore } from './recipe-state.js';

/** A scratch `TYTO_HOME` and two workspaces, on a clock a test moves. */
let scratch: string;
let home: string;
let workspace: string;
let other: string;
let clock: Date;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tyto-recipe-state-'));
  home = join(scratch, 'home');
  workspace = join(scratch, 'workspace');
  other = join(scratch, 'other');
  await mkdir(join(workspace, 'flows'), { recursive: true });
  await mkdir(join(other, 'flows'), { recursive: true });
  clock = new Date('2026-10-25T12:00:00.000Z');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const store = (recipe = 'flows/sync.recipe', folder = workspace): RecipeState =>
  recipeStateStore({ home, workspace: folder, recipe, now: () => clock });

/** The store's file the ADR names: sha256(workspace realpath, newline, relative recipe path). */
async function fileOf(name: string, recipe = 'flows/sync.recipe', folder = workspace) {
  const identity = createHash('sha256')
    .update(`${await realpath(folder)}\n${recipe}`, 'utf8')
    .digest('hex');
  return join(home, 'state', 'recipes', identity, `${name}.json`);
}

async function entriesOf(state: RecipeState, name: string, keys: readonly string[]) {
  const read = await state.read(name, keys);
  if (!read.ok) throw new Error(read.error.map(({ message }) => message).join('\n'));
  return Object.fromEntries(read.value);
}

async function written(state: RecipeState, ...args: Parameters<RecipeState['write']>) {
  const result = await state.write(...args);
  if (!result.ok) throw new Error(result.error.map(({ message }) => message).join('\n'));
}

describe('recipeStateStore', () => {
  it("writes and reads entries back, dated by the host's clock, under the hashed identity", async () => {
    const state = store();
    await written(state, 'sync', [{ key: 'A-1', values: { status: 'done', tags: ['x', 1] } }], []);

    expect(await entriesOf(state, 'sync', ['A-1', 'A-2'])).toEqual({
      'A-1': { values: { status: 'done', tags: ['x', 1] }, storedAt: '2026-10-25T12:00:00.000Z' },
    });
    expect(JSON.parse(await readFile(await fileOf('sync'), 'utf8'))).toEqual({
      version: 1,
      entries: {
        'A-1': { values: { status: 'done', tags: ['x', 1] }, storedAt: '2026-10-25T12:00:00.000Z' },
      },
    });
    // A fresh adapter over the same paths is the next run, and finds the same entry.
    expect(Object.keys(await entriesOf(store(), 'sync', ['A-1']))).toEqual(['A-1']);
  });

  it('reads a store never written as empty, not as an error', async () => {
    expect(await entriesOf(store(), 'sync', ['A-1'])).toEqual({});
  });

  // The scenario PR1's `memoryState` (recipe's state-harness.ts) answers this way: deletes
  // first, then each put's values merged over what its key holds, stamped with now.
  it('deletes first, then merges puts over the stored values, as the harness fake does', async () => {
    const state = store();
    await written(
      state,
      'sync',
      [
        { key: 'A-1', values: { status: 'todo', owner: 'ana' } },
        { key: 'A-2', values: { status: 'todo' } },
        { key: 'A-3', values: { status: 'doing' } },
      ],
      [],
    );
    clock = new Date('2026-10-26T08:00:00.000Z');
    await written(
      state,
      'sync',
      [
        { key: 'A-1', values: { status: 'done' } },
        { key: 'A-2', values: { owner: 'bia' } },
      ],
      ['A-2', 'A-3'],
    );

    expect(await entriesOf(state, 'sync', ['A-1', 'A-2', 'A-3'])).toEqual({
      'A-1': { values: { status: 'done', owner: 'ana' }, storedAt: '2026-10-26T08:00:00.000Z' },
      'A-2': { values: { owner: 'bia' }, storedAt: '2026-10-26T08:00:00.000Z' },
    });
  });

  it('keeps each store in its own file', async () => {
    const state = store();
    await written(state, 'sync', [{ key: 'A-1', values: { status: 'done' } }], []);
    await written(state, 'parents', [{ key: 'A-1', values: { status: 'todo' } }], []);

    expect((await entriesOf(state, 'sync', ['A-1']))['A-1']?.values).toEqual({ status: 'done' });
    expect((await entriesOf(state, 'parents', ['A-1']))['A-1']?.values).toEqual({
      status: 'todo',
    });
  });

  it('gives two recipes in one workspace separate state', async () => {
    await written(store('flows/sync.recipe'), 'sync', [{ key: 'A-1', values: { a: 1 } }], []);

    expect(await entriesOf(store('flows/other.recipe'), 'sync', ['A-1'])).toEqual({});
  });

  it('gives the same recipe path in two workspaces separate state', async () => {
    await written(store('flows/sync.recipe', workspace), 'sync', [{ key: 'A-1', values: {} }], []);

    expect(await entriesOf(store('flows/sync.recipe', other), 'sync', ['A-1'])).toEqual({});
    expect(await readdir(join(home, 'state', 'recipes'))).toHaveLength(1);
  });

  it('starts a renamed recipe from no state, by design (ADR 0140 decision 3)', async () => {
    await written(store('flows/sync.recipe'), 'sync', [{ key: 'A-1', values: { a: 1 } }], []);

    expect(await entriesOf(store('flows/renamed.recipe'), 'sync', ['A-1'])).toEqual({});
  });

  it('names a recipe by its path inside the workspace, however the path is given', async () => {
    await written(store(join(workspace, 'flows', 'sync.recipe')), 'sync', [], []);

    expect(await readFile(await fileOf('sync'), 'utf8')).toBe('{"version":1,"entries":{}}');
  });

  it('refuses a corrupt store instead of reading it as a first run', async () => {
    const file = await fileOf('sync');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, '{"version":1,"entries":', 'utf8');

    const read = await store().read('sync', ['A-1']);
    expect(read.ok ? 'read' : read.error.map(({ code, message }) => [code, message])).toEqual([
      [
        'E_RECIPE_STATE',
        `Recipe state 'sync' cannot be read: ${file} is not JSON; fix or delete it.`,
      ],
    ]);
    // Nor is it overwritten: a write merges over what the store holds, and it holds nothing known.
    const write = await store().write('sync', [{ key: 'A-1', values: {} }], []);
    expect(write.ok ? 'written' : write.error.map(({ code }) => code)).toEqual(['E_RECIPE_STATE']);
    expect(await readFile(file, 'utf8')).toBe('{"version":1,"entries":');
  });

  it('refuses a store of another shape or version', async () => {
    const file = await fileOf('sync');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 2, entries: {} }), 'utf8');

    const read = await store().read('sync', ['A-1']);
    expect(read.ok ? 'read' : read.error.map(({ message }) => message)).toEqual([
      `Recipe state 'sync' cannot be read: ${file} is not a version 1 store; fix or delete it.`,
    ]);
  });

  it('refuses a store over the ceiling, read or written, and writes nothing', async () => {
    const big = 'x'.repeat(RECIPE_STATE_LIMIT_BYTES);
    const write = await store().write('sync', [{ key: 'A-1', values: { big } }], []);
    expect(write.ok ? 'written' : write.error.map(({ code }) => code)).toEqual(['E_RECIPE_STATE']);
    expect(write.ok ? '' : write.error[0]?.message).toContain(
      `the ceiling is ${String(RECIPE_STATE_LIMIT_BYTES)}`,
    );
    await expect(readFile(await fileOf('sync'))).rejects.toMatchObject({ code: 'ENOENT' });

    const file = await fileOf('sync');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, ' '.repeat(RECIPE_STATE_LIMIT_BYTES + 1), 'utf8');
    const read = await store().read('sync', ['A-1']);
    expect(read.ok ? 'read' : read.error.map(({ code }) => code)).toEqual(['E_RECIPE_STATE']);
  });

  it('makes concurrent writes in one process take turns, so none is lost', async () => {
    const state = store();
    const keys = Array.from({ length: 20 }, (_, index) => `A-${String(index)}`);
    const results = await Promise.all(
      keys.map((key) => state.write('sync', [{ key, values: { n: key } }], [])),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(Object.keys(await entriesOf(state, 'sync', keys))).toEqual(keys);
  });

  it.each(['', '../sync', 'a/b', 'a\\b', '-sync', 'sync.json', 'CON', 'nul', 'Com1'])(
    'refuses %j as a store name, touching no file',
    async (name) => {
      const read = await store().read(name, ['A-1']);
      const write = await store().write(name, [{ key: 'A-1', values: {} }], []);

      expect(read.ok ? 'read' : read.error.map(({ code }) => code)).toEqual(['E_RECIPE_STATE']);
      expect(write.ok ? 'written' : write.error.map(({ code }) => code)).toEqual([
        'E_RECIPE_STATE',
      ]);
      await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
