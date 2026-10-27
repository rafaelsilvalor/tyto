import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { type TrustStore, ok } from '@tyto/core';
import { fsTrustStore } from '@tyto/io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fontsFor } from './fonts.js';
import { fileSessionStore } from './session-store.js';
import { type FolderPlaces, createWorkspaceService } from './workspace.js';

/**
 * The window's workspace folder, on a real disk (TYTO-278, ADR 0113): what opening one hands
 * the sources, which briefs get its asset and font folders, and how its problems reach the
 * panel. The trust answer is a stub; the store itself is `@tyto/io`'s and tested there.
 */

let scratch: string;
let work: string;
let home: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-window-workspace-')));
  work = join(scratch, 'promo');
  home = join(scratch, 'home', '.tyto');
  await mkdir(join(work, '.tyto'), { recursive: true });
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const restricted: TrustStore = {
  trustOf: () => Promise.resolve({ trust: 'restricted', diagnostics: [] }),
  grant: () => Promise.resolve(ok(true)),
  revoke: () => Promise.resolve(ok(true)),
};

function service() {
  const handed: (readonly string[])[] = [];
  const listed: (string | undefined)[] = [];
  const placed: FolderPlaces[] = [];
  const workspace = createWorkspaceService({
    trustStore: restricted,
    home,
    setTemplateFolders: (folders) => {
      handed.push(folders);
      return Promise.resolve();
    },
    onFolder: (folder, places) => {
      listed.push(folder);
      placed.push(places);
      return Promise.resolve();
    },
  });
  return { workspace, handed, listed, placed };
}

describe('the window workspace service', () => {
  it("hands the explorer the resolved project's places, and none on close", async () => {
    await writeFile(
      join(work, '.tyto', 'project.json'),
      '{ "assets": ["art"], "templates": ["modelos"], "output": "saida" }',
    );
    const { workspace, placed } = service();

    await workspace.open(work);
    await workspace.close();

    expect(placed).toEqual([
      {
        output: join(work, 'saida'),
        assets: [join(work, 'art')],
        templates: [join(work, 'modelos')],
      },
      { output: undefined, assets: [], templates: [] },
    ]);
  });

  it('flags nothing for a key a restricted folder refused', async () => {
    await writeFile(join(work, '.tyto', 'project.json'), '{ "output": "../outside" }');
    const { workspace, placed } = service();

    await workspace.open(work);

    expect(placed[0]?.output).toBeUndefined();
  });

  it('tells the explorer the folder it opened, the same one again, and nothing on close', async () => {
    const { workspace, listed } = service();

    await workspace.open(work);
    await workspace.grant('folder');
    await workspace.close();
    // The home folder is never a workspace (ADR 0112), so the explorer lists nothing there.
    expect(await workspace.open(dirname(home))).toBe(false);

    expect(listed).toEqual([work, work, undefined, undefined]);
  });

  it('hands the template folders to the sources on open, and takes them back on close', async () => {
    await writeFile(join(work, '.tyto', 'project.json'), '{ "templates": ["tpl"] }');
    const { workspace, handed } = service();

    expect(await workspace.open(work)).toBe(true);
    expect(workspace.state()).toMatchObject({ folder: work, name: 'promo', trust: 'restricted' });
    await workspace.close();
    expect(handed).toEqual([[join(work, 'tpl')], []]);
    expect(workspace.state().folder).toBeNull();
  });

  it('gives its asset and font folders to a brief inside it, and to no other', async () => {
    await writeFile(
      join(work, '.tyto', 'project.json'),
      '{ "assets": ["art"], "fonts": ["fonts"], "output": "exports" }',
    );
    const { workspace } = service();
    await workspace.open(work);

    const inside = workspace.placesFor(join(work, 'briefs'));
    expect(inside.assets).toEqual([join(work, 'art')]);
    expect(inside.fonts).toBe(fontsFor([join(work, 'fonts')]));
    expect(inside.fonts).not.toBe(fontsFor([]));

    for (const outside of [join(scratch, 'elsewhere'), undefined]) {
      const places = workspace.placesFor(outside);
      expect(places.assets).toEqual([]);
      expect(places.fonts).toBe(fontsFor([]));
    }
    expect(workspace.state().output).toBe(join(work, 'exports'));
  });

  it('says where in the project file each problem is, since the panel cannot point there', async () => {
    await writeFile(join(work, '.tyto', 'project.json'), '{\n  "output": "../outside"\n}');
    const { workspace } = service();
    await workspace.open(work);

    const [problem] = workspace.state().problems;
    expect(problem?.code).toBe('W_PROJECT_PATH_OUTSIDE');
    expect(problem?.message.startsWith(`${join('.tyto', 'project.json')}:2:13: `)).toBe(true);
    expect(problem).not.toHaveProperty('range');
    expect(workspace.state().output).toBeNull();
  });

  it('opens nothing for the folder whose .tyto is TYTO_HOME', async () => {
    const { workspace, handed } = service();
    expect(await workspace.open(join(scratch, 'home'))).toBe(false);
    expect(workspace.state().folder).toBeNull();
    expect(handed).toEqual([[]]);
  });
});

describe('trusting the open folder (ADR 0111)', () => {
  it('applies what was withheld at once on grant, and keeps it until the next open on revoke', async () => {
    await writeFile(join(work, '.tyto', 'project.json'), '{ "assets": ["../shared"] }');
    const workspace = createWorkspaceService({
      trustStore: fsTrustStore({ home }),
      home,
      setTemplateFolders: () => Promise.resolve(),
    });
    const inside = join(work, 'briefs');

    await workspace.open(work);
    expect(workspace.state()).toMatchObject({ trust: 'restricted', leftOut: 1 });
    expect(workspace.placesFor(inside).assets).toEqual([]);

    expect((await workspace.grant('folder')).ok).toBe(true);
    expect(workspace.state()).toMatchObject({ trust: 'trusted', leftOut: 0 });
    expect(workspace.placesFor(inside).assets).toEqual([join(scratch, 'shared')]);

    expect((await workspace.revoke('folder')).ok).toBe(true);
    expect(workspace.state().trust).toBe('revoked');
    expect(workspace.placesFor(inside).assets).toEqual([join(scratch, 'shared')]);

    await workspace.open(work);
    expect(workspace.state()).toMatchObject({ trust: 'restricted', leftOut: 1 });
  });

  it('writes nothing and changes nothing when the trust file cannot be read', async () => {
    await writeFile(join(work, '.tyto', 'project.json'), '{ "assets": ["../shared"] }');
    await writeFile(join(home, 'trust.json'), 'not json');
    const workspace = createWorkspaceService({
      trustStore: fsTrustStore({ home }),
      home,
      setTemplateFolders: () => Promise.resolve(),
    });
    await workspace.open(work);
    const granted = await workspace.grant('folder');
    expect(granted.ok).toBe(false);
    expect(workspace.state().trust).toBe('restricted');
  });
});

describe('the trust a plugin fetch answers to (ADR 0119)', () => {
  it('is the open folder’s inside it, and the CLI’s answer outside it', async () => {
    await writeFile(join(work, '.tyto', 'project.json'), '{}');
    const elsewhere = join(scratch, 'other');
    await mkdir(join(elsewhere, '.tyto'), { recursive: true });
    await mkdir(join(elsewhere, 'briefs'), { recursive: true });
    await writeFile(join(elsewhere, '.tyto', 'project.json'), '{}');
    const loose = join(scratch, 'loose');
    await mkdir(loose, { recursive: true });
    const store = fsTrustStore({ home });
    const workspace = createWorkspaceService({
      trustStore: store,
      home,
      setTemplateFolders: () => Promise.resolve(),
    });
    await workspace.open(work);
    expect((await store.grant(work)).ok).toBe(true);
    await workspace.open(work);

    expect(await workspace.sourceTrustFor(join(work, 'briefs'))).toMatchObject({
      trust: 'trusted',
    });
    // Another workspace, which the window has not opened: its own answer, as `tyto render`
    // would find walking up — restricted, because nobody trusted it.
    expect(await workspace.sourceTrustFor(join(elsewhere, 'briefs'))).toEqual({
      trust: 'restricted',
      folder: elsewhere,
    });
    expect(await workspace.sourceTrustFor(loose)).toEqual({ trust: 'none' });
    expect(await workspace.sourceTrustFor(undefined)).toBeUndefined();
  });
});

describe('the section a recipe verb is handed (TYTO-377, ADR 0147, ADR 0148)', () => {
  const PROJECT =
    '{ "plugins": { "acme": { "site": "https://acme.example" }, "other": { "sheet": "s1" } } }';

  it("is the open folder's, per plugin, read again on every call", async () => {
    await writeFile(join(work, '.tyto', 'project.json'), PROJECT);
    const workspace = createWorkspaceService({
      trustStore: fsTrustStore({ home }),
      home,
      setTemplateFolders: () => Promise.resolve(),
    });
    const recipes = join(work, 'recipes');
    expect(workspace.sectionFor(recipes, 'acme')).toBeUndefined();

    await workspace.open(work);
    // Restricted: `loadWorkspace` withheld every section, so a verb is handed none.
    expect(workspace.sectionFor(recipes, 'acme')).toBeUndefined();

    expect((await workspace.grant('folder')).ok).toBe(true);
    expect(workspace.sectionFor(recipes, 'acme')).toEqual({ site: 'https://acme.example' });
    expect(workspace.sectionFor(recipes, 'other')).toEqual({ sheet: 's1' });
    expect(workspace.sectionFor(recipes, 'nobody')).toBeUndefined();
    // Only an own key is a section: nothing every object inherits is one.
    expect(workspace.sectionFor(recipes, 'constructor')).toBeUndefined();
    // Outside the open folder, or in no file yet, no folder chose anything.
    expect(workspace.sectionFor(join(scratch, 'elsewhere'), 'acme')).toBeUndefined();
    expect(workspace.sectionFor(undefined, 'acme')).toBeUndefined();

    // Edited and read again: the next call reads the new value, nothing kept from the last.
    await writeFile(
      join(work, '.tyto', 'project.json'),
      '{ "plugins": { "acme": { "site": "https://b.example" } } }',
    );
    await workspace.open(work);
    expect(workspace.sectionFor(recipes, 'acme')).toEqual({ site: 'https://b.example' });

    await workspace.close();
    expect(workspace.sectionFor(recipes, 'acme')).toBeUndefined();
  });
});

describe('a work profile in the window (TYTO-347, ADR 0114)', () => {
  async function named(text: string): Promise<string> {
    const folder = join(home, 'profiles', 'saude');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'profile.json'), text);
    return folder;
  }

  async function sharedProfile(text: string): Promise<string> {
    const team = join(work, 'team');
    await mkdir(team, { recursive: true });
    await writeFile(join(team, 'saude.json'), text);
    return team;
  }

  it('names a profile kept in TYTO_HOME, trusted where it lives, and says where each place came from', async () => {
    const profile = await named('{ "assets": ["art"], "fonts": ["fonts"], "output": "exports" }');
    await writeFile(join(work, '.tyto', 'project.json'), '{ "profile": "saude", "output": "out" }');
    const { workspace } = service();
    await workspace.open(work);

    expect(workspace.state()).toMatchObject({
      profile: { label: 'saude', trust: 'trusted', byLocation: true, leftOut: 0 },
      places: [
        { key: 'assets', folders: [join(profile, 'art')], origin: 'profile' },
        { key: 'fonts', folders: [join(profile, 'fonts')], origin: 'profile' },
        { key: 'output', folders: [join(work, 'out')], origin: 'folder' },
      ],
    });
    expect(workspace.placesFor(join(work, 'briefs')).assets).toEqual([join(profile, 'art')]);
  });

  it("names the profile's own file in front of its problems", async () => {
    await named('{\n  "profile": "other"\n}');
    await writeFile(join(work, '.tyto', 'project.json'), '{ "profile": "saude" }');
    const { workspace } = service();
    await workspace.open(work);

    const [problem] = workspace.state().problems;
    expect(problem?.code).toBe('W_PROFILE_NESTED');
    expect(problem?.message.startsWith(`${join('profiles', 'saude', 'profile.json')}:2:14: `)).toBe(
      true,
    );
  });

  it('trusts a shared profile on its own, leaving the folder as it was, and takes it back on the next open', async () => {
    await sharedProfile('{ "assets": ["../../shared"] }');
    await writeFile(join(work, '.tyto', 'project.json'), '{ "profile": "team/saude.json" }');
    const store = fsTrustStore({ home });
    const workspace = createWorkspaceService({
      trustStore: store,
      home,
      setTemplateFolders: () => Promise.resolve(),
    });
    await workspace.open(work);
    expect(workspace.state()).toMatchObject({
      trust: 'restricted',
      leftOut: 0,
      profile: { label: 'saude', trust: 'restricted', byLocation: false, leftOut: 1 },
    });

    expect((await workspace.grant('profile')).ok).toBe(true);
    expect(workspace.state()).toMatchObject({ trust: 'restricted', profile: { trust: 'trusted' } });
    expect((await store.trustOf(work)).trust).toBe('restricted');
    expect((await store.trustOf(join(work, 'team', 'saude.json'))).trust).toBe('trusted');
    expect(workspace.placesFor(join(work, 'briefs')).assets).toEqual([join(scratch, 'shared')]);

    expect((await workspace.revoke('profile')).ok).toBe(true);
    expect(workspace.state().profile?.trust).toBe('revoked');
    await workspace.open(work);
    expect(workspace.state().profile?.trust).toBe('restricted');
  });

  it('writes no approval for a profile trusted where it lives', async () => {
    await named('{}');
    await writeFile(join(work, '.tyto', 'project.json'), '{ "profile": "saude" }');
    const granted: string[] = [];
    const workspace = createWorkspaceService({
      trustStore: {
        ...restricted,
        grant: (path) => (granted.push(path), Promise.resolve(ok(true))),
      },
      home,
      setTemplateFolders: () => Promise.resolve(),
    });
    await workspace.open(work);
    expect((await workspace.grant('profile')).ok).toBe(true);
    expect(granted).toEqual([]);
  });
});

describe('session.json with a workspace (ADR 0113)', () => {
  it('reads the folder back, and drops a field that does not parse without the rest', async () => {
    const file = join(scratch, 'session.json');
    const store = fileSessionStore(file);
    await store.write({ version: 1, tabs: [], active: 0, workspace: { folder: work } });
    expect((await store.read()).workspace).toEqual({ folder: work });

    await writeFile(file, JSON.stringify({ version: 1, tabs: [], active: 0, workspace: 7 }));
    const read = await store.read();
    expect(read.workspace).toBeUndefined();
    expect(read.tabs).toEqual([]);
  });
});
