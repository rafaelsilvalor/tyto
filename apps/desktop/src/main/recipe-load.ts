import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve } from 'node:path';

import { DATA_FILE_MAX_BYTES, INCLUDED_RECIPE_MAX_BYTES, isInside } from '@tyto/io';
import { parseRecipe, referencesOf } from '@tyto/recipe';

import { checkEntryName } from './explorer.js';

/**
 * Load recipe (TYTO-402, ADR 0176 decision 7): a `.recipe` from anywhere on disk is **copied**
 * into a folder of the workspace, with the recipes its `run` lines include and the data files
 * its arguments name, so it runs there with its files beside it and its state in the workspace.
 *
 * - **Nothing is overwritten, and nothing is half-copied.** Every file the load would write is
 *   looked for first; when any of them is already there, none is written and each one taken is
 *   answered in `skipped`. Each write is `wx` besides, so a file that appears in between is
 *   skipped too, never replaced.
 * - **A reference that leaves the source folder is reported, not followed** (ADR 0112): a path
 *   that climbs with `..` is never read, and a link inside the folder that leads out of it is
 *   refused after `realpath`. A reference that does not parse, names `.tyto` (the workspace's
 *   own settings, ADR 0112) or a file that is not there is reported too.
 * - Reads are capped at the size a run would read (`INCLUDED_RECIPE_MAX_BYTES`,
 *   `DATA_FILE_MAX_BYTES`), and at {@link RECIPE_LOAD_FILES_MAX} files.
 *
 * Names in the answer are relative to the source folder, as the recipe writes them: main keeps
 * the paths (ADR 0086).
 */

/** Why a file a recipe names was not copied. */
export type RecipeLoadReason =
  | 'leaves-folder'
  | 'outside'
  | 'refused'
  | 'reserved'
  | 'missing'
  | 'too-large'
  | 'not-parsed'
  | 'too-many'
  | 'write-failed';

export interface RecipeLoadReport {
  readonly name: string;
  readonly reason: RecipeLoadReason;
}

export type RecipeLoad =
  | {
      readonly ok: true;
      /** The copied recipe, for main to open; `undefined` when nothing was written. */
      readonly recipe: string | undefined;
      readonly copied: readonly string[];
      readonly skipped: readonly string[];
      readonly reported: readonly RecipeLoadReport[];
    }
  | { readonly ok: false; readonly reason: 'unreadable' };

/** The most files one load copies, the recipe included. */
export const RECIPE_LOAD_FILES_MAX = 200;

/** A `run` line's name, as the runner reads it (`recipe-runner.ts`' `RECIPE_NAME`). */
const RECIPE_NAME = /^[A-Za-z0-9][\w-]*$/u;

const RECIPE_EXTENSION = '.recipe';

interface Planned {
  /** Relative to both folders, with the platform's separators. */
  readonly relative: string;
  readonly bytes: Buffer;
}

type Read = { readonly ok: true; readonly bytes: Buffer } | RecipeLoadReport;

/**
 * Reads `relative` inside `folder` (whose real path is `folderReal`): lexically inside first,
 * then again after `realpath`, a regular file no larger than `cap`.
 */
async function readInside(
  folder: string,
  folderReal: string,
  relative: string,
  cap: number,
  name: string,
): Promise<Read> {
  const target = resolve(folder, relative);
  if (!isInside(folder, target)) return { name, reason: 'leaves-folder' };
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    return { name, reason: 'missing' };
  }
  if (!isInside(folderReal, real)) return { name, reason: 'outside' };
  try {
    const found = await stat(real);
    if (!found.isFile()) return { name, reason: 'missing' };
    if (found.size > cap) return { name, reason: 'too-large' };
    return { ok: true, bytes: await readFile(real) };
  } catch {
    return { name, reason: 'missing' };
  }
}

/**
 * A data reference's path as a relative path to copy, or why it is not one: every segment a
 * name the explorer would accept, and none of them `.tyto`.
 */
function relativeOf(path: string): string | RecipeLoadReason {
  const segments = path.split(/[\\/]/u).filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) return 'refused';
  if (segments.some((segment) => segment.toLowerCase() === '.tyto')) return 'reserved';
  if (!segments.every(checkEntryName)) return 'refused';
  return normalize(segments.join('/'));
}

const keyOf = (relative: string): string => relative.replaceAll('\\', '/').toLowerCase();
const shown = (relative: string): string => relative.replaceAll('\\', '/');

/**
 * Everything a load of `source` would copy, read from the source folder, and what it reports.
 * The recipe first, then each file in the order it is first named; an included recipe's own
 * references are followed the same way, each file once.
 */
export async function planRecipeLoad(
  source: string,
): Promise<
  { ok: true; planned: readonly Planned[]; reported: readonly RecipeLoadReport[] } | { ok: false }
> {
  const folder = dirname(source);
  const name = basename(source);
  if (!name.toLowerCase().endsWith(RECIPE_EXTENSION)) return { ok: false };
  let folderReal: string;
  try {
    folderReal = await realpath(folder);
  } catch {
    return { ok: false };
  }
  const first = await readInside(folder, folderReal, name, INCLUDED_RECIPE_MAX_BYTES, name);
  if (!('ok' in first)) return { ok: false };

  const planned: Planned[] = [{ relative: name, bytes: first.bytes }];
  const seen = new Set([keyOf(name)]);
  const reported: RecipeLoadReport[] = [];
  const report = (entry: RecipeLoadReport): void => {
    if (!reported.some((each) => each.name === entry.name && each.reason === entry.reason)) {
      reported.push(entry);
    }
  };
  const recipes: Planned[] = [planned[0] as Planned];

  /** Reads one file into the plan, once; its bytes when it was added. */
  const add = async (relative: string, written: string, cap: number): Promise<Buffer | null> => {
    const key = keyOf(relative);
    if (seen.has(key)) return null;
    seen.add(key);
    if (planned.length >= RECIPE_LOAD_FILES_MAX) {
      report({ name: written, reason: 'too-many' });
      return null;
    }
    const read = await readInside(folder, folderReal, relative, cap, written);
    if (!('ok' in read)) {
      report(read);
      return null;
    }
    planned.push({ relative, bytes: read.bytes });
    return read.bytes;
  };

  for (let index = 0; index < recipes.length; index += 1) {
    const recipe = recipes[index] as Planned;
    const parsed = parseRecipe(recipe.bytes.toString('utf8'));
    if (!parsed.ok) {
      report({ name: shown(recipe.relative), reason: 'not-parsed' });
      continue;
    }
    const references = referencesOf(parsed.value);
    for (const refused of references.refused) report({ name: refused.text, reason: 'refused' });
    for (const included of references.recipes) {
      if (!RECIPE_NAME.test(included.name)) {
        report({ name: included.name, reason: 'refused' });
        continue;
      }
      const relative = `${included.name}${RECIPE_EXTENSION}`;
      const bytes = await add(relative, relative, INCLUDED_RECIPE_MAX_BYTES);
      if (bytes !== null) recipes.push({ relative, bytes });
    }
    for (const data of references.data) {
      if (data.leavesFolder) {
        report({ name: data.path, reason: 'leaves-folder' });
        continue;
      }
      const relative = relativeOf(data.path);
      if (relative === 'refused' || relative === 'reserved') {
        report({ name: data.path, reason: relative });
        continue;
      }
      await add(relative, data.path, DATA_FILE_MAX_BYTES);
    }
  }
  return { ok: true, planned, reported };
}

/** Whether anything at all is at `path`, a broken link included. */
const taken = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** Whether the file would land on something there: itself, or a file where a folder must be. */
async function clashes(target: string, relative: string): Promise<boolean> {
  const segments = relative.split(/[\\/]/u);
  let at = target;
  for (const [index, segment] of segments.entries()) {
    at = join(at, segment);
    if (index === segments.length - 1) return taken(at);
    try {
      if (!(await lstat(at)).isDirectory()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined;

/**
 * Copies `source` and what it names into `target`, a folder main already found inside the
 * workspace. Nothing is written when any file would land on one already there.
 */
export async function loadRecipe(source: string, target: string): Promise<RecipeLoad> {
  const plan = await planRecipeLoad(source);
  if (!plan.ok) return { ok: false, reason: 'unreadable' };
  const reported = [...plan.reported];

  const skipped: string[] = [];
  for (const each of plan.planned) {
    if (await clashes(target, each.relative)) skipped.push(shown(each.relative));
  }
  if (skipped.length > 0) {
    return { ok: true, recipe: undefined, copied: [], skipped, reported };
  }

  let targetReal: string;
  try {
    targetReal = await realpath(target);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const copied: string[] = [];
  let recipe: string | undefined;
  for (const [index, each] of plan.planned.entries()) {
    const path = join(target, each.relative);
    try {
      if (!isInside(target, path)) throw Object.assign(new Error('outside'), { code: 'OUTSIDE' });
      const folder = dirname(path);
      await mkdir(folder, { recursive: true });
      // A folder made under the target may already have been a link that leads elsewhere.
      if (!isInside(targetReal, await realpath(folder))) {
        throw Object.assign(new Error('outside'), { code: 'OUTSIDE' });
      }
      await writeFile(path, each.bytes, { flag: 'wx' });
    } catch (cause) {
      if (codeOf(cause) === 'EEXIST') skipped.push(shown(each.relative));
      else reported.push({ name: shown(each.relative), reason: 'write-failed' });
      continue;
    }
    copied.push(shown(each.relative));
    if (index === 0) recipe = path;
  }
  return { ok: true, recipe, copied, skipped, reported };
}
