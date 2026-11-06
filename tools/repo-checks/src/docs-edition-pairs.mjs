#!/usr/bin/env node
/**
 * The user manual pages this branch changed in one edition only (TYTO-629, ADR 0101). It
 * replaces the shell loop of `/docs-sync` step 4 (and its Codex port), which nobody tested.
 *
 *     node tools/repo-checks/src/docs-edition-pairs.mjs [--base origin/main]
 *
 * `apps/docs/test/parity.test.ts` compares the two editions' file sets, nothing inside the
 * files, so a page changed in one edition while its twin stayed as it was passes it. This
 * script reads the pages changed against the base, committed or not, plus the untracked ones,
 * and prints one line per page:
 *
 * - `MISSING HALF`: the twin does not exist (or still exists after this page was deleted), so
 *   the parity test fails;
 * - `ONE EDITION`: the twin exists and did not change: for review, the test passes;
 * - `both editions`: the twin changed too;
 * - `english-only guide`: a page of `ENGLISH_ONLY_PAGES` in `apps/docs/src/sections.ts`, which
 *   has no pt-BR twin by design. That list is read from the file as text, so nothing is built
 *   first.
 *
 * Pages under `public/` are not manual pages and are skipped. Run from the repository root.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { git as defaultGit, parseFlags } from './command-runner.mjs';

export const PAGES = 'apps/docs/pages';
export const PT_BR = 'pt-BR';
export const SECTIONS_FILE = 'apps/docs/src/sections.ts';

/**
 * @typedef {import('./command-runner.mjs').Runner} Runner
 * @typedef {{ status: string, path: string }} Change
 * @typedef {{ exists: (file: string) => boolean, read: (file: string) => string }} Files
 */

/** @type {Files} */
export const nodeFiles = {
  exists: (file) => existsSync(file),
  read: (file) => readFileSync(file, 'utf8'),
};

/** @param {string} output */
const lines = (output) =>
  output
    .split('\n')
    .map((line) => line.replace(/\r$/u, ''))
    .filter((line) => line !== '');

/**
 * The page paths of `ENGLISH_ONLY_PAGES`, read from the text of `sections.ts`: the quoted
 * `.md` strings between the declaration and its closing bracket.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function englishOnlyPages(text) {
  const match = /ENGLISH_ONLY_PAGES\b[^=]*=\s*\[([^\]]*)\]/u.exec(text);
  if (match === null) throw new Error(`no ENGLISH_ONLY_PAGES array in ${SECTIONS_FILE}`);
  return [...(match[1] ?? '').matchAll(/'([^']+\.md)'/gu)].map(([, page]) => page ?? '');
}

/**
 * The manual pages changed against the base: `git diff --name-status` (committed and
 * uncommitted; a rename counts as its new path) plus the untracked pages, as added.
 *
 * @param {{ git?: Runner, base: string }} options
 * @returns {Change[]}
 */
export function changedPages({ git = defaultGit, base }) {
  const tracked = lines(git(['diff', '--name-status', base, '--', PAGES])).map((line) => {
    const fields = line.split('\t');
    return { status: (fields[0] ?? '').slice(0, 1), path: fields.at(-1) ?? '' };
  });
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard', '--', PAGES])).map(
    (file) => ({ status: 'A', path: file }),
  );
  return [...tracked, ...untracked].filter(({ path: file }) => file.endsWith('.md'));
}

/**
 * The other edition's path of a page, and the page's path inside its edition. `undefined` for
 * a file outside the manual's pages (`public/`).
 *
 * @param {string} file
 * @returns {{ relative: string, twin: string } | undefined}
 */
export function twinOf(file) {
  const inPages = path.posix.relative(PAGES, file);
  if (inPages.startsWith('..') || inPages.startsWith('public/')) return undefined;
  const ptBrPrefix = `${PT_BR}/`;
  if (inPages.startsWith(ptBrPrefix)) {
    const relative = inPages.slice(ptBrPrefix.length);
    return { relative, twin: path.posix.join(PAGES, relative) };
  }
  return { relative: inPages, twin: path.posix.join(PAGES, PT_BR, inPages) };
}

/**
 * One line per changed page, or nothing for a deleted page whose twin is gone too.
 *
 * @param {{ changes: Change[], englishOnly: string[], exists: (file: string) => boolean }} input
 * @returns {string[]}
 */
export function classifyChanges({ changes, englishOnly, exists }) {
  const changedPaths = new Set(changes.map(({ path: file }) => file));
  return changes.flatMap(({ status, path: file }) => {
    const pair = twinOf(file);
    if (pair === undefined) return [];
    const { relative, twin } = pair;
    if (englishOnly.includes(relative)) return [`english-only guide (${status}): ${file}`];
    if (status === 'D') {
      return exists(twin)
        ? [`MISSING HALF (${status}): ${file} deleted, ${twin} still exists: parity fails`]
        : [];
    }
    if (!exists(twin)) return [`MISSING HALF (${status}): ${twin} does not exist: parity fails`];
    if (!changedPaths.has(twin)) {
      return [`ONE EDITION (${status}): ${file} changed, ${twin} did not: review (parity passes)`];
    }
    return [`both editions (${status}): ${relative}`];
  });
}

/**
 * @param {{ base: string, root?: string }} options
 * @param {{ git?: Runner, files?: Files, pathFlavour?: path.PlatformPath, print?: (line: string) => void }} [io]
 * @returns {number} the exit code
 */
export function run(
  options,
  {
    git = defaultGit,
    files = nodeFiles,
    pathFlavour = process.platform === 'win32' ? path.win32 : path.posix,
    print = console.log,
  } = {},
) {
  const root = options.root ?? git(['rev-parse', '--show-toplevel']).trim();
  /** @param {string} file a path relative to the root, with forward slashes */
  const onDisk = (file) => pathFlavour.join(root, ...file.split('/'));
  const englishOnly = englishOnlyPages(files.read(onDisk(SECTIONS_FILE)));
  // `git ls-files` prints paths relative to its working directory: read both at the root.
  /** @type {Runner} */
  const gitAtRoot = (args) => git(args, { cwd: root });
  const changes = changedPages({ git: gitAtRoot, base: options.base });
  print(`manual pages changed against ${options.base}, untracked included: ${changes.length}`);
  for (const line of classifyChanges({
    changes,
    englishOnly,
    exists: (file) => files.exists(onDisk(file)),
  })) {
    print(line);
  }
  return 0;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const unknown = Object.keys(flags).filter((name) => name !== 'base');
  const base = flags.base ?? 'origin/main';
  if (unknown.length > 0 || typeof base !== 'string') {
    console.error('usage: docs-edition-pairs.mjs [--base origin/main]');
    process.exitCode = 2;
    return;
  }
  process.exitCode = run({ base });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
