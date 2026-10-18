#!/usr/bin/env node
/**
 * Says which desktop e2e files a change reaches (TYTO-309), so a draft push or an executor's
 * machine can run those instead of all of them. The full suite still runs before merge and
 * on `main`; this script only decides what runs in between.
 *
 * **It is biased to run more.** A miss may only ever add files, never drop one:
 *
 * - a changed path in `RUN_EVERYTHING` — the preload, the IPC contracts, the main entry, the
 *   build config, the e2e harness, the lockfile, the map and this script — runs everything;
 * - a changed path in the desktop scope (`ci-scope.mjs`) that no entry of
 *   `desktop-e2e-map.json` covers runs everything;
 * - a map entry may say `"all"`, which runs everything;
 * - a diff that cannot be read runs everything.
 *
 * What is left out of the decision is only what cannot change an e2e result: Markdown, the
 * `.changeset/` folder, and unit tests (`*.test.ts` that are neither `*.desktop.test.ts` nor
 * `*.package.test.ts`). A changed e2e file selects itself.
 *
 * Plain JavaScript and Node only, like `ci-scope.mjs`: it runs before `pnpm install`.
 *
 *     node tools/repo-checks/src/e2e-select.mjs --local             # origin/main + working tree
 *     node tools/repo-checks/src/e2e-select.mjs --base A --head B   # three-dot diff A...B
 *     node tools/repo-checks/src/e2e-select.mjs                     # the pull_request merge commit
 *
 * `--json` prints the decision as JSON instead of the summary and the command.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { changedFiles, matchesScope, scopeOf } from './ci-scope.mjs';

export const MAP_PATH = 'tools/repo-checks/src/desktop-e2e-map.json';
const DESKTOP = 'apps/desktop';
const E2E_DIRECTORY = `${DESKTOP}/e2e`;

/**
 * Paths whose change reaches every e2e file, or the harness that runs them, or this decision
 * itself. Globs, in the syntax of `globToRegExp`. Every non-test file under `e2e/` (helpers,
 * setup, global setup, `__fixtures__`) runs everything too, by the rule in `select` rather than
 * by a glob here, since the test files beside them select only themselves: a helper is shared
 * by most files, and a fixture's readers are not worth tracking one by one.
 */
export const RUN_EVERYTHING = [
  `${DESKTOP}/src/preload/**`,
  `${DESKTOP}/shared/{ipc,commands,settings}.ts`,
  `${DESKTOP}/shared/i18n/**`,
  `${DESKTOP}/src/main/{index,ipc,window}.ts`,
  `${DESKTOP}/src/renderer/{main,shell}.ts`,
  `${DESKTOP}/src/renderer/{shell,tokens}.css`,
  `${DESKTOP}/src/renderer/index.html`,
  `${DESKTOP}/electron.vite.config.ts`,
  `${DESKTOP}/vite.guest.config.ts`,
  `${DESKTOP}/package.json`,
  `${DESKTOP}/electron-builder.yml`,
  `${DESKTOP}/bundled-node.json`,
  `${DESKTOP}/scripts/**`,
  `${DESKTOP}/vitest.{desktop,package}.config.ts`,
  `${DESKTOP}/tsconfig*`,
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  '.npmrc',
  'tsconfig*.json',
  MAP_PATH,
  'tools/repo-checks/src/e2e-select.mjs',
  'tools/repo-checks/src/ci-scope.mjs',
  '.github/workflows/desktop-e2e.yml',
];

/**
 * Paths that cannot change an e2e result. The unit-test rule leaves out the four `e2e/*.test.ts`
 * files `vitest.config.ts` runs as unit tests (launch isolation, renderer tokens, asar patch,
 * port file): they check the harness and run in `pnpm check`, not in `test:desktop`.
 */
export const IGNORED = ['**/*.md', '.changeset/**', `${DESKTOP}/vitest.config.ts`];
const E2E_TEST = /\.(desktop|package)\.test\.ts$/u;
const UNIT_TEST = /\.test\.ts$/u;

/**
 * `*` matches within one path segment, `**` across segments, `{a,b}` either alternative.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*' && glob[index + 1] === '*') {
      // `**/` matches zero or more directories; a trailing `**` matches the rest.
      if (glob[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') source += '[^/]*';
    else if (character === '{') source += '(?:';
    else if (character === '}') source += ')';
    else if (character === ',') source += '|';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[.+^$()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

/** @param {string} path @param {string[]} globs */
export function matchesAny(path, globs) {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

/**
 * The e2e files on disk, by suite. Counted rather than written down, so the total in every
 * decision is the total that would run.
 *
 * @param {string} repoRoot
 */
export function e2eFilesOnDisk(repoRoot) {
  const names = readdirSync(`${repoRoot}/${E2E_DIRECTORY}`).sort();
  return {
    desktop: names.filter((name) => name.endsWith('.desktop.test.ts')),
    package: names.filter((name) => name.endsWith('.package.test.ts')),
  };
}

/** @param {string} repoRoot */
export function readMap(repoRoot) {
  return JSON.parse(readFileSync(`${repoRoot}/${MAP_PATH}`, 'utf8'));
}

/**
 * @typedef {{ paths: string[], e2e: string[] | 'all', why: string }} MapEntry
 * @typedef {{
 *   mode: 'selected' | 'full',
 *   files: string[],
 *   count: number,
 *   total: number,
 *   packageSuite: boolean,
 *   reasons: string[],
 * }} Selection
 */

/**
 * @param {{
 *   changed: string[] | null,
 *   failure?: string,
 *   scope: string[],
 *   map: { entries: MapEntry[] },
 *   onDisk: { desktop: string[], package: string[] },
 * }} input
 * @returns {Selection}
 */
export function select({ changed, failure, scope, map, onDisk }) {
  const total = onDisk.desktop.length;
  const full = (reasons) => ({
    mode: /** @type {const} */ ('full'),
    files: onDisk.desktop.map((name) => `e2e/${name}`),
    count: total,
    total,
    packageSuite: true,
    reasons,
  });
  if (changed === null) return full([`no diff to select by (${failure ?? 'no reason given'})`]);

  const fullReasons = [];
  const selected = new Set();
  const reasons = [];
  for (const path of changed) {
    if (matchesAny(path, RUN_EVERYTHING)) {
      fullReasons.push(`${path}: on the run-everything list`);
      continue;
    }
    if (matchesAny(path, IGNORED)) continue;
    if (path.startsWith(`${E2E_DIRECTORY}/`)) {
      if (E2E_TEST.test(path)) {
        selected.add(path.slice(E2E_DIRECTORY.length + 1));
        reasons.push(`${path}: itself`);
      } else if (!UNIT_TEST.test(path)) {
        fullReasons.push(`${path}: part of the e2e harness`);
      }
      continue;
    }
    if (UNIT_TEST.test(path)) continue;
    if (!matchesScope(path, scope)) continue;
    const entries = map.entries.filter((entry) => matchesAny(path, entry.paths));
    if (entries.length === 0) {
      fullReasons.push(`${path}: in the desktop scope and on no map entry`);
      continue;
    }
    for (const entry of entries) {
      if (entry.e2e === 'all') fullReasons.push(`${path}: mapped to all (${entry.why})`);
      else for (const name of entry.e2e) selected.add(name);
    }
    reasons.push(`${path}: ${entries.map((entry) => entry.why).join('; ')}`);
  }
  if (fullReasons.length > 0) return full(fullReasons);

  const files = [...selected]
    .filter((name) => name.endsWith('.desktop.test.ts'))
    .sort()
    .map((name) => `e2e/${name}`);
  return {
    mode: 'selected',
    files,
    count: files.length,
    total,
    packageSuite: [...selected].some((name) => name.endsWith('.package.test.ts')),
    reasons,
  };
}

/**
 * The files `base...head` changes: what `head` adds since it left `base`, as a pull request
 * diff reads it. With `workingTree`, also what is staged, unstaged or untracked.
 *
 * @returns {{ changed: string[] | null, failure?: string }}
 */
export function threeDotDiff(
  { base, head = 'HEAD', workingTree = false },
  git = (args) => execFileSync('git', args, { encoding: 'utf8' }),
) {
  try {
    const lines = (output) => output.split('\n').filter((line) => line !== '');
    if (!workingTree) return { changed: lines(git(['diff', '--name-only', `${base}...${head}`])) };
    const mergeBase = git(['merge-base', base, 'HEAD']).trim();
    const tracked = lines(git(['diff', '--name-only', mergeBase]));
    const untracked = lines(git(['ls-files', '--others', '--exclude-standard']));
    return { changed: [...new Set([...tracked, ...untracked])].sort() };
  } catch (error) {
    return {
      changed: null,
      failure: `git failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    };
  }
}

/** @param {Selection} selection */
export function commandsFor(selection) {
  const desktop =
    selection.mode === 'full'
      ? 'pnpm --filter @tyto/desktop test:desktop'
      : selection.count === 0
        ? null
        : `pnpm --filter @tyto/desktop test:desktop ${selection.files.join(' ')}`;
  return [
    desktop,
    selection.packageSuite ? 'pnpm --filter @tyto/desktop test:package' : null,
  ].filter((command) => command !== null);
}

/** @param {Selection} selection */
export function summarize(selection) {
  const head =
    selection.mode === 'full'
      ? `full: ${selection.total} of ${selection.total} desktop e2e files`
      : `selected: ${selection.count} of ${selection.total} desktop e2e files`;
  const commands = commandsFor(selection);
  return [
    `${head}; package suite ${selection.packageSuite ? 'runs' : 'skipped'}`,
    ...selection.reasons.map((reason) => `  ${reason}`),
    ...(commands.length === 0 ? ['nothing to run'] : commands),
  ].join('\n');
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const repoRoot = process.cwd();
  const base = argument('--base');
  const diff = process.argv.includes('--local')
    ? threeDotDiff({ base: base ?? 'origin/main', workingTree: true })
    : base !== undefined
      ? threeDotDiff({ base, head: argument('--head') ?? 'HEAD' })
      : changedFiles(process.env.GITHUB_EVENT_NAME ?? '');
  const selection = select({
    ...diff,
    scope: scopeOf(repoRoot, 'desktop'),
    map: readMap(repoRoot),
    onDisk: e2eFilesOnDisk(repoRoot),
  });
  console.log(
    process.argv.includes('--json') ? JSON.stringify(selection, null, 2) : summarize(selection),
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
