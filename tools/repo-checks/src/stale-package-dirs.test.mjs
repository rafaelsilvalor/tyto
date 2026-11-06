import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { describeFolder, LEFTOVER_ENTRIES, run, untrackedFolders } from './stale-package-dirs.mjs';

/** A runner that answers only the calls it was given, and throws on any other. */
function fakeRunner(answers) {
  return (args) => {
    const key = args.join(' ');
    if (!(key in answers)) throw new Error(`unexpected call: ${key}`);
    return answers[key];
  };
}

/**
 * An in-memory file system keyed by the joined path, so a test fails when the script joins
 * with the other platform's separator. `tree` maps a folder to its entries; a name ending in
 * `/` is a folder.
 */
function fakeFileSystem(tree) {
  const removed = [];
  return {
    removed,
    readdir: (dir) => {
      if (!(dir in tree)) throw new Error(`ENOENT: ${dir}`);
      return tree[dir].map((entry) => ({
        name: entry.replace(/\/$/u, ''),
        isDirectory: entry.endsWith('/'),
      }));
    },
    remove: (dir) => {
      removed.push(dir);
      delete tree[dir];
    },
  };
}

/**
 * `apps/desktop` is a live package; `packages/gone` holds only leftovers; `packages/empty`
 * holds nothing; `tools/draft` holds somebody's untracked file next to `node_modules`.
 */
function world(pathFlavour, root) {
  const at = (...parts) => pathFlavour.join(root, ...parts);
  const fs = fakeFileSystem({
    [at('apps')]: ['desktop/', 'README.md'],
    [at('apps', 'desktop')]: ['package.json', 'node_modules/'],
    [at('packages')]: ['gone/', 'empty/'],
    [at('packages', 'gone')]: ['.turbo/', 'node_modules/'],
    [at('packages', 'empty')]: [],
    [at('tools')]: ['draft/'],
    [at('tools', 'draft')]: ['node_modules/', 'notes.md'],
  });
  const git = fakeRunner({
    'rev-parse --show-toplevel': `${root}\n`,
    'ls-files -- apps/desktop': 'apps/desktop/package.json\n',
    'ls-files -- packages/empty': '',
    'ls-files -- packages/gone': '',
    'ls-files -- tools/draft': '',
  });
  return { fs, git, at };
}

function runIn(options, io) {
  const printed = [];
  const code = run(options, { ...io, print: (line) => printed.push(line) });
  return { code, printed };
}

describe('LEFTOVER_ENTRIES', () => {
  it('holds the two gitignored names a branch switch leaves, and nothing else', () => {
    expect([...LEFTOVER_ENTRIES].sort()).toEqual(['.turbo', 'node_modules']);
  });
});

describe('untrackedFolders', () => {
  it('lists folders git tracks nothing in, and calls stale only those holding leftovers', () => {
    const { fs, git } = world(path.posix, '/repo');
    const folders = untrackedFolders({ root: '/repo', git, fs, pathFlavour: path.posix });
    expect(folders.map(describeFolder)).toEqual([
      'stale: packages/empty (tracked files: 0; holds: nothing)',
      'stale: packages/gone (tracked files: 0; holds: .turbo node_modules)',
      'untracked, holds more, left alone: tools/draft (holds: node_modules notes.md)',
    ]);
  });

  it('skips a workspace root that does not exist', () => {
    const fs = fakeFileSystem({ ['/repo/packages']: [] });
    expect(
      untrackedFolders({ root: '/repo', git: fakeRunner({}), fs, pathFlavour: path.posix }),
    ).toEqual([]);
  });
});

describe('run', () => {
  for (const [name, pathFlavour, root] of [
    ['posix', path.posix, '/home/someone/tyto'],
    ['win32', path.win32, 'C:/work/tyto'],
  ]) {
    it(`lists and deletes nothing without --delete (${name})`, () => {
      const { fs, git } = world(pathFlavour, root);
      const { code, printed } = runIn({ delete: false }, { git, fs, pathFlavour });
      expect(code).toBe(0);
      expect(fs.removed).toEqual([]);
      expect(printed.at(-1)).toBe('2 stale folder(s): run again with --delete to delete them');
    });

    it(`deletes the stale folders alone, after printing the proof again (${name})`, () => {
      const { fs, git, at } = world(pathFlavour, root);
      const { printed } = runIn({ delete: true }, { git, fs, pathFlavour });
      expect(fs.removed).toEqual([at('packages', 'empty'), at('packages', 'gone')]);
      expect(printed).toContain(
        'proof for packages/gone: tracked files: 0; holds: .turbo node_modules',
      );
      expect(printed).toContain('deleted: packages/gone');
      expect(printed.join('\n')).not.toMatch(/deleted: tools\/draft/u);
    });
  }

  it('keeps a folder that gained a file between the list and the deletion', () => {
    const { fs, git, at } = world(path.posix, '/repo');
    const readdir = fs.readdir;
    let reads = 0;
    fs.readdir = (dir) => {
      if (dir === at('packages', 'gone')) {
        reads += 1;
        if (reads > 1) return [...readdir(dir), { name: 'new.ts', isDirectory: false }];
      }
      return readdir(dir);
    };
    const { printed } = runIn({ delete: true }, { git, fs, pathFlavour: path.posix });
    expect(fs.removed).toEqual([at('packages', 'empty')]);
    expect(printed).toContain('not deleted: packages/gone changed since it was listed');
  });

  it('says so when no folder is untracked', () => {
    const fs = fakeFileSystem({ ['/repo/apps']: [], ['/repo/packages']: [], ['/repo/tools']: [] });
    const git = fakeRunner({ 'rev-parse --show-toplevel': '/repo\n' });
    const { printed } = runIn({ delete: true }, { git, fs, pathFlavour: path.posix });
    expect(printed).toEqual([
      'repository: /repo',
      'no untracked package folder: nothing to delete',
    ]);
  });
});
