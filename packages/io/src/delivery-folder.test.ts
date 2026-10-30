import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { builtInDelivery, planDelivery } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDelivery } from './delivery-folder.js';

/**
 * `createDelivery` (TYTO-489, ADR 0157 §5): a new delivery is made, an existing folder is reused,
 * an existing brief is refused, and every refusal leaves the disk as it was.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-delivery-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function plan(name: string) {
  const planned = planDelivery(builtInDelivery(workspace), name);
  if (!planned.ok) throw new Error('the plan was refused');
  return planned.value;
}

/** Every path under `folder`, relative, sorted: what a run left on the disk. */
async function tree(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true });
  return entries.map((entry) => entry.replace(/\\/gu, '/')).sort();
}

describe('createDelivery', () => {
  it('makes the folder, assets/, editaveis/ and the brief', async () => {
    const made = await createDelivery(plan('mca-66910_simule-sua-nota-da-2ª-fase'), {
      root: workspace,
      brief: '---\ntemplate: promo\n---\n',
    });
    expect(made).toMatchObject({ ok: true, value: { reused: false } });
    expect(await tree(workspace)).toEqual([
      'mca-66910_simule-sua-nota-da-2ª-fase',
      'mca-66910_simule-sua-nota-da-2ª-fase/assets',
      'mca-66910_simule-sua-nota-da-2ª-fase/editaveis',
      'mca-66910_simule-sua-nota-da-2ª-fase/editaveis/mca-66910_simule-sua-nota-da-2ª-fase.brief',
    ]);
    const brief = join(workspace, 'mca-66910_simule-sua-nota-da-2ª-fase', 'editaveis');
    expect(await readFile(join(brief, 'mca-66910_simule-sua-nota-da-2ª-fase.brief'), 'utf8')).toBe(
      '---\ntemplate: promo\n---\n',
    );
  });

  it('reuses an existing folder, keeping what is in it and making what it lacks', async () => {
    await mkdir(join(workspace, 'mca-1', 'assets'), { recursive: true });
    await writeFile(join(workspace, 'mca-1', 'assets', 'foto.png'), 'png');
    const made = await createDelivery(plan('mca-1'), { root: workspace, brief: '' });
    expect(made).toMatchObject({
      ok: true,
      value: { reused: true, made: [join(workspace, 'mca-1', 'editaveis')] },
    });
    expect(await tree(workspace)).toEqual([
      'mca-1',
      'mca-1/assets',
      'mca-1/assets/foto.png',
      'mca-1/editaveis',
      'mca-1/editaveis/mca-1.brief',
    ]);
  });

  it('refuses an existing brief and writes nothing, not even a missing folder', async () => {
    await mkdir(join(workspace, 'mca-1', 'editaveis'), { recursive: true });
    await writeFile(join(workspace, 'mca-1', 'editaveis', 'mca-1.brief'), 'mine');
    const made = await createDelivery(plan('mca-1'), { root: workspace, brief: 'new' });
    expect(made.ok).toBe(false);
    expect(!made.ok && made.error[0]?.code).toBe('E_DELIVERY_BRIEF_EXISTS');
    expect(await tree(workspace)).toEqual([
      'mca-1',
      'mca-1/editaveis',
      'mca-1/editaveis/mca-1.brief',
    ]);
    expect(await readFile(join(workspace, 'mca-1', 'editaveis', 'mca-1.brief'), 'utf8')).toBe(
      'mine',
    );
  });

  it('refuses a file where a folder must go, writing nothing', async () => {
    await mkdir(join(workspace, 'mca-1'));
    await writeFile(join(workspace, 'mca-1', 'editaveis'), 'a file');
    const made = await createDelivery(plan('mca-1'), { root: workspace, brief: '' });
    expect(!made.ok && made.error[0]?.code).toBe('E_DELIVERY_FOLDER_BLOCKED');
    expect(await tree(workspace)).toEqual(['mca-1', 'mca-1/editaveis']);
  });

  it('refuses a delivery a link carries outside the workspace, writing nothing', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'tyto-outside-'));
    try {
      // A junction needs no privilege on Windows, and is a plain link elsewhere.
      await symlink(outside, join(workspace, 'mca-1'), 'junction');
      const made = await createDelivery(plan('mca-1'), { root: workspace, brief: '' });
      expect(!made.ok && made.error[0]?.code).toBe('W_PROJECT_PATH_OUTSIDE');
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
