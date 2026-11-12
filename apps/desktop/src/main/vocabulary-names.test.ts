import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { vocabularyNames } from './vocabulary-names.js';

/**
 * TYTO-402, ADR 0112: what a recipe's `@./….vocab.json#/…` completion reads, over real files.
 * The folder holds a recipe and its vocabulary; a vocabulary beside the folder, which a `..`
 * would reach, holds a name that must never come back.
 */

let scratch: string;
let recipe: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-vocabulary-names-'));
  const folder = join(scratch, 'work');
  mkdirSync(join(folder, 'shared'), { recursive: true });
  recipe = join(folder, 'weekly.recipe');
  writeFileSync(recipe, 'recipe weekly\n');
  writeFileSync(
    join(folder, 'company.vocab.json'),
    JSON.stringify({ rules: { kinds: [] }, lookups: { status: {} } }),
  );
  writeFileSync(join(folder, 'shared', 'team.vocab.json'), JSON.stringify({ rules: { team: [] } }));
  writeFileSync(join(folder, 'notes.json'), JSON.stringify({ rules: { notes: [] } }));
  writeFileSync(
    join(scratch, 'outside.vocab.json'),
    JSON.stringify({ rules: { 'outside-secret': [] } }),
  );
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the names a vocabulary reference may complete to (TYTO-402)', () => {
  it('lists the vocabulary files beside the recipe, and only those', async () => {
    expect(await vocabularyNames(recipe, undefined)).toEqual({
      files: ['company.vocab.json'],
      pointers: [],
    });
  });

  it("answers a vocabulary's pointers, in the folder or below it", async () => {
    expect((await vocabularyNames(recipe, 'company.vocab.json')).pointers).toEqual([
      '/rules/kinds',
      '/lookups/status',
    ]);
    expect((await vocabularyNames(recipe, 'shared/team.vocab.json')).pointers).toEqual([
      '/rules/team',
    ]);
  });

  it('reads nothing outside the folder, nor a file that is no vocabulary', async () => {
    const none = { files: [], pointers: [] };
    expect(await vocabularyNames(recipe, '../outside.vocab.json')).toEqual(none);
    expect(await vocabularyNames(recipe, 'shared/../../outside.vocab.json')).toEqual(none);
    expect(await vocabularyNames(recipe, join(scratch, 'outside.vocab.json'))).toEqual(none);
    expect(await vocabularyNames(recipe, 'notes.json')).toEqual(none);
    expect(await vocabularyNames(recipe, 'missing.vocab.json')).toEqual(none);
    expect(await vocabularyNames(undefined, 'company.vocab.json')).toEqual(none);
  });
});
