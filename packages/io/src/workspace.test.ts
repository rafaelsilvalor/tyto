import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Trust, TrustStore } from '@tyto/core';
import { ok } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { briefAssetResolver } from './file-assets.js';
import { fsTrustStore } from './fs-trust-store.js';
import { readProjectText } from './project-file.js';
import { findWorkspace, loadWorkspace, projectFileOf } from './workspace.js';

/**
 * A workspace on a real disk (TYTO-278, ADR 0111, ADR 0112): the project file read with its
 * ranges, the folder found from a brief deep inside it, the home folder never taken for one,
 * and the half of the confinement only a disk can check — a link inside the folder that lands
 * outside it.
 */

let scratch: string;
let work: string;
let home: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tyto-workspace-'));
  work = join(scratch, 'work');
  home = join(scratch, 'home', '.tyto');
  await mkdir(join(work, '.tyto'), { recursive: true });
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function answering(trust: Trust): TrustStore {
  return {
    trustOf: () => Promise.resolve({ trust, diagnostics: [] }),
    grant: () => Promise.resolve(ok(true)),
    revoke: () => Promise.resolve(ok(true)),
  };
}

async function project(text: string): Promise<void> {
  await writeFile(projectFileOf(work), text);
}

/** A directory link that works without elevation on Windows, where it is a junction. */
async function linkFolder(target: string, link: string): Promise<void> {
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

describe('readProjectText', () => {
  it('reads keys with comments and trailing commas, and knows where each was written', () => {
    const text = '{\n  // where exports go\n  "output": "out",\n  "assets": ["a", "b",],\n}';
    const read = readProjectText(text);
    expect(read.syntax).toEqual([]);
    expect(read.entries.map((entry) => entry.key)).toEqual(['output', 'assets']);
    const assets = read.entries[1];
    expect(assets?.entryRanges?.map((range) => text.slice(range.start, range.end))).toEqual([
      '"a"',
      '"b"',
    ]);
  });

  it('says what is wrong and keeps the keys it recovered', () => {
    const read = readProjectText('{ "output": "out", "assets": [ }');
    expect(read.syntax.map((item) => item.code)).toContain('E_PROJECT_SYNTAX');
    expect(read.entries.map((entry) => entry.key)).toContain('output');
  });

  it('refuses a file that is not an object', () => {
    expect(readProjectText('["out"]').syntax.map((item) => item.message)).toEqual([
      'The project file cannot be read here: it is not an object of keys.',
    ]);
  });
});

describe('loadWorkspace', () => {
  it('resolves the declared folders against the workspace', async () => {
    await project('{ "assets": ["art"], "output": "exports" }');
    const loaded = await loadWorkspace(work, { trustStore: answering('trusted'), home });
    expect(loaded?.exists).toBe(true);
    expect(loaded?.project.assets).toEqual([join(loaded?.folder ?? '', 'art')]);
    expect(loaded?.project.output).toBe(join(loaded?.folder ?? '', 'exports'));
    expect(loaded?.diagnostics).toEqual([]);
  });

  it('opens a folder with no project file as a workspace with nothing declared', async () => {
    const loaded = await loadWorkspace(work, { trustStore: answering('restricted'), home });
    expect(loaded).toMatchObject({ exists: false, text: '', diagnostics: [] });
    expect(loaded?.project.output).toBeUndefined();
  });

  it('refuses, in a restricted folder, a folder key that a link inside carries outside', async () => {
    const outside = join(scratch, 'private');
    await mkdir(outside);
    await linkFolder(outside, join(work, 'linked'));
    await project('{ "assets": ["linked", "art"], "output": "linked/exports" }');

    const restricted = await loadWorkspace(work, { trustStore: answering('restricted'), home });
    expect(restricted?.project.assets).toEqual([join(restricted?.folder ?? '', 'art')]);
    expect(restricted?.project.output).toBeUndefined();
    expect(restricted?.diagnostics.map((item) => item.code)).toEqual([
      'W_PROJECT_PATH_OUTSIDE',
      'W_PROJECT_PATH_OUTSIDE',
    ]);

    // Trusted, the same link is the person's own business.
    const trusted = await loadWorkspace(work, { trustStore: answering('trusted'), home });
    expect(trusted?.project.output).toBe(join(trusted?.folder ?? '', 'linked', 'exports'));
  });

  it('trusts for one run on --trust without asking the store', async () => {
    await project('{ "output": "../elsewhere" }');
    const loaded = await loadWorkspace(work, {
      trustStore: answering('restricted'),
      home,
      trustForThisRun: true,
    });
    expect(loaded?.trust).toBe('trusted');
    expect(loaded?.project.output).toBe(join(scratch, 'elsewhere'));
  });

  it('never reads the folder whose .tyto is TYTO_HOME', async () => {
    await writeFile(join(home, 'project.json'), '{ "output": "out" }');
    const loaded = await loadWorkspace(join(scratch, 'home'), {
      trustStore: answering('trusted'),
      home,
    });
    expect(loaded).toBeUndefined();
  });

  it('reports the store failing to answer, and opens restricted', async () => {
    await writeFile(join(home, 'trust.json'), '{ "trusted": [ }');
    await project('{ "output": "../x" }');
    const loaded = await loadWorkspace(work, { trustStore: fsTrustStore({ home }), home });
    expect(loaded?.trust).toBe('restricted');
    expect(loaded?.trustDiagnostics.map((item) => item.code)).toEqual(['E_TRUST_FILE']);
    expect(loaded?.project.output).toBeUndefined();
  });
});

describe('findWorkspace', () => {
  it('finds the nearest folder with a project file above a brief', async () => {
    await project('{}');
    const deep = join(work, 'briefs', 'october');
    await mkdir(deep, { recursive: true });
    expect(await findWorkspace(deep, { home })).toBe(work);
  });

  it('stops at the folder whose .tyto is TYTO_HOME, even with a project file in it', async () => {
    await writeFile(join(home, 'project.json'), '{}');
    const below = join(scratch, 'home', 'documents');
    await mkdir(below, { recursive: true });
    expect(await findWorkspace(below, { home })).toBeUndefined();
  });

  it('answers nothing for a folder with no project file anywhere above', async () => {
    expect(
      await findWorkspace(join(scratch, 'home'), { home: join(scratch, 'other') }),
    ).toBeUndefined();
  });
});

describe('briefAssetResolver with workspace folders', () => {
  it('reads the workspace folders after the brief folder and its assets/', async () => {
    const briefs = join(work, 'briefs');
    const art = join(work, 'art');
    await mkdir(join(briefs, 'assets'), { recursive: true });
    await mkdir(art, { recursive: true });
    await writeFile(join(art, 'logo.png'), 'shared');
    await writeFile(join(art, 'own.png'), 'shared');
    await writeFile(join(briefs, 'assets', 'own.png'), 'beside');

    const resolver = briefAssetResolver({ briefDirectory: briefs, projectAssets: [art] });
    expect((await resolver.resolve('logo.png'))?.path).toBe(join(art, 'logo.png'));
    expect((await resolver.resolve('own.png'))?.path).toBe(join(briefs, 'assets', 'own.png'));
    // A workspace folder is a containment root too: climbing out of it finds nothing.
    expect(await resolver.resolve('../work/art/logo.png')).toBeUndefined();
  });
});

describe('fsTrustStore', () => {
  it('starts restricted, grants, answers trusted, and revokes', async () => {
    const store = fsTrustStore({ home, now: () => new Date('2026-10-21T12:00:00Z') });
    expect((await store.trustOf(work)).trust).toBe('restricted');
    expect(await store.grant(work)).toEqual(ok(true));
    expect(await store.grant(work)).toEqual(ok(false));
    expect((await store.trustOf(work)).trust).toBe('trusted');
    const written = await readFile(join(home, 'trust.json'), 'utf8');
    expect(written).toContain('"since": "2026-10-21"');
    expect(await store.revoke(work)).toEqual(ok(true));
    expect((await store.trustOf(work)).trust).toBe('restricted');
    expect(await store.revoke(work)).toEqual(ok(false));
  });

  it('does not trust a link to a trusted folder as that folder', async () => {
    const store = fsTrustStore({ home });
    const target = join(scratch, 'target');
    await mkdir(target);
    await store.grant(target);
    await linkFolder(target, join(scratch, 'alias'));
    // The link's real path is the target, so it *is* that folder; a sibling is not.
    expect((await store.trustOf(join(scratch, 'alias'))).trust).toBe('trusted');
    expect((await store.trustOf(join(scratch, 'target-evil'))).trust).toBe('restricted');
  });

  it('compares without case where the file system does', async () => {
    const store = fsTrustStore({ home, ignoreCase: true });
    await store.grant(work);
    expect((await store.trustOf(work.toUpperCase())).trust).toBe('trusted');
  });

  it('keeps the comments a person wrote when it edits the file', async () => {
    await writeFile(join(home, 'trust.json'), '{\n  // mine\n  "trusted": []\n}\n');
    const store = fsTrustStore({ home });
    await store.grant(work);
    expect(await readFile(join(home, 'trust.json'), 'utf8')).toContain('// mine');
  });

  it('refuses to write a file it cannot read', async () => {
    await writeFile(join(home, 'trust.json'), 'not json');
    const granted = await fsTrustStore({ home }).grant(work);
    expect(granted.ok).toBe(false);
    expect(await readFile(join(home, 'trust.json'), 'utf8')).toBe('not json');
  });
});
