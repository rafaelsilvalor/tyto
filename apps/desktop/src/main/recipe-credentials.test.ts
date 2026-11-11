import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import {
  type RecipeFetch,
  type RecipeFetchInit,
  type RecipePlace,
  createRecipeRunner,
} from '@tyto/io';
import type { RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import type { RunClock, Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileCredentialStore } from './credential-store.js';
import { type SafeStorage, createCredentials } from './credentials.js';
import { desktopRecipeCalls, recipeCredentialStore } from './recipe-credentials.js';

/**
 * A recipe's `call` credentials on the desktop (TYTO-671, ADR 0193), as main composes them: the
 * keychain store over real files, and the runner `index.ts` builds, lent the same `calls`. The
 * network is the one thing faked: `fetch` is injected, since `call` sends only to `https:` and a
 * test cannot serve that without a certificate. What it proves is that the window **sends**,
 * with the stored value in the header and nowhere in a plan.
 */

const NOW = '2026-11-11T12:00:00.000Z';
const clock: RunClock = { now: () => new Date(NOW), offsetMinutes: () => 0 };
const SECRET = 'value-that-must-stay-in-main';

/** Stands in for the OS key: reversible, and visibly not the plaintext on disk. */
const encryption: SafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) => Buffer.from(plainText, 'utf8').reverse(),
  decryptString: (encrypted) => Buffer.from(encrypted).reverse().toString('utf8'),
};

const TASKS: Table = {
  columns: [{ name: 'title', type: 'text', origin: 'demo' }],
  rows: ['First', 'Second'].map((title) => ({
    key: title,
    values: { title },
    provenance: { source: 'demo', id: title, fetchedAt: NOW },
  })),
};

const rows: RecipeVerbContribution = {
  id: 'demo.rows',
  kind: 'source',
  arguments: [],
  page: () => Promise.resolve(ok({ table: TASKS })),
};

const contributions: RecipeContributions = {
  recipeVerbs: () => [rows],
  ownedRecipeVerbs: () => [{ plugin: 'demo', verb: rows }],
  recipeDerivations: () => [],
};

const RECIPE = [
  'recipe dispatch',
  'demo.rows',
  'call url=https://hooks.example.com/run token=routine body={"title":"{title|}"}',
  '',
].join('\n');

let scratch: string;
let keychain: string;
let workspace: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-credentials-')));
  keychain = join(scratch, 'credentials');
  workspace = join(scratch, 'work');
  await mkdir(join(workspace, 'recipes'), { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function store() {
  const credentials = createCredentials({ encryption, store: fileCredentialStore(keychain) });
  return { credentials, recipes: recipeCredentialStore(credentials) };
}

describe('the recipe credential store', () => {
  it('keeps recipe:<name> as ciphertext, lists names only, and forgets the file', async () => {
    const { credentials, recipes } = store();
    await credentials.set('plugin:pdf:routine', 'a plugin key');
    await credentials.set('signin:drive-plugin:drive', 'a refresh token');

    expect(await recipes.set('routine', SECRET)).toEqual({ stored: true });
    expect(await recipes.set('second-hook', 'other')).toEqual({ stored: true });

    const files = (await readdir(keychain)).sort();
    expect(files).toContain('recipe%3Aroutine.bin');
    const onDisk = await readFile(join(keychain, 'recipe%3Aroutine.bin'), 'utf8');
    expect(onDisk).not.toContain(SECRET);

    const listed = await recipes.list();
    expect(listed).toEqual({ names: ['routine', 'second-hook'] });
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(await recipes.read('routine')).toBe(SECRET);

    expect(await recipes.forget('routine')).toEqual({ forgotten: true });
    expect(await readdir(keychain)).not.toContain('recipe%3Aroutine.bin');
    expect(await recipes.read('routine')).toBeUndefined();
    expect(await recipes.forget('routine')).toEqual({ forgotten: false });
    // A plugin's key of the same name was never a recipe credential, and is still there.
    expect(await credentials.get('plugin:pdf:routine')).toBe('a plugin key');
  });

  it('refuses a name token= refuses, so nothing reaches another account', async () => {
    const { credentials, recipes } = store();
    for (const name of ['Routine', '../plugin:pdf:k', 'a:b', '']) {
      await expect(recipes.set(name, 'x')).rejects.toThrow(/not a recipe credential's name/u);
      expect(await recipes.read(name)).toBeUndefined();
    }
    expect(await credentials.accounts('')).toEqual([]);
  });

  it('lists nothing when no credential was ever stored', async () => {
    expect(await store().recipes.list()).toEqual({ names: [] });
  });
});

describe('call in the window', () => {
  function harness(trust: RecipePlace['trust'] = 'trusted') {
    const { recipes } = store();
    const sent: { url: string; init: RecipeFetchInit }[] = [];
    const fetch: RecipeFetch = (url, init) => {
      sent.push({ url, init });
      return Promise.resolve({ status: 200, body: null });
    };
    const runner = createRecipeRunner({
      contributions,
      placeOf: () => Promise.resolve(trust === 'none' ? { trust } : { trust, folder: workspace }),
      sectionFor: () => undefined,
      home: join(scratch, 'home'),
      clock: () => clock,
      calls: desktopRecipeCalls({
        hostsFor: () => ['hooks.example.com'],
        credentials: recipes,
        fetch,
      }),
    });
    const path = join(workspace, 'recipes', 'dispatch.recipe');
    const plan = () => runner.run({ documentId: 'tab-1', text: RECIPE, path, explicit: true });
    const apply = (planId: number) => runner.apply({ documentId: 'tab-1', index: 1, planId, path });
    return { recipes, sent, plan, apply };
  }

  it('refuses to plan until the credential is stored, naming where to store it', async () => {
    const { plan } = harness();
    const cell = (await plan()).cells[1];
    const message = cell?.diagnostics.map((found) => found.message).join('\n') ?? '';
    expect(message).toContain("no credential named 'routine'");
    expect(message).toContain('Recipe credentials');
  });

  it('plans without "sends none" once stored, and Apply sends with the value in the header', async () => {
    const { recipes, sent, plan, apply } = harness();
    await recipes.set('routine', SECRET);

    const answer = await plan();
    const cell = answer.cells[1];
    expect(cell?.diagnostics).toEqual([]);
    expect(cell?.applicable).toBe(true);
    expect(JSON.stringify(cell?.plan)).not.toContain('sends none');
    expect(JSON.stringify(answer)).not.toContain(SECRET);
    expect(sent).toEqual([]);

    const applied = await apply(cell?.planId ?? -1);
    expect(applied?.applied?.operations.map((operation) => operation.status)).toEqual([
      'applied',
      'applied',
    ]);
    expect(sent.map(({ url }) => url)).toEqual([
      'https://hooks.example.com/run',
      'https://hooks.example.com/run',
    ]);
    expect(sent[0]?.init.headers['authorization']).toBe(`Bearer ${SECRET}`);
    expect(sent.map(({ init }) => init.body)).toEqual(['{"title":"First"}', '{"title":"Second"}']);
    expect(JSON.stringify(applied)).not.toContain(SECRET);
  });

  it('plans nothing from a restricted folder, whatever the list says', async () => {
    const { recipes, sent, plan } = harness('restricted');
    await recipes.set('routine', SECRET);
    const message = (await plan()).cells[1]?.diagnostics.map((found) => found.message).join('');
    expect(message).toContain('sends only from a trusted workspace');
    expect(sent).toEqual([]);
  });
});
