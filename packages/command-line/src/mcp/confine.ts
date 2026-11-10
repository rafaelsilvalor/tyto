import { lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * Where an agent's path may point: inside the folder `tyto mcp` was started in, or inside its
 * workspace (ADR 0179, the confinement of ADR 0111).
 *
 * Checked twice. First as typed, before the disk is touched, so a path outside gets the same
 * answer whether or not something is there: "no such file" for one and "outside" for the other
 * would let an agent probe what exists beyond the folder. Then as the real path, so a link
 * inside the folder that leads out of it is refused as the path it leads to.
 */

export type Confined =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string };

export function inside(root: string, path: string): boolean {
  const between = relative(root, path);
  return between === '' || (!between.startsWith('..') && !isAbsolute(between));
}

export async function confinedPath(
  typed: string,
  cwd: string,
  roots: readonly string[],
): Promise<Confined> {
  const outside: Confined = {
    ok: false,
    reason: `${typed} is outside the folder tyto mcp was started in and its workspace; only paths inside them are read (ADR 0179)`,
  };
  const asked = resolve(cwd, typed);
  if (!roots.some((root) => inside(resolve(root), asked))) return outside;

  let real: string;
  try {
    real = await realpath(asked);
  } catch {
    return { ok: false, reason: `${typed}: no such file` };
  }
  const realRoots = await Promise.all(
    roots.map((root) => realpath(root).catch(() => resolve(root))),
  );
  return realRoots.some((root) => inside(root, real)) ? { ok: true, path: real } : outside;
}

/** Where a write lands, and whether a file is already there (ADR 0185). */
export type WriteTarget =
  | { readonly ok: true; readonly path: string; readonly exists: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Where a write to `typed` would land, confined as {@link confinedPath} confines a read, for a
 * path that may not exist yet.
 *
 * As typed first, the same answer whether or not something is there. Then: a file that is there
 * is followed to its real path; one that is not is placed under the real path of its nearest
 * existing folder, because a link on the way decides where it would be created, and what does
 * not exist yet cannot be a link. A link that leads nowhere is refused: `realpath` cannot say
 * where it points, and a write through it would create the file wherever that is.
 */
export async function confinedWriteTarget(
  typed: string,
  cwd: string,
  roots: readonly string[],
): Promise<WriteTarget> {
  const outside: WriteTarget = {
    ok: false,
    reason: `${typed} is outside the folder tyto mcp was started in and its workspace; only paths inside them are written (ADR 0185)`,
  };
  const asked = resolve(cwd, typed);
  if (!roots.some((root) => inside(resolve(root), asked))) return outside;

  const realRoots = await Promise.all(
    roots.map((root) => realpath(root).catch(() => resolve(root))),
  );
  const within = (path: string): boolean => realRoots.some((root) => inside(root, path));

  let there = true;
  try {
    await lstat(asked);
  } catch {
    there = false;
  }
  if (there) {
    let real: string;
    try {
      real = await realpath(asked);
    } catch {
      return {
        ok: false,
        reason: `${typed} is a link that leads nowhere; nothing is written through it`,
      };
    }
    if (!within(real)) return outside;
    if (!(await stat(real)).isFile()) return { ok: false, reason: `${typed} is not a file` };
    return { ok: true, path: real, exists: true };
  }

  let existing = dirname(asked);
  const rest = [basename(asked)];
  for (;;) {
    try {
      const real = join(await realpath(existing), ...rest);
      return within(real) ? { ok: true, path: real, exists: false } : outside;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return outside;
      rest.unshift(basename(existing));
      existing = parent;
    }
  }
}
