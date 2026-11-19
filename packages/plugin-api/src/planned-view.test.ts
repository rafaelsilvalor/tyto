import { ok } from '@tyto/core';
import { parseRecipe } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import {
  type HostCapabilities,
  type WorkspaceEntry,
  checkedCapabilities,
  hostWorkspace,
} from './capabilities.js';
import { withPlannedRenames } from './planned-view.js';
import { type RecipeContributions, recipeRegistriesOf } from './recipes.js';

/**
 * ADR 0219: while a plan call carries the renames planned above its step, the plugin reads the
 * workspace as they leave it, through the checked layer every plugin call crosses; outside such
 * a call, and for another plugin, the disk is what it is.
 */

/** A folder of files in memory, by workspace path, each with its bytes as text. */
function disk(files: Record<string, string>): HostCapabilities {
  const entryOf = (path: string): WorkspaceEntry => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    kind: 'file',
    size: (files[path] ?? '').length,
    modifiedAt: '2026-11-19T10:00:00.000Z',
  });
  const missing = (path: string) => Promise.reject(new Error(`no such file: ${path}`));
  const capabilities: HostCapabilities = {
    fetch: () => Promise.reject(new Error('no network here')),
    credential: () => Promise.resolve(undefined),
    describeCredential: () => 'nowhere',
    hostName: 'a test host',
    workspaceRead: (_plugin, path) =>
      path in files ? Promise.resolve(encoded(files[path] ?? '')) : missing(path),
    workspaceReadPart: (_plugin, path, offset, length) =>
      path in files
        ? Promise.resolve(encoded(files[path] ?? '').subarray(offset, offset + length))
        : missing(path),
    workspaceStat: (_plugin, path) =>
      path in files ? Promise.resolve(entryOf(path)) : missing(path),
    workspaceList: (_plugin, folder) =>
      Promise.resolve(
        Object.keys(files)
          .filter((path) => path.slice(0, path.lastIndexOf('/')) === folder)
          .map(entryOf),
      ),
  };
  return capabilities;
}

const encoded = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
const decoded = (bytes: Uint8Array) => String.fromCharCode(...bytes);

const FILES = {
  'entregas/A/final/feed.png': 'feed bytes',
  'entregas/A/final/mca-1-01.png': 'cover bytes',
  'entregas/A/final/notes.txt': 'notes',
};

/** feed.png ships as the second export; the first already has its name. */
const RENAMES = [{ from: 'entregas/A/final/feed.png', to: 'entregas/A/final/mca-1-02.png' }];

const names = (entries: readonly WorkspaceEntry[]) => entries.map((entry) => entry.name).sort();

describe('the planned view of the workspace (ADR 0219)', () => {
  it('reads the renamed file under its new name, and the old name as gone, only while it runs', async () => {
    const checked = checkedCapabilities('drive', ['workspace:read'], disk(FILES));
    const workspace = hostWorkspace(checked);

    await withPlannedRenames('drive', RENAMES, async () => {
      expect(names(await workspace.list('entregas/A/final'))).toEqual([
        'mca-1-01.png',
        'mca-1-02.png',
        'notes.txt',
      ]);
      expect(await workspace.stat('entregas/A/final/mca-1-02.png')).toEqual({
        name: 'mca-1-02.png',
        kind: 'file',
        size: 10,
        modifiedAt: '2026-11-19T10:00:00.000Z',
      });
      expect(decoded(await workspace.read('entregas/A/final/MCA-1-02.png'))).toBe('feed bytes');
      expect(
        decoded(await workspace.read('entregas/A/final/mca-1-02.png', { offset: 5, length: 5 })),
      ).toBe('bytes');
      await expect(workspace.stat('entregas/A/final/feed.png')).rejects.toThrow(
        'a rename planned above this step takes it away',
      );
      await expect(workspace.read('entregas/A/final/feed.png')).rejects.toThrow(
        'a rename planned above this step takes it away',
      );
    });

    expect(names(await workspace.list('entregas/A/final'))).toEqual([
      'feed.png',
      'mca-1-01.png',
      'notes.txt',
    ]);
    await expect(workspace.stat('entregas/A/final/mca-1-02.png')).rejects.toThrow('no such file');
  });

  it('lists a swap as the files that take each name', async () => {
    const checked = checkedCapabilities('drive', ['workspace:read'], disk(FILES));
    const workspace = hostWorkspace(checked);
    const swap = [
      { from: 'entregas/A/final/feed.png', to: 'entregas/A/final/mca-1-01.png' },
      { from: 'entregas/A/final/mca-1-01.png', to: 'entregas/A/final/feed.png' },
    ];

    await withPlannedRenames('drive', swap, async () => {
      const listed = await workspace.list('entregas/A/final');
      expect(listed.map(({ name, size }) => `${name} ${String(size)}`).sort()).toEqual([
        'feed.png 11',
        'mca-1-01.png 10',
        'notes.txt 5',
      ]);
    });
  });

  it("leaves another plugin's reads, and a write, on the disk as it is", async () => {
    const host = disk(FILES);
    const written: string[] = [];
    host.workspaceWrite = (_plugin, path) => {
      written.push(path);
      return Promise.resolve();
    };
    const drive = hostWorkspace(
      checkedCapabilities('drive', ['workspace:read', 'workspace:write'], host),
    );
    const other = hostWorkspace(checkedCapabilities('sheet', ['workspace:read'], host));

    await withPlannedRenames('drive', RENAMES, async () => {
      expect(names(await other.list('entregas/A/final'))).toContain('feed.png');
      await drive.write('entregas/A/final/feed.png', 'x');
    });
    expect(written).toEqual(['entregas/A/final/feed.png']);
  });

  it("projects a contributed action's plan when the step carries renames, and not otherwise", async () => {
    const host = disk(FILES);
    const workspace = hostWorkspace(checkedCapabilities('drive', ['workspace:read'], host));
    const contributions: RecipeContributions = {
      recipeVerbs: () => [],
      ownedRecipeVerbs: () => [
        {
          plugin: 'drive',
          verb: {
            id: 'drive.upload',
            kind: 'action',
            arguments: [],
            writes: ['upload'],
            plan: async () => {
              const listed = await workspace.list('entregas/A/final');
              const operations = names(listed).map((name) => ({
                write: 'upload',
                description: `upload ${name}`,
              }));
              return ok({ target: 'drive', operations, count: operations.length });
            },
            apply: () => Promise.resolve(ok({ operations: [] })),
          },
        },
      ],
      recipeDerivations: () => [],
    };
    const registries = recipeRegistriesOf(contributions);
    const verb = registries.verbs.get('drive.upload');
    const recipe = parseRecipe('recipe ship\ndrive.upload\n');
    if (!recipe.ok || verb === undefined) throw new Error('a verb and a recipe');
    const step = recipe.value.steps[0];
    if (step === undefined) throw new Error('a step');
    const context = {
      table: { columns: [], rows: [] },
      step,
      written: step,
      aliases: new Map<string, string>(),
      derivations: registries.derivations,
      resolveRecipe: () => Promise.reject(new Error('no recipes')),
      verbs: registries.verbs,
      recipes: ['ship'],
    };

    const projected = await verb.run({ ...context, plannedRenames: RENAMES });
    const plain = await verb.run(context);

    const lines = (result: typeof plain) =>
      result.ok ? result.value.plan?.operations.map((operation) => operation.description) : [];
    expect(lines(projected)).toEqual([
      'upload mca-1-01.png',
      'upload mca-1-02.png',
      'upload notes.txt',
    ]);
    expect(lines(plain)).toEqual(['upload feed.png', 'upload mca-1-01.png', 'upload notes.txt']);
  });
});
