#!/usr/bin/env node
/**
 * The package folders a branch switch left behind (TYTO-629). It replaces the shell loop of
 * `/fresh-worktree` step 5 (and its Codex port), which nobody tested.
 *
 *     node tools/repo-checks/src/stale-package-dirs.mjs            # list, delete nothing
 *     node tools/repo-checks/src/stale-package-dirs.mjs --delete   # prove again, then delete
 *
 * A folder under `apps/`, `packages/` or `tools/` is stale when both facts hold: git tracks no
 * file under it (`git ls-files` prints nothing), and it holds no entry besides `.turbo` and
 * `node_modules`. `git status --short` cannot find such a folder: both names are gitignored,
 * so it prints nothing for it, never `??`. A folder git tracks nothing in that holds anything
 * else is somebody's untracked work: it is listed as left alone and never deleted.
 *
 * `--delete` reads both facts again for each stale folder right before deleting it, prints
 * them, and deletes that folder alone. It works on the repository the current directory is
 * in (`git rev-parse --show-toplevel`), and never outside it.
 */
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { git as defaultGit, parseFlags } from './command-runner.mjs';

/** The workspace roots whose folders are packages. */
export const WORKSPACE_ROOTS = ['apps', 'packages', 'tools'];

/** What a folder may hold and still be stale: both are gitignored build and install output. */
export const LEFTOVER_ENTRIES = new Set(['.turbo', 'node_modules']);

/**
 * @typedef {import('./command-runner.mjs').Runner} Runner
 * @typedef {{ readdir: (dir: string) => { name: string, isDirectory: boolean }[], remove: (dir: string) => void }} FileSystem
 * @typedef {{ folder: string, tracked: number, holds: string[], stale: boolean }} Folder
 */

/** @type {FileSystem} */
export const nodeFileSystem = {
  readdir: (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    })),
  remove: (dir) => rmSync(dir, { recursive: true, force: true }),
};

/** @param {string} output */
const lines = (output) =>
  output
    .split('\n')
    .map((line) => line.replace(/\r$/u, ''))
    .filter((line) => line !== '');

/**
 * The two facts about one folder. `folder` is relative to the root, with forward slashes, as
 * git reads it; `pathFlavour` joins it onto the root for the file system.
 *
 * @param {{ root: string, folder: string, git?: Runner, fs: FileSystem, pathFlavour: path.PlatformPath }} options
 * @returns {Folder}
 */
export function inspectFolder({ root, folder, git = defaultGit, fs, pathFlavour }) {
  const tracked = lines(git(['ls-files', '--', folder], { cwd: root })).length;
  const holds = fs
    .readdir(pathFlavour.join(root, ...folder.split('/')))
    .map(({ name }) => name)
    .sort();
  const stale = tracked === 0 && holds.every((name) => LEFTOVER_ENTRIES.has(name));
  return { folder, tracked, holds, stale };
}

/**
 * Every folder under the workspace roots that git tracks nothing in, stale or not. A folder
 * with a tracked file is a live package, and is not listed.
 *
 * @param {{ root: string, git?: Runner, fs: FileSystem, pathFlavour: path.PlatformPath }} options
 * @returns {Folder[]}
 */
export function untrackedFolders({ root, git = defaultGit, fs, pathFlavour }) {
  return WORKSPACE_ROOTS.flatMap((workspaceRoot) => {
    /** @type {{ name: string, isDirectory: boolean }[]} */
    let entries;
    try {
      entries = fs.readdir(pathFlavour.join(root, workspaceRoot));
    } catch {
      return [];
    }
    return entries
      .filter(({ isDirectory }) => isDirectory)
      .map(({ name }) => path.posix.join(workspaceRoot, name))
      .sort()
      .map((folder) => inspectFolder({ root, folder, git, fs, pathFlavour }))
      .filter(({ tracked }) => tracked === 0);
  });
}

/** @param {Folder} folder */
export function describeFolder({ folder, tracked, holds, stale }) {
  const held = holds.join(' ') || 'nothing';
  return stale
    ? `stale: ${folder} (tracked files: ${tracked}; holds: ${held})`
    : `untracked, holds more, left alone: ${folder} (holds: ${held})`;
}

/**
 * @param {{ delete: boolean, root?: string }} options
 * @param {{ git?: Runner, fs?: FileSystem, pathFlavour?: path.PlatformPath, print?: (line: string) => void }} [io]
 * @returns {number} the exit code
 */
export function run(
  options,
  {
    git = defaultGit,
    fs = nodeFileSystem,
    pathFlavour = process.platform === 'win32' ? path.win32 : path.posix,
    print = console.log,
  } = {},
) {
  const root = options.root ?? git(['rev-parse', '--show-toplevel']).trim();
  print(`repository: ${root}`);
  const folders = untrackedFolders({ root, git, fs, pathFlavour });
  if (folders.length === 0) {
    print('no untracked package folder: nothing to delete');
    return 0;
  }
  for (const folder of folders) print(describeFolder(folder));
  const stale = folders.filter((folder) => folder.stale);
  if (!options.delete) {
    print(
      stale.length === 0
        ? 'nothing to delete'
        : `${stale.length} stale folder(s): run again with --delete to delete them`,
    );
    return 0;
  }
  for (const { folder } of stale) {
    const proof = inspectFolder({ root, folder, git, fs, pathFlavour });
    print(`proof for ${folder}: tracked files: ${proof.tracked}; holds: ${proof.holds.join(' ')}`);
    if (!proof.stale) {
      print(`not deleted: ${folder} changed since it was listed`);
      continue;
    }
    fs.remove(pathFlavour.join(root, ...folder.split('/')));
    print(`deleted: ${folder}`);
  }
  return 0;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = Object.keys(flags).filter((name) => name !== 'delete');
  if (unknown.length > 0) {
    console.error('usage: stale-package-dirs.mjs [--delete]');
    process.exitCode = 2;
    return;
  }
  process.exitCode = run({ delete: flags.delete === true });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
