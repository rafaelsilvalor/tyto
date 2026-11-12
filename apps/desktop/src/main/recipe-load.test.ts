import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RECIPE_LOAD_FILES_MAX, loadRecipe } from './recipe-load.js';

/**
 * TYTO-402, ADR 0176 decision 7: Load recipe over real folders. `shared/` is where a colleague's
 * recipe sits; beside it, where a `..` reaches, is a file that must never be read; `work/` is
 * the workspace folder the copy lands in.
 */

let scratch: string;
let shared: string;
let work: string;

const MAIN = [
  'recipe weekly',
  'run cleanup',
  'rules into=kind using=@./company.vocab.json#/rules/kinds',
  'compose label=@./data/labels.json#/label',
  'compose secret=@../secret.json#/x',
  'compose broken=@./notes.json#nopointer',
  '',
].join('\n');

const CLEANUP = [
  'recipe cleanup',
  'rewrite title using=@./company.vocab.json#/rewrites/a',
  '',
].join('\n');

const listed = (folder: string): string[] =>
  readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .map((name) => name.replaceAll('\\', '/'))
    .sort();

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-load-'));
  shared = join(scratch, 'shared');
  work = join(scratch, 'work');
  mkdirSync(join(shared, 'data'), { recursive: true });
  mkdirSync(work);
  writeFileSync(join(shared, 'weekly.recipe'), MAIN);
  writeFileSync(join(shared, 'cleanup.recipe'), CLEANUP);
  writeFileSync(join(shared, 'company.vocab.json'), '{ "rules": { "kinds": [] } }');
  writeFileSync(join(shared, 'data', 'labels.json'), '{ "label": "{title}" }');
  writeFileSync(join(scratch, 'secret.json'), '{ "x": "never read" }');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('Load recipe (TYTO-402, ADR 0176)', () => {
  it('copies the recipe, the recipe it runs and the files both name, and reports the rest', async () => {
    const loaded = await loadRecipe(join(shared, 'weekly.recipe'), work);

    expect(loaded).toEqual({
      ok: true,
      recipe: join(work, 'weekly.recipe'),
      copied: ['weekly.recipe', 'cleanup.recipe', 'company.vocab.json', 'data/labels.json'],
      skipped: [],
      reported: [
        { name: '@./notes.json#nopointer', reason: 'refused' },
        { name: '../secret.json', reason: 'leaves-folder' },
      ],
    });
    expect(listed(work)).toEqual([
      'cleanup.recipe',
      'company.vocab.json',
      'data',
      'data/labels.json',
      'weekly.recipe',
    ]);
    expect(readFileSync(join(work, 'weekly.recipe'), 'utf8')).toBe(MAIN);
    expect(existsSync(join(work, 'secret.json'))).toBe(false);
  });

  it('writes nothing when any file is already there, and names each one taken', async () => {
    writeFileSync(join(work, 'company.vocab.json'), 'mine');

    const loaded = await loadRecipe(join(shared, 'weekly.recipe'), work);

    expect(loaded).toMatchObject({
      ok: true,
      recipe: undefined,
      copied: [],
      skipped: ['company.vocab.json'],
    });
    expect(listed(work)).toEqual(['company.vocab.json']);
    expect(readFileSync(join(work, 'company.vocab.json'), 'utf8')).toBe('mine');
  });

  it('counts a file where a folder must go as taken', async () => {
    writeFileSync(join(work, 'data'), 'a file');

    const loaded = await loadRecipe(join(shared, 'weekly.recipe'), work);

    expect(loaded).toMatchObject({ copied: [], skipped: ['data/labels.json'] });
    expect(listed(work)).toEqual(['data']);
  });

  it('reports a missing file, a recipe that does not parse and a .tyto path, and copies the rest', async () => {
    writeFileSync(
      join(shared, 'weekly.recipe'),
      [
        'recipe weekly',
        'run broken',
        'compose a=@./gone.json#/a',
        'compose b=@./.tyto/project.json#/b',
        '',
      ].join('\n'),
    );
    writeFileSync(join(shared, 'broken.recipe'), 'this is not a recipe\n');

    const loaded = await loadRecipe(join(shared, 'weekly.recipe'), work);

    expect(loaded).toMatchObject({
      ok: true,
      copied: ['weekly.recipe', 'broken.recipe'],
      reported: [
        { name: './gone.json', reason: 'missing' },
        { name: './.tyto/project.json', reason: 'reserved' },
        { name: 'broken.recipe', reason: 'not-parsed' },
      ],
    });
  });

  it('never reads through a link inside the folder that leads out of it (ADR 0112)', async () => {
    // A junction needs no privilege on Windows; elsewhere the type is ignored and it is a link.
    symlinkSync(scratch, join(shared, 'linked'), 'junction');
    writeFileSync(
      join(shared, 'weekly.recipe'),
      'recipe weekly\ncompose s=@./linked/secret.json#/x\n',
    );

    const loaded = await loadRecipe(join(shared, 'weekly.recipe'), work);

    expect(loaded).toMatchObject({
      ok: true,
      copied: ['weekly.recipe'],
      reported: [{ name: './linked/secret.json', reason: 'outside' }],
    });
    expect(listed(work)).toEqual(['weekly.recipe']);
  });

  it('follows a run cycle once', async () => {
    writeFileSync(join(shared, 'cleanup.recipe'), 'recipe cleanup\nrun weekly\n');

    const loaded = await loadRecipe(join(shared, 'weekly.recipe'), work);

    expect(loaded).toMatchObject({ ok: true });
    expect(loaded.ok && loaded.copied.filter((name) => name.endsWith('.recipe'))).toEqual([
      'weekly.recipe',
      'cleanup.recipe',
    ]);
  });

  it('refuses a file that is not a .recipe, and one that is not there', async () => {
    await expect(loadRecipe(join(shared, 'company.vocab.json'), work)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
    await expect(loadRecipe(join(shared, 'nothing.recipe'), work)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(listed(work)).toEqual([]);
  });

  // 203 files read and 200 written: seconds on a loaded machine, not the default five.
  it(`stops at ${String(RECIPE_LOAD_FILES_MAX)} files and reports the rest`, async () => {
    const lines = ['recipe weekly'];
    for (let index = 0; index < RECIPE_LOAD_FILES_MAX + 2; index += 1) {
      writeFileSync(join(shared, `f${String(index)}.json`), '{}');
      lines.push(`compose c=@./f${String(index)}.json#/x`);
    }
    writeFileSync(join(shared, 'weekly.recipe'), `${lines.join('\n')}\n`);

    const loaded = await loadRecipe(join(shared, 'weekly.recipe'), work);

    expect(loaded.ok && loaded.copied.length).toBe(RECIPE_LOAD_FILES_MAX);
    expect(loaded.ok && loaded.reported.map((each) => each.reason)).toEqual([
      'too-many',
      'too-many',
      'too-many',
    ]);
  }, 30_000);
});
