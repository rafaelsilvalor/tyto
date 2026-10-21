import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Trust, TrustStore } from '@tyto/core';
import { ok } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fsTrustStore } from './fs-trust-store.js';
import { loadWorkspace, projectFileOf } from './workspace.js';

/**
 * A workspace that names a work profile, on a real disk (TYTO-347, ADR 0111, ADR 0114).
 *
 * Every test has its own `TYTO_HOME` and its own folders. The profile is either kept in
 * `TYTO_HOME/profiles/<name>/` and trusted by where it lives, or a file elsewhere that is its
 * own source: asked of the store on its own, and confined to its own folder while restricted.
 */

let scratch: string;
let home: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-profile-')));
  home = join(scratch, 'home', '.tyto');
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

/** A workspace folder named `name` under the scratch folder, with `text` as its project file. */
async function workspace(name: string, text: string): Promise<string> {
  const folder = join(scratch, name);
  await mkdir(join(folder, '.tyto'), { recursive: true });
  await writeFile(projectFileOf(folder), text);
  return folder;
}

async function namedProfile(name: string, text: string): Promise<string> {
  const folder = join(home, 'profiles', name);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'profile.json'), text);
  return folder;
}

async function linkFolder(target: string, link: string): Promise<void> {
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

const SAUDE =
  '{ "assets": ["art"], "templates": ["tpl"], "fonts": ["fonts"], "output": "exports" }';

function codes(items: readonly { readonly code: string }[] | undefined): string[] {
  return (items ?? []).map((item) => item.code);
}

describe('a named work profile', () => {
  it('gives two folders the same places, and one folder overrides the output alone', async () => {
    const profile = await namedProfile('saude', SAUDE);
    const plain = await workspace('campanha-a', '{ "profile": "saude" }');
    const own = await workspace('campanha-b', '{ "profile": "saude", "output": "out" }');

    for (const folder of [plain, own]) {
      const loaded = await loadWorkspace(folder, { trustStore: answering('restricted'), home });
      expect(loaded?.project).toMatchObject({
        assets: [join(profile, 'art')],
        templates: [join(profile, 'tpl')],
        fonts: [join(profile, 'fonts')],
      });
      expect(loaded?.profile).toMatchObject({ trust: 'trusted', root: profile });
      expect(loaded?.diagnostics).toEqual([]);
    }
    const a = await loadWorkspace(plain, { trustStore: answering('restricted'), home });
    const b = await loadWorkspace(own, { trustStore: answering('restricted'), home });
    expect(a?.project.output).toBe(join(profile, 'exports'));
    expect(a?.project.origins.output).toBe('profile');
    expect(b?.project.output).toBe(join(own, 'out'));
    expect(b?.project.origins.output).toBe('folder');
  });

  it('says a missing profile at the key, and the folder opens with its own keys', async () => {
    const text = '{ "profile": "saude", "output": "out" }';
    const folder = await workspace('campanha', text);
    const loaded = await loadWorkspace(folder, { trustStore: answering('trusted'), home });
    expect(loaded?.profile).toBeUndefined();
    expect(loaded?.project.output).toBe(join(folder, 'out'));
    expect(codes(loaded?.diagnostics)).toEqual(['W_PROJECT_PROFILE_MISSING']);
    const range = loaded?.diagnostics[0]?.range;
    expect(text.slice(range?.start, range?.end)).toBe('"saude"');
    expect(loaded?.diagnostics[0]?.message).toContain(join(home, 'profiles', 'saude'));
  });

  it('refuses a name that could leave the profiles folder, at the key', async () => {
    await namedProfile('saude', SAUDE);
    const folder = await workspace('campanha', '{ "profile": ".." }');
    const loaded = await loadWorkspace(folder, { trustStore: answering('trusted'), home });
    expect(loaded?.profile).toBeUndefined();
    expect(codes(loaded?.diagnostics)).toEqual(['W_PROJECT_PROFILE_INVALID']);
  });

  it("reports the profile's own problems against the profile's own text", async () => {
    await namedProfile('saude', '{ "profile": "other", "colour": "red", "output": [ }');
    const folder = await workspace('campanha', '{ "profile": "saude" }');
    const loaded = await loadWorkspace(folder, { trustStore: answering('trusted'), home });
    expect(loaded?.diagnostics).toEqual([]);
    const profile = loaded?.profile;
    expect(codes(profile?.diagnostics)).toEqual(
      expect.arrayContaining(['E_PROJECT_SYNTAX', 'W_PROFILE_NESTED', 'W_PROJECT_KEY_UNKNOWN']),
    );
    const nested = profile?.diagnostics.find((item) => item.code === 'W_PROFILE_NESTED');
    expect(profile?.text.slice(nested?.range?.start, nested?.range?.end)).toBe('"other"');
  });
});

describe('a work profile named by path', () => {
  it('reads a file elsewhere for a trusted folder, restricted until it is approved itself', async () => {
    const team = join(scratch, 'team');
    await mkdir(team);
    await writeFile(join(team, 'saude.json'), '{ "output": "../anywhere", "fonts": ["fonts"] }');
    const folder = await workspace('campanha', '{ "profile": "../team/saude.json" }');
    const store = fsTrustStore({ home });
    await store.grant(folder);

    // Trust never travels along a reference: the folder is trusted, the profile is not.
    const before = await loadWorkspace(folder, { trustStore: store, home });
    expect(before?.trust).toBe('trusted');
    expect(before?.profile?.trust).toBe('restricted');
    expect(before?.project.output).toBeUndefined();
    expect(before?.project.fonts).toEqual([join(team, 'fonts')]);
    expect(codes(before?.profile?.diagnostics)).toEqual(['W_PROJECT_PATH_OUTSIDE']);

    await store.grant(join(team, 'saude.json'));
    const after = await loadWorkspace(folder, { trustStore: store, home });
    expect(after?.profile?.trust).toBe('trusted');
    expect(after?.project.output).toBe(join(scratch, 'anywhere'));
  });

  it('reads profile.json in a folder the path names', async () => {
    const team = join(scratch, 'team', 'saude');
    await mkdir(team, { recursive: true });
    await writeFile(join(team, 'profile.json'), '{ "output": "exports" }');
    const folder = await workspace('campanha', '{ "profile": "../team/saude" }');
    const loaded = await loadWorkspace(folder, { trustStore: answering('trusted'), home });
    expect(loaded?.profile?.file).toBe(join(team, 'profile.json'));
    expect(loaded?.project.output).toBe(join(team, 'exports'));
  });

  it('refuses a restricted folder a profile path outside it, lexically', async () => {
    const team = join(scratch, 'team');
    await mkdir(team);
    await writeFile(join(team, 'saude.json'), SAUDE);
    const folder = await workspace('campanha', '{ "profile": "../team/saude.json" }');
    const loaded = await loadWorkspace(folder, { trustStore: answering('restricted'), home });
    expect(loaded?.profile).toBeUndefined();
    expect(loaded?.project.assets).toEqual([]);
    expect(codes(loaded?.diagnostics)).toEqual(['W_PROJECT_PATH_OUTSIDE']);
  });

  it('refuses a restricted folder a profile path that a link inside carries outside', async () => {
    const team = join(scratch, 'team');
    await mkdir(team);
    await writeFile(join(team, 'saude.json'), SAUDE);
    const folder = await workspace('campanha', '{ "profile": "shared/saude.json" }');
    await linkFolder(team, join(folder, 'shared'));
    const loaded = await loadWorkspace(folder, { trustStore: answering('restricted'), home });
    expect(loaded?.profile).toBeUndefined();
    expect(loaded?.project.assets).toEqual([]);
    expect(codes(loaded?.diagnostics)).toEqual(['W_PROJECT_PATH_OUTSIDE']);
  });

  it("confines a restricted profile to its own folder, links followed, not the workspace's", async () => {
    const team = join(scratch, 'team');
    const outside = join(scratch, 'private');
    await mkdir(team);
    await mkdir(outside);
    await linkFolder(outside, join(team, 'linked'));
    await writeFile(join(team, 'saude.json'), '{ "assets": ["linked", "art"] }');
    const folder = await workspace('campanha', '{ "profile": "../team/saude.json" }');
    const store = fsTrustStore({ home });
    await store.grant(folder);
    const loaded = await loadWorkspace(folder, { trustStore: store, home });
    expect(loaded?.project.assets).toEqual([join(team, 'art')]);
    expect(codes(loaded?.profile?.diagnostics)).toEqual(['W_PROJECT_PATH_OUTSIDE']);
  });

  it('trusts the profile too for one run on --trust, which the person typed for the run', async () => {
    const team = join(scratch, 'team');
    await mkdir(team);
    await writeFile(join(team, 'saude.json'), '{ "output": "../anywhere" }');
    const folder = await workspace('campanha', '{ "profile": "../team/saude.json" }');
    const loaded = await loadWorkspace(folder, {
      trustStore: answering('restricted'),
      home,
      trustForThisRun: true,
    });
    expect(loaded?.profile?.trust).toBe('trusted');
    expect(loaded?.project.output).toBe(join(scratch, 'anywhere'));
  });

  it('says a profile file that is not there at the key', async () => {
    const folder = await workspace('campanha', '{ "profile": "brand/saude.json" }');
    const loaded = await loadWorkspace(folder, { trustStore: answering('restricted'), home });
    expect(codes(loaded?.diagnostics)).toEqual(['W_PROJECT_PROFILE_MISSING']);
  });

  it('trusts a profile file inside TYTO_HOME by where it lives', async () => {
    await namedProfile('saude', '{ "output": "/anywhere" }');
    const folder = await workspace(
      'campanha',
      JSON.stringify({ profile: join(home, 'profiles', 'saude', 'profile.json') }),
    );
    const store = fsTrustStore({ home });
    await store.grant(folder);
    const loaded = await loadWorkspace(folder, { trustStore: store, home });
    expect(loaded?.profile?.trust).toBe('trusted');
  });
});
