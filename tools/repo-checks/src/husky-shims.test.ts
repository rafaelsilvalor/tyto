import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `core.hooksPath` is `.husky/_`, a relative path, and git resolves it inside whichever
 * worktree runs the hook. Husky generates that folder on install and marks it ignored, so a
 * worktree that never ran `pnpm install` had no hooks folder at all and committed with no
 * hook and no warning (TYTO-233). The shims are therefore committed: every checkout has
 * them, and husky's own rewrite on install produces the same bytes instead of a diff.
 *
 * That only holds while the committed copies match what the installed husky writes. A husky
 * bump that changes the shim would otherwise leave every install with a dirty tree, or
 * leave the committed shim calling a runner that no longer behaves the same way. So the
 * committed files are compared with husky's own sources here, and the index mode is read
 * because Linux runs a hook only when it is executable — Windows never notices a 100644.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const shimFolder = join(repoRoot, '.husky/_');
const huskyPackage = join(repoRoot, 'node_modules/husky');

/** Husky 9 writes this one line into every hook shim; `index.js` holds it with `$` escaped. */
const SHIM = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"';
const SHIM_IN_HUSKY_SOURCE = '#!/usr/bin/env sh\\n. "\\$(dirname "\\$0")/h"';

const UPDATE_HINT =
  'Husky changed what it generates. Run `pnpm install`, then commit what it wrote under ' +
  '.husky/_ (git add -f, and git update-index --chmod=+x for the hook files).';

/** The hook names husky generates a shim for, read from its source rather than restated. */
function huskyHookNames(): string[] {
  const source = readFileSync(join(huskyPackage, 'index.js'), 'utf8');
  const list = /let l = \[([^\]]+)\]/.exec(source);
  if (list === null) throw new Error(`Hook list not found in husky's index.js. ${UPDATE_HINT}`);
  return [...list[1]!.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!).sort();
}

/** `git ls-files -s` for the shim folder: path → mode, as a fresh clone will check out. */
function indexModes(): Map<string, string> {
  const listing = execFileSync('git', ['ls-files', '-s', '--', '.husky/_'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const modes = new Map<string, string>();
  for (const line of listing.split('\n').filter(Boolean)) {
    const [meta, path] = line.split('\t');
    modes.set(path!.replace('.husky/_/', ''), meta!.split(' ')[0]!);
  }
  return modes;
}

describe('committed husky shims (.husky/_)', () => {
  const hooks = huskyHookNames();

  it('commit one shim per hook husky generates, plus the runner and the ignore file', () => {
    const committed = [...indexModes().keys()].sort();
    expect(committed, UPDATE_HINT).toEqual([...hooks, '.gitignore', 'h'].sort());
  });

  it('keep the runner byte-equal to the installed husky', () => {
    const committed = readFileSync(join(shimFolder, 'h'), 'utf8');
    const installed = readFileSync(join(huskyPackage, 'husky'), 'utf8');
    expect(committed, UPDATE_HINT).toBe(installed);
  });

  it('keep every hook shim equal to the line husky writes', () => {
    const source = readFileSync(join(huskyPackage, 'index.js'), 'utf8');
    expect(source.includes(SHIM_IN_HUSKY_SOURCE), UPDATE_HINT).toBe(true);
    for (const hook of hooks) {
      expect(readFileSync(join(shimFolder, hook), 'utf8'), `${hook}: ${UPDATE_HINT}`).toBe(SHIM);
    }
  });

  it('check every hook shim and the runner out executable', () => {
    const notExecutable = [...indexModes()]
      .filter(([path, mode]) => path !== '.gitignore' && mode !== '100755')
      .map(([path, mode]) => `${path} ${mode}`);
    expect(notExecutable, 'git update-index --chmod=+x on these').toEqual([]);
  });

  it('have a shim for every hook script this repository writes', () => {
    // A script under `.husky/` with no shim of the same name is never run by git, silently.
    const scripts = readdirSync(join(repoRoot, '.husky')).filter((name) => name !== '_');
    expect(hooks, 'add the hook to husky or rename the script').toEqual(
      expect.arrayContaining(scripts),
    );
  });
});
