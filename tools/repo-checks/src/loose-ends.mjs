#!/usr/bin/env node
/**
 * The items of the `## Left open` sections of the pull requests merged since a date
 * (TYTO-629). It replaces the shell loop of `/loose-ends` step 3 and the GNU `date -d` of its
 * step 1 (and their Codex port), which nobody tested and which `date` on macOS does not run.
 *
 *     node tools/repo-checks/src/loose-ends.mjs --window [--since YYYY-MM-DD]
 *     node tools/repo-checks/src/loose-ends.mjs --since YYYY-MM-DD
 *
 * `--window` prints the start date: `--since` when given, otherwise 7 days ago (UTC), and then
 * says it is the default. Without `--window`, the script reads every pull request merged
 * since that date and prints one line per item, `#<number>\t<item>`, in pull request order,
 * then a summary. `--repo owner/name` names another repository than `origin`'s.
 *
 * A section runs from a line starting `## Left open` to the next `## ` heading. An item is a
 * top-level bullet (`- ` or `* `) or a table row; a table's header row (its first row) and
 * its `---` row are skipped. The shell loop skipped only the first row of the whole section,
 * so a second table printed its header as an item. A pull request without the section prints
 * one line that says so.
 */
import { pathToFileURL } from 'node:url';

import {
  gh as defaultGh,
  ghJson,
  git as defaultGit,
  parseFlags,
  resolveRepo,
} from './command-runner.mjs';

/** How many merged pull requests one `gh pr list` reads; a full page is reported. */
export const PULL_REQUEST_LIMIT = 200;

/** The window when no start date is given, in days. */
export const DEFAULT_WINDOW_DAYS = 7;

export const NO_SECTION = '(no Left open section)';

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SECTION = /^## Left open/u;
const HEADING = /^## /u;
const BULLET = /^[-*] /u;
const TABLE_ROW = /^\|/u;
const SEPARATOR_ROW = /^\| *:?-+/u;

/**
 * @typedef {import('./command-runner.mjs').Runner} Runner
 */

/**
 * The start date: the one given, or `DEFAULT_WINDOW_DAYS` before `now`, as UTC `YYYY-MM-DD`.
 *
 * @param {{ since?: string, now?: Date }} [options]
 * @returns {{ since: string, isDefault: boolean }}
 */
export function windowStart({ since, now = new Date() } = {}) {
  if (since !== undefined) {
    if (!DATE.test(since) || Number.isNaN(Date.parse(since))) {
      throw new Error(`--since must be a date, YYYY-MM-DD: ${since}`);
    }
    return { since, isDefault: false };
  }
  const start = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { since: start.toISOString().slice(0, 10), isDefault: true };
}

/**
 * The items of every `## Left open` section of one pull request body.
 *
 * @param {string} body
 * @returns {{ hasSection: boolean, items: string[] }}
 */
export function leftOpenItems(body) {
  const lines = body.replace(/\r/gu, '').split('\n');
  /** @type {string[]} */
  const items = [];
  let inSection = false;
  let hasSection = false;
  lines.forEach((line, index) => {
    if (SECTION.test(line)) {
      inSection = true;
      hasSection = true;
      return;
    }
    if (HEADING.test(line)) inSection = false;
    if (!inSection) return;
    if (TABLE_ROW.test(line)) {
      const isHeader = !TABLE_ROW.test(lines[index - 1] ?? '');
      if (!isHeader && !SEPARATOR_ROW.test(line)) items.push(line);
      return;
    }
    if (BULLET.test(line)) items.push(line);
  });
  return { hasSection, items };
}

/**
 * The pull requests merged since a date, by number, lowest first.
 *
 * @param {{ gh?: Runner, repo: string, since: string }} options
 * @returns {{ numbers: number[], full: boolean }}
 */
export function mergedPullRequests({ gh = defaultGh, repo, since }) {
  const list = ghJson(
    [
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'merged',
      '--search',
      `merged:>=${since}`,
      '--json',
      'number',
      '--limit',
      String(PULL_REQUEST_LIMIT),
    ],
    { gh },
  );
  if (!Array.isArray(list)) throw new Error('gh pr list did not print a JSON array');
  const numbers = list.map((entry) => Number(entry.number)).sort((a, b) => a - b);
  return { numbers, full: numbers.length >= PULL_REQUEST_LIMIT };
}

/**
 * One pull request's body; an empty body is `''`.
 *
 * @param {{ gh?: Runner, repo: string, number: number }} options
 * @returns {string}
 */
export function pullRequestBody({ gh = defaultGh, repo, number }) {
  const view = ghJson(['pr', 'view', String(number), '--repo', repo, '--json', 'body'], { gh });
  const body = /** @type {{ body?: unknown }} */ (view).body;
  return typeof body === 'string' ? body : '';
}

/**
 * @param {{ window: boolean, since?: string, repo?: string, now?: Date }} options
 * @param {{ git?: Runner, gh?: Runner, print?: (line: string) => void }} [io]
 * @returns {number} the exit code
 */
export function run(options, { git = defaultGit, gh = defaultGh, print = console.log } = {}) {
  const { since, isDefault } = windowStart({ since: options.since, now: options.now });
  if (options.window) {
    print(
      isDefault
        ? `since ${since} (the default, ${DEFAULT_WINDOW_DAYS} days ago: no start date was given)`
        : `since ${since}`,
    );
    return 0;
  }

  const repo = resolveRepo({ repo: options.repo, git });
  const { numbers, full } = mergedPullRequests({ gh, repo, since });
  let itemCount = 0;
  /** @type {number[]} */
  const withItems = [];
  /** @type {number[]} */
  const withoutSection = [];
  /** @type {number[]} */
  const emptySection = [];
  for (const number of numbers) {
    const { hasSection, items } = leftOpenItems(pullRequestBody({ gh, repo, number }));
    if (!hasSection) {
      withoutSection.push(number);
      print(`#${number}\t${NO_SECTION}`);
      continue;
    }
    if (items.length === 0) emptySection.push(number);
    else withItems.push(number);
    for (const item of items) print(`#${number}\t${item}`);
    itemCount += items.length;
  }

  /** @param {number[]} list */
  const named = (list) => list.map((number) => `#${number}`).join(', ') || 'none';
  print('');
  print(`repository: ${repo}; merged since ${since}${isDefault ? ' (the default window)' : ''}`);
  print(`pull requests read: ${numbers.length}`);
  if (full) {
    print(
      `warning: ${PULL_REQUEST_LIMIT} is the page size, so the list was cut: sweep again from a later date`,
    );
  }
  print(`items: ${itemCount} from ${withItems.length} pull requests`);
  print(`no Left open section: ${named(withoutSection)}`);
  print(`a Left open section with no item: ${named(emptySection)}`);
  return 0;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  /** @param {string} name */
  const value = (name) => (typeof flags[name] === 'string' ? flags[name] : undefined);
  const window = flags.window === true;
  const since = value('since');
  if (!window && since === undefined) {
    console.error(
      'usage: loose-ends.mjs --window [--since YYYY-MM-DD] | --since YYYY-MM-DD   [--repo owner/name]',
    );
    process.exitCode = 2;
    return;
  }
  process.exitCode = run({ window, since, repo: value('repo') });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
