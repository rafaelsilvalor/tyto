import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type WorkspaceDataOptions, workspaceDataResolver } from './workspace-data.js';

/**
 * A workspace with a recipe folder inside it and a folder beside it that is not the
 * workspace's, so a path or a link can try to reach out (ADR 0111, ADR 0112, ADR 0137).
 */
let scratch: string;
let workspace: string;
let recipes: string;
let outside: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-data-')));
  workspace = join(scratch, 'workspace');
  recipes = join(workspace, 'recipes');
  outside = join(scratch, 'outside');
  await mkdir(join(recipes, 'rules'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(recipes, 'vocab.json'), '{ "kinds": ["poster", "banner"] }');
  await writeFile(join(workspace, 'shared.jsonc'), '// shared\n{ "columns": 3, }\n');
  await writeFile(join(outside, 'vocab.json'), '{ "kinds": ["outside"] }');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A directory link that works without elevation on Windows, where it is a junction. */
async function linkDirectory(target: string, link: string): Promise<void> {
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function resolver(overrides: Partial<WorkspaceDataOptions> = {}) {
  return workspaceDataResolver({
    workspaceFolder: workspace,
    recipeFolder: recipes,
    trust: 'trusted',
    ...overrides,
  });
}

describe('workspaceDataResolver', () => {
  it("reads a JSON file relative to the recipe's folder", async () => {
    expect(await resolver()('./vocab.json')).toEqual({
      ok: true,
      value: { kinds: ['poster', 'banner'] },
      diagnostics: [],
    });
  });

  it('reads a file elsewhere in the workspace, with comments and a trailing comma', async () => {
    const read = await resolver()('../shared.jsonc');
    expect(read.ok && read.value).toEqual({ columns: 3 });
  });

  it('refuses every file in a restricted workspace, before reading any', async () => {
    const read = await resolver({ trust: 'restricted' })('./vocab.json');
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error.map(({ code }) => code)).toEqual(['E_RECIPE_DATA_RESTRICTED']);
    }
  });

  it('refuses a path that climbs out of the workspace as written', async () => {
    const read = await resolver()('../../outside/vocab.json');
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error[0]?.message).toContain('leaves the workspace folder');
  });

  it('refuses an absolute path even when it is inside the workspace', async () => {
    const read = await resolver()(join(recipes, 'vocab.json'));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error[0]?.message).toContain('leaves the workspace folder');
  });

  it('refuses a link inside the workspace that leads out of it', async () => {
    await linkDirectory(outside, join(recipes, 'linked'));
    const read = await resolver()('./linked/vocab.json');
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error[0]?.message).toContain('through a link');
  });

  it('follows a link that stays inside the workspace', async () => {
    await linkDirectory(recipes, join(workspace, 'alias'));
    const read = await workspaceDataResolver({
      workspaceFolder: workspace,
      recipeFolder: join(workspace, 'alias'),
      trust: 'trusted',
    })('./vocab.json');
    expect(read.ok).toBe(true);
  });

  it('says a missing file and a folder apart', async () => {
    const missing = await resolver()('./absent.json');
    const folder = await resolver()('./rules');
    expect(!missing.ok && missing.error[0]?.message).toBe(
      "Data './absent.json' names a file that was not found.",
    );
    expect(!folder.ok && folder.error[0]?.message).toContain('names a folder, not a file');
  });

  it('refuses a file above the size cap without parsing it', async () => {
    await writeFile(join(recipes, 'large.json'), `[${'0,'.repeat(40)}0]`);
    const read = await resolver({ maxBytes: 64 })('./large.json');
    expect(!read.ok && read.error[0]?.message).toBe(
      "Data './large.json' is 83 bytes, above the 64 a data file may hold.",
    );
  });

  it('reports text that is not JSON with its line and column in the data file', async () => {
    await writeFile(join(recipes, 'broken.json'), '{\n  "kinds": ["poster" "banner"]\n}');
    const read = await resolver()('./broken.json');
    expect(!read.ok && read.error[0]).toEqual({
      severity: 'error',
      code: 'E_RECIPE_DATA_SYNTAX',
      message: "Data file './broken.json' cannot be read as JSON: comma expected at 2:22.",
    });
  });

  it('refuses an empty file rather than reading it as nothing', async () => {
    await writeFile(join(recipes, 'empty.json'), '  \n');
    const read = await resolver()('./empty.json');
    expect(!read.ok && read.error[0]?.message).toContain('the file is empty');
  });
});
