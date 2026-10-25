import { isInsidePath } from '@tyto/core';

import { isInside } from './contain.js';
import { realOfNearest, realOrResolved } from './real-paths.js';

/**
 * A path inside a workspace folder, checked the two ways ADR 0112 checks a project's places:
 * lexically with `core`'s path arithmetic, then again after `realpath`, so a junction or a
 * symbolic link inside the folder that lands outside is refused like a `..`.
 *
 * Written once because two adapters confine to the same folder — a recipe's data files
 * (ADR 0137) and a plugin's workspace files (ADR 0138) — and a containment check done two
 * ways is one that disagrees with itself.
 */

export type Confinement =
  /** The real path the caller reads or writes, and the real path of the folder. */
  | { readonly real: string; readonly realFolder: string }
  /** `outside` as written; `link` only once followed. */
  | { readonly refused: 'outside' | 'link' };

export interface ConfineOptions {
  /**
   * `existing` follows the path itself (a read: it is there or the read fails anyway);
   * `nearest` follows its nearest existing ancestor, because a file about to be written —
   * and the folders it goes in — may not exist yet, while a link on the way still decides
   * where it lands.
   */
  readonly follow: 'existing' | 'nearest';
}

export async function confineToWorkspace(
  folder: string,
  target: string,
  options: ConfineOptions,
): Promise<Confinement> {
  // Lexical first: no disk is touched for a path that climbs out as written.
  if (!isInsidePath(folder, target)) return { refused: 'outside' };
  const real =
    options.follow === 'nearest' ? await realOfNearest(target) : await realOrResolved(target);
  const realFolder = await realOrResolved(folder);
  if (!isInside(realFolder, real)) return { refused: 'link' };
  return { real, realFolder };
}
