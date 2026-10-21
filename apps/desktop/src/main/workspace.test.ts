import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type TrustStore, ok } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fontsFor } from './fonts.js';
import { fileSessionStore } from './session-store.js';
import { createWorkspaceService } from './workspace.js';

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
  const workspace = createWorkspaceService({
    trustStore: restricted,
    home,
    setTemplateFolders: (folders) => {
      handed.push(folders);
      return Promise.resolve();
    },
  });
  return { workspace, handed };
}

describe('the window workspace service', () => {
  it('hands the template folders to the sources on open, and takes them back on close', async () => {
    await writeFile(join(work, '.tyto', 'project.json'), '{ "templates": ["tpl"] }');
    const { workspace, handed } = service();

    expect(await workspace.open(work)).toBe(true);
    expect(workspace.state()).toMatchObject({ folder: work, name: 'promo', trusted: false });
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
    expect(problem?.message.startsWith(`${join(work, '.tyto', 'project.json')}:2:13: `)).toBe(true);
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
