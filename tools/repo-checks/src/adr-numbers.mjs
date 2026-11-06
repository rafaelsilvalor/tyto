#!/usr/bin/env node
/**
 * ADR numbers, read from `origin/main` and from every open pull request (TYTO-629). Two open
 * branches have raced for one number before (TYTO-576), so a number is never read from the
 * local checkout alone. It replaces the shell loops `/new-adr` step 2 and `/pre-push` step 4
 * carried (and their Codex ports), which nobody tested.
 *
 *     node tools/repo-checks/src/adr-numbers.mjs --next     # the next free number
 *     node tools/repo-checks/src/adr-numbers.mjs --check    # this branch's ADRs against both
 *
 * Options: `--repo owner/name` (default: the repository `origin` points at), `--base`
 * (default `origin/main`), `--head` (default `HEAD`) and `--branch` (this branch's name, whose
 * own pull request `--check` skips; default `git branch --show-current`). Fetch `origin/main`
 * first: the script reads the ref as it is.
 *
 * An open pull request's ADRs come from its file list through the paginated REST endpoint,
 * statuses `added` and `renamed`, as the loops did: the `files` field of `gh pr list` stops
 * at 100 files.
 *
 * `--check` exits 1 when a number clashes, naming each clash; `--next` always exits 0.
 */
import { pathToFileURL } from 'node:url';

import {
  gh as defaultGh,
  ghJson,
  git as defaultGit,
  parseFlags,
  resolveRepo,
} from './command-runner.mjs';

const ADR_FILE = /^docs\/adr\/(\d{4})-[^/]*$/u;

/** How many open pull requests one `gh pr list` reads; a full page is reported. */
export const PULL_REQUEST_LIMIT = 200;

/** The statuses under which a pull request brings an ADR file into `docs/adr`. */
const ADDING_STATUSES = new Set(['added', 'renamed']);

/**
 * @typedef {import('./command-runner.mjs').Runner} Runner
 * @typedef {{ number: number, headRefName: string, adrs: string[] }} PullRequestAdrs
 */

/**
 * The four digits of an ADR file under `docs/adr/`, or `undefined` for any other path.
 *
 * @param {string} path
 * @returns {string | undefined}
 */
export function adrNumberOf(path) {
  return ADR_FILE.exec(path.trim())?.[1];
}

/** @param {string} output */
const lines = (output) =>
  output
    .split('\n')
    .map((line) => line.replace(/\r$/u, ''))
    .filter((line) => line !== '');

/**
 * The ADR files at a revision.
 *
 * @param {{ git?: Runner, base?: string }} [options]
 * @returns {string[]}
 */
export function adrsAt({ git = defaultGit, base = 'origin/main' } = {}) {
  return lines(git(['ls-tree', '--name-only', base, 'docs/adr/'])).filter(
    (path) => adrNumberOf(path) !== undefined,
  );
}

/**
 * The ADR files this branch adds since it left `base`, as a pull request diff reads them.
 *
 * @param {{ git?: Runner, base?: string, head?: string }} [options]
 * @returns {string[]}
 */
export function adrsAddedByBranch({ git = defaultGit, base = 'origin/main', head = 'HEAD' } = {}) {
  return lines(
    git(['diff', '--name-only', '--diff-filter=A', `${base}...${head}`, '--', 'docs/adr/']),
  ).filter((path) => adrNumberOf(path) !== undefined);
}

/**
 * The open pull requests, with their head branch.
 *
 * @param {{ gh?: Runner, repo: string }} options
 * @returns {{ number: number, headRefName: string }[]}
 */
export function openPullRequests({ gh = defaultGh, repo }) {
  const list = ghJson(
    [
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--limit',
      String(PULL_REQUEST_LIMIT),
      '--json',
      'number,headRefName',
    ],
    { gh },
  );
  if (!Array.isArray(list)) throw new Error('gh pr list did not print a JSON array');
  return list.map((entry) => ({ number: entry.number, headRefName: entry.headRefName }));
}

/**
 * The ADR files one pull request adds or renames into `docs/adr`. The status filter is here,
 * not in `--jq`, so a test reaches it.
 *
 * @param {{ gh?: Runner, repo: string, number: number }} options
 * @returns {string[]}
 */
export function adrsAddedByPullRequest({ gh = defaultGh, repo, number }) {
  const output = gh([
    'api',
    '--paginate',
    `repos/${repo}/pulls/${number}/files?per_page=100`,
    '--jq',
    '.[] | [.status, .filename] | @tsv',
  ]);
  return lines(output).flatMap((line) => {
    const [status = '', filename = ''] = line.split('\t');
    return ADDING_STATUSES.has(status) && adrNumberOf(filename) !== undefined ? [filename] : [];
  });
}

/**
 * Every open pull request with the ADRs it adds, read one pull request at a time.
 *
 * @param {{ gh?: Runner, repo: string }} options
 * @returns {{ pullRequests: PullRequestAdrs[], full: boolean }}
 */
export function readPullRequestAdrs({ gh = defaultGh, repo }) {
  const open = openPullRequests({ gh, repo });
  return {
    pullRequests: open.map(({ number, headRefName }) => ({
      number,
      headRefName,
      adrs: adrsAddedByPullRequest({ gh, repo, number }),
    })),
    full: open.length >= PULL_REQUEST_LIMIT,
  };
}

/** @param {string[]} numbers */
const highest = (numbers) => [...numbers].sort().at(-1);

/**
 * The next free number: the highest on `origin/main` and in the open pull requests, plus one,
 * written with four digits. Also the numbers two files on `origin/main` share.
 *
 * @param {{ onMain: string[], pullRequests: PullRequestAdrs[] }} input
 */
export function nextNumber({ onMain, pullRequests }) {
  const mainNumbers = onMain.map((path) => adrNumberOf(path) ?? '');
  const pullRequestNumbers = pullRequests.flatMap(({ adrs }) =>
    adrs.map((path) => adrNumberOf(path) ?? ''),
  );
  const seen = new Set();
  const shared = new Set();
  for (const number of mainNumbers) {
    if (seen.has(number)) shared.add(number);
    seen.add(number);
  }
  const highestOnMain = highest(mainNumbers);
  const highestInPullRequests = highest(pullRequestNumbers);
  const top = highest([highestOnMain, highestInPullRequests].filter((n) => n !== undefined));
  return {
    highestOnMain,
    sharedOnMain: [...shared].sort(),
    highestInPullRequests,
    next: String(Number(top ?? '0') + 1).padStart(4, '0'),
  };
}

/**
 * Each ADR this branch adds whose number is already used on `origin/main` or by another open
 * pull request. The pull request whose head is this branch is this branch's own, and skipped.
 *
 * @param {{ mine: string[], onMain: string[], pullRequests: PullRequestAdrs[], branch: string }} input
 * @returns {{ file: string, against: 'origin/main' | number, other: string }[]}
 */
export function findClashes({ mine, onMain, pullRequests, branch }) {
  const others = pullRequests.filter(({ headRefName }) => headRefName !== branch);
  return mine.flatMap((file) => {
    const number = adrNumberOf(file);
    const onMainClashes = onMain
      .filter((other) => other !== file && adrNumberOf(other) === number)
      .map((other) => ({ file, against: /** @type {const} */ ('origin/main'), other }));
    const pullRequestClashes = others.flatMap(({ number: pullRequest, adrs }) =>
      adrs
        .filter((other) => adrNumberOf(other) === number)
        .map((other) => ({ file, against: pullRequest, other })),
    );
    return [...onMainClashes, ...pullRequestClashes];
  });
}

/** @param {{ file: string, against: 'origin/main' | number, other: string }} clash */
export function describeClash({ file, against, other }) {
  return against === 'origin/main'
    ? `${file} clashes with origin/main: ${other}`
    : `${file} clashes with PR #${against}: ${other}`;
}

/**
 * @param {{ next: boolean, check: boolean, repo?: string, base: string, head: string, branch?: string }} options
 * @param {{ git?: Runner, gh?: Runner, print?: (line: string) => void }} [io]
 * @returns {number} the exit code
 */
export function run(options, { git = defaultGit, gh = defaultGh, print = console.log } = {}) {
  const repo = resolveRepo({ repo: options.repo, git });
  const onMain = adrsAt({ git, base: options.base });
  const { pullRequests, full } = readPullRequestAdrs({ gh, repo });
  print(`repository: ${repo}; base: ${options.base}`);
  print(`open pull requests read: ${pullRequests.length}`);
  if (full) {
    print(
      `warning: ${PULL_REQUEST_LIMIT} is the page size, so some open pull requests were not read`,
    );
  }

  if (options.next) {
    const result = nextNumber({ onMain, pullRequests });
    print(`highest on ${options.base}: ${result.highestOnMain ?? 'none'}`);
    print(
      `numbers two files share on ${options.base}: ${result.sharedOnMain.join(', ') || 'none'}`,
    );
    for (const { number, adrs } of pullRequests.filter(({ adrs }) => adrs.length > 0)) {
      print(`  PR #${number}: ${adrs.join(', ')}`);
    }
    print(`highest in open pull requests: ${result.highestInPullRequests ?? 'none'}`);
    print(`next free: ${result.next}`);
    return 0;
  }

  const branch = options.branch ?? git(['branch', '--show-current']).trim();
  const mine = adrsAddedByBranch({ git, base: options.base, head: options.head });
  print(`branch: ${branch} (its own pull request is skipped)`);
  print(`ADRs this branch adds: ${mine.join(', ') || 'none'}`);
  const clashes = findClashes({ mine, onMain, pullRequests, branch });
  for (const clash of clashes) print(describeClash(clash));
  if (clashes.length > 0) {
    print(
      `${clashes.length} clash(es): agree with the PR's owner, or the coordinator who reserved the number, which branch renumbers`,
    );
    return 1;
  }
  print('no clash');
  return 0;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const next = flags.next === true;
  const check = flags.check === true;
  if (next === check) {
    console.error(
      'usage: adr-numbers.mjs --next | --check   [--repo owner/name] [--base origin/main] [--head HEAD] [--branch name]',
    );
    process.exitCode = 2;
    return;
  }
  /** @param {string} name */
  const value = (name) => (typeof flags[name] === 'string' ? flags[name] : undefined);
  process.exitCode = run({
    next,
    check,
    repo: value('repo'),
    base: value('base') ?? 'origin/main',
    head: value('head') ?? 'HEAD',
    branch: value('branch'),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
