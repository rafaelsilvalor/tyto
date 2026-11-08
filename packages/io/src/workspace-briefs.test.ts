import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Trust } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { briefDigest, workspaceBriefPorts } from './workspace-briefs.js';

/**
 * `to-brief`'s workspace ports (ADR 0172) on a real folder: the digest Apply compares, the
 * writes, and the refusals the verb's lexical checks cannot make — a link that leads out of the
 * workspace or into `.tyto`, and a folder restricted since the plan.
 */

let scratch: string;
let workspace: string;
let outside: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-workspace-briefs-')));
  workspace = join(scratch, 'promo');
  outside = join(scratch, 'elsewhere');
  await mkdir(join(workspace, 'recipes'), { recursive: true });
  await mkdir(join(workspace, '.tyto'), { recursive: true });
  await mkdir(outside, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A directory link that works without elevation on Windows, where it is a junction. */
async function link(target: string, at: string): Promise<void> {
  await symlink(target, at, process.platform === 'win32' ? 'junction' : 'dir');
}

function ports(trust: () => Trust = () => 'trusted', inWorkspace = true) {
  const folder = inWorkspace ? workspace : undefined;
  return workspaceBriefPorts({
    workspaceFolder: folder,
    recipeFolder: folder === undefined ? undefined : join(folder, 'recipes'),
    trust,
    template: () => Promise.resolve(undefined),
  });
}

/** The digest a `stat` answered; throws on a refusal, so a refusal never reads as "missing". */
function valueOf(result: { ok: boolean; value?: string | undefined }): string | undefined {
  if (!result.ok) throw new Error('stat refused');
  return result.value;
}

const codes = (result: { ok: boolean; error?: readonly { code: string }[] }) =>
  result.ok ? [] : (result.error ?? []).map((found) => found.code);

describe('the recipe folder', () => {
  it('is relative to the workspace with / separators, and restricted when not trusted', () => {
    expect(ports().folder()).toEqual({ recipe: 'recipes', restricted: false });
    expect(ports(() => 'restricted').folder()).toEqual({ recipe: 'recipes', restricted: true });
  });

  it('is nowhere for a recipe in no workspace, or outside the one named', () => {
    expect(ports(() => 'trusted', false).folder()).toBeUndefined();
    const astray = workspaceBriefPorts({
      workspaceFolder: workspace,
      recipeFolder: outside,
      trust: () => 'trusted',
      template: () => Promise.resolve(undefined),
    });
    expect(astray.folder()).toBeUndefined();
  });
});

describe('stat and write', () => {
  it('answers nothing for a missing file, writes it into a new folder, then its digest', async () => {
    const briefs = ports();
    expect(valueOf(await briefs.stat('briefs/aula-1.brief'))).toBeUndefined();

    const text = '---\ntemplate: promo-curso\n---\n\n::titulo First\n';
    expect((await briefs.write('briefs/aula-1.brief', text)).ok).toBe(true);

    expect(await readFile(join(workspace, 'briefs', 'aula-1.brief'), 'utf8')).toBe(text);
    const digest = briefDigest(new TextEncoder().encode(text));
    expect(valueOf(await briefs.stat('briefs/aula-1.brief'))).toBe(digest);
    // Landed whole: no partial file left beside it.
    expect(await readdir(join(workspace, 'briefs'))).toEqual(['aula-1.brief']);
  });

  it('answers a different digest once the bytes change, which is what Apply compares', async () => {
    const briefs = ports();
    await writeFile(join(workspace, 'one.brief'), 'before');
    const first = await briefs.stat('one.brief');
    await writeFile(join(workspace, 'one.brief'), 'after');
    const second = await briefs.stat('one.brief');
    expect(first.ok && second.ok && first.value !== second.value).toBe(true);
  });

  it('refuses a path that names a folder', async () => {
    await mkdir(join(workspace, 'briefs', 'aula.brief'), { recursive: true });
    expect(codes(await ports().stat('briefs/aula.brief'))).toEqual(['E_RECIPE_BRIEF']);
    expect(codes(await ports().write('briefs/aula.brief', 'x'))).toEqual(['E_RECIPE_BRIEF']);
  });
});

describe('the real path is confined again', () => {
  it('refuses a link inside the workspace that leads out of it, and writes nothing there', async () => {
    await link(outside, join(workspace, 'briefs'));
    const briefs = ports();

    const stated = await briefs.stat('briefs/aula-1.brief');
    const written = await briefs.write('briefs/aula-1.brief', 'x');

    expect(codes(stated)).toEqual(['E_RECIPE_BRIEF']);
    expect(codes(written)).toEqual(['E_RECIPE_BRIEF']);
    expect(written.ok ? '' : written.error[0]?.message).toContain('through a link');
    expect(await readdir(outside)).toEqual([]);
  });

  it('refuses a link that lands in .tyto/, which the lexical check cannot see', async () => {
    await link(join(workspace, '.tyto'), join(workspace, 'briefs'));
    const written = await ports().write('briefs/trust.brief', 'x');

    expect(codes(written)).toEqual(['E_RECIPE_BRIEF']);
    expect(await readdir(join(workspace, '.tyto'))).toEqual([]);
  });

  it('refuses a path that climbs out as written, if one ever reaches it', async () => {
    const written = await ports().write('../elsewhere/aula.brief', 'x');
    expect(codes(written)).toEqual(['E_RECIPE_BRIEF']);
    expect(await readdir(outside)).toEqual([]);
  });
});

describe('a folder that is not trusted', () => {
  it('writes nothing, asked on every call, so trust withdrawn after the plan stops the write', async () => {
    let trust: Trust = 'trusted';
    const briefs = ports(() => trust);
    expect(valueOf(await briefs.stat('aula.brief'))).toBeUndefined();

    trust = 'restricted';
    const written = await briefs.write('aula.brief', 'x');

    expect(codes(written)).toEqual(['E_RECIPE_BRIEF']);
    expect(written.ok ? '' : written.error[0]?.message).toContain('restricted');
    expect(await readdir(workspace)).toEqual(['.tyto', 'recipes']);
  });

  it('writes nothing for a recipe in no workspace', async () => {
    const written = await ports(() => 'trusted', false).write('aula.brief', 'x');
    expect(codes(written)).toEqual(['E_RECIPE_BRIEF']);
  });
});
