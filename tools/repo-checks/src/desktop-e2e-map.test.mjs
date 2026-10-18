import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  e2eFilesOnDisk,
  globToRegExp,
  matchesAny,
  readMap,
  RUN_EVERYTHING,
} from './e2e-select.mjs';

/**
 * The guard on `desktop-e2e-map.json` (TYTO-309). The selector already runs everything for a
 * path no entry covers, so a gap in the map costs minutes rather than a skipped file. What
 * this guards is the map rotting quietly: an e2e file no change can select, an entry naming a
 * file that was renamed, a glob that matches nothing since a move, and a new source file that
 * only ever runs the full suite because nobody mapped it.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const map = readMap(repoRoot);
const onDisk = e2eFilesOnDisk(repoRoot);
const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .filter((line) => line !== '');

const listed = new Set(map.entries.flatMap((entry) => (entry.e2e === 'all' ? [] : entry.e2e)));

describe('the desktop e2e map', () => {
  it.each([...onDisk.desktop, ...onDisk.package])('%s is listed by at least one entry', (name) => {
    expect(listed.has(name)).toBe(true);
  });

  it('lists only e2e files that exist', () => {
    const existing = new Set([...onDisk.desktop, ...onDisk.package]);
    expect([...listed].filter((name) => !existing.has(name))).toEqual([]);
  });

  it('has globs that each match at least one tracked path', () => {
    const globs = [...map.entries.flatMap((entry) => entry.paths), ...RUN_EVERYTHING];
    const unmatched = globs.filter(
      (glob) => !tracked.some((path) => globToRegExp(glob).test(path)),
    );
    expect(unmatched).toEqual([]);
  });

  it('gives every entry a reason', () => {
    expect(
      map.entries.filter((entry) => typeof entry.why !== 'string' || entry.why === ''),
    ).toEqual([]);
  });

  it('covers every non-test source file of the app, or puts it on the run-everything list', () => {
    const sources = tracked.filter(
      (path) => /^apps\/desktop\/(src|shared)\//u.test(path) && !path.endsWith('.test.ts'),
    );
    const unmapped = sources.filter(
      (path) =>
        !matchesAny(path, RUN_EVERYTHING) &&
        !map.entries.some((entry) => matchesAny(path, entry.paths)),
    );
    expect(unmapped).toEqual([]);
  });

  it('keeps run-everything paths out of the map, where an entry would only mislead', () => {
    const shadowed = map.entries
      .flatMap((entry) => entry.paths)
      .filter((glob) =>
        tracked.some((path) => globToRegExp(glob).test(path) && matchesAny(path, RUN_EVERYTHING)),
      );
    expect(shadowed).toEqual([]);
  });
});
