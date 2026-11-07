import { posix, win32 } from 'node:path';

import { type Diagnostic, diagnostic } from '@tyto/core';

/**
 * How deep a `TYTO_HOME` can be before what Tyto writes under it stops fitting (TYTO-470).
 *
 * A fetch writes the deepest paths: `cache/plugin-files/<sha256 of the source>/<commit>/` and
 * the repository's own files under it. Measured on 2026-11-07 with a clone of a template
 * repository (tabela, v1.1.1): its deepest file is 46 characters below the copy's folder, so a
 * copy reaches the home's length plus 172 on Windows. Windows refuses a path of 260 characters
 * or more unless long paths are switched on, and `mkdtemp` refuses a folder of 248 or more even
 * then; the copy's file is the first to cross, so it is the one checked.
 *
 * The cache layout stays as it is: shorter names would fetch every installed copy once more.
 */

/** Below a copy's folder, the deepest file a template repository commonly holds (measured). */
export const COMMON_DEEPEST_FILE = 46;

const SHA256_HEX = 64;
const COMMIT_HEX = 40;

/** The longest path a system accepts, in characters, without the terminating NUL. */
export function pathLimitOf(platform: NodeJS.Platform): number {
  // Windows' MAX_PATH is 260 with the NUL; Linux and macOS take far longer paths, so only a
  // single name over 255 stops them, which the error itself reports (`ENAMETOOLONG`).
  return platform === 'win32' ? 259 : 4095;
}

export interface HomePathOptions {
  /** Whose separators the paths use; `process.platform` by default. */
  readonly platform?: NodeJS.Platform;
  /** The longest path accepted; `pathLimitOf(platform)` by default. Tests set a small one. */
  readonly limit?: number;
}

function pathsOf(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

/** The longest path a fetch is expected to write under `home`. */
export function longestPathUnder(home: string, platform: NodeJS.Platform): number {
  const copy = pathsOf(platform).join(
    home,
    'cache',
    'plugin-files',
    'f'.repeat(SHA256_HEX),
    'f'.repeat(COMMIT_HEX),
  );
  return copy.length + 1 + COMMON_DEEPEST_FILE;
}

function tooLong(home: string, length: number, reason: string): Diagnostic {
  return diagnostic('E_TYTO_HOME_PATH_TOO_LONG', { home, length: String(length), reason });
}

/**
 * Before anything is written: the diagnostic when the longest path a fetch writes under
 * `home` is over the limit, so the run stops on one line instead of a failure inside a fetch.
 */
export function checkHomePath(home: string, options: HomePathOptions = {}): Diagnostic | undefined {
  const platform = options.platform ?? process.platform;
  const limit = options.limit ?? pathLimitOf(platform);
  const length = longestPathUnder(home, platform);
  return length > limit ? tooLong(home, length, `over the ${limit} this system allows`) : undefined;
}

/**
 * After the fact: the diagnostic when `cause` is the system refusing a path under `home` for
 * its length, and undefined for anything else, which stays the failure it is. Windows says
 * `ENAMETOOLONG` for some calls and `ENOENT` for others (measured: `mkdtemp` and `mkdir`), so
 * an `ENOENT` counts only for a path over the platform's limit.
 */
export function homePathProblem(
  cause: unknown,
  home: string,
  platform: NodeJS.Platform = process.platform,
): Diagnostic | undefined {
  const error = cause as NodeJS.ErrnoException | undefined;
  const path = typeof error?.path === 'string' ? error.path : undefined;
  if (path === undefined) return undefined;
  const paths = pathsOf(platform);
  const inside = paths.relative(home, path);
  if (inside.startsWith('..') || paths.isAbsolute(inside)) return undefined;
  const refused =
    error?.code === 'ENAMETOOLONG' ||
    (error?.code === 'ENOENT' && path.length > pathLimitOf(platform));
  return refused
    ? tooLong(home, path.length, `and the system refused it (${error?.code})`)
    : undefined;
}
