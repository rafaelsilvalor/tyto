import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AssetRef } from '@tyto/core';
import { type LocatingAssetResolver, isInside } from '@tyto/io';

/**
 * `inner`, answering a file it found only when the file's **real** path is inside one of
 * `roots` (TYTO-652, ADR 0179 amendment of 2026-11-09).
 *
 * `briefAssetResolver` already refuses a path that climbs out as written (`../`, an absolute
 * path), but reads no link's target — `contain.ts` says so: it is a mistake boundary, not a
 * sandbox. A link inside the folder that leads out of it therefore read the file it led to.
 * Here the found file is followed to where it really is, and a file outside is answered
 * exactly as a file that is not there, so the answer does not say which one it was.
 *
 * `locate` is confined the same way, because the decoded cache (ADR 0223) wraps this one and
 * finds the file it hands a plugin through it: the cited `.psd` must be inside the roots, and
 * the PNG decoded from it, which lives in `TYTO_HOME/cache/decoded/`, is answered by that
 * cache outside this check. A layer is the decoded cache's to say, so `layerOf` is forwarded.
 *
 * Only `tyto mcp` asks for this: an agent names the images, and ADR 0179 keeps it inside the
 * folder it was given. `tyto render` and `tyto watch` keep the mistake boundary alone.
 */
export function realPathConfined(
  inner: LocatingAssetResolver,
  roots: readonly string[],
): LocatingAssetResolver {
  // A root that does not exist confines nothing; resolved as written, it matches nothing real.
  const realRoots = Promise.all(roots.map((root) => realpath(root).catch(() => resolve(root))));
  /** `path` when its real path is inside a root; `undefined` when it is outside or not there. */
  async function confined(path: string): Promise<string | undefined> {
    const real = await realpath(path).catch(() => undefined);
    if (real === undefined) return undefined;
    return (await realRoots).some((root) => isInside(root, real)) ? path : undefined;
  }
  return {
    base: inner.base,
    ...(inner.searched === undefined ? {} : { searched: inner.searched }),
    async resolve(reference: string): Promise<AssetRef | undefined> {
      const asset = await inner.resolve(reference);
      if (asset?.path === undefined) return asset;
      return (await confined(asset.path)) === undefined ? undefined : asset;
    },
    async locate(reference: string): Promise<string | undefined> {
      const path = await inner.locate(reference);
      return path === undefined ? undefined : confined(path);
    },
    ...(inner.explain === undefined ? {} : { explain: inner.explain.bind(inner) }),
    ...(inner.layerOf === undefined ? {} : { layerOf: inner.layerOf.bind(inner) }),
  };
}
