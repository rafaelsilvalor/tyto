import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

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

function inside(root: string, path: string): boolean {
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
