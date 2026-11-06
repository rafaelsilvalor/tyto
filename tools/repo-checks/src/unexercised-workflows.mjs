#!/usr/bin/env node
/**
 * What a pull request's head did not exercise, read from the workflows themselves (TYTO-629):
 * the workflows with no run on the head SHA, each with its triggers, and the jobs that ran
 * but were skipped. It replaces the two shell loops of `/pr-watch` step 6 (and its Codex
 * port), which nobody tested and which read the triggers with an `awk` that missed the flow
 * style (`push: { branches: [main] }`) most of the workflows use.
 *
 *     node tools/repo-checks/src/unexercised-workflows.mjs --sha <head SHA, all 40 digits>
 *
 * Options: `--repo owner/name` (default: the repository `origin` points at) and `--workflows`
 * (default `.github/workflows`, read from the checkout, so on the PR's branch these are the
 * PR's own workflows). A run counts for the workflow whose file its `path` names, and for
 * nothing else.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parse } from 'yaml';

import {
  gh as defaultGh,
  ghJson,
  git as defaultGit,
  parseFlags,
  resolveRepo,
} from './command-runner.mjs';

/** How many runs and jobs one REST page reads; more is reported, not read. */
export const PAGE_SIZE = 100;

/** The trigger keys that narrow when a trigger fires, whose values the report prints. */
const FILTER_KEYS = [
  'branches',
  'branches-ignore',
  'tags',
  'tags-ignore',
  'paths',
  'paths-ignore',
  'types',
  'workflows',
];

/**
 * @typedef {import('./command-runner.mjs').Runner} Runner
 * @typedef {{ list: (dir: string) => string[], read: (file: string) => string }} WorkflowFiles
 * @typedef {{ id: number, path: string }} Run
 */

/** @type {WorkflowFiles} */
export const nodeWorkflowFiles = {
  list: (dir) => readdirSync(dir),
  read: (file) => readFileSync(file, 'utf8'),
};

/** @param {unknown} value */
const listOf = (value) => (Array.isArray(value) ? value.map(String).join(', ') : String(value));

/**
 * A workflow's triggers in one line: each event, with the filters that narrow it,
 * `push (branches: main); workflow_dispatch`.
 *
 * @param {string} text the workflow file
 * @returns {string}
 */
export function describeTriggers(text) {
  const document = /** @type {Record<string, unknown> | null} */ (parse(text));
  const on = document?.on;
  if (on === undefined || on === null) return '(no on: key)';
  if (typeof on === 'string') return on;
  if (Array.isArray(on)) return on.map(String).join('; ');
  return Object.entries(/** @type {Record<string, unknown>} */ (on))
    .map(([event, settings]) => {
      if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
        return event;
      }
      const filters = FILTER_KEYS.filter((key) => key in settings).map(
        (key) => `${key}: ${listOf(/** @type {Record<string, unknown>} */ (settings)[key])}`,
      );
      return filters.length === 0 ? event : `${event} (${filters.join('; ')})`;
    })
    .join('; ');
}

/**
 * The runs on one commit.
 *
 * @param {{ gh?: Runner, repo: string, sha: string }} options
 * @returns {{ runs: Run[], total: number }}
 */
export function runsOnCommit({ gh = defaultGh, repo, sha }) {
  const answer =
    /** @type {{ total_count?: number, workflow_runs?: { id: number, path: string }[] }} */ (
      ghJson(['api', `repos/${repo}/actions/runs?head_sha=${sha}&per_page=${PAGE_SIZE}`], { gh })
    );
  const runs = (answer.workflow_runs ?? []).map(({ id, path: file }) => ({ id, path: file }));
  return { runs, total: answer.total_count ?? runs.length };
}

/**
 * The workflow files under `.github/workflows` with no run on the commit. A run's `path` is
 * the workflow file relative to the repository root (`.github/workflows/ci.yml`); a reusable
 * workflow's run names its caller, so `workflow_call` workflows show up here as not run.
 *
 * @param {{ files: string[], runs: Run[] }} input
 * @returns {string[]}
 */
export function workflowsWithoutRun({ files, runs }) {
  const ran = new Set(runs.map(({ path: file }) => file));
  return files.filter((file) => !ran.has(file));
}

/**
 * The skipped jobs of one run, as `<workflow>\t<job>`.
 *
 * @param {{ gh?: Runner, repo: string, id: number }} options
 * @returns {string[]}
 */
export function skippedJobs({ gh = defaultGh, repo, id }) {
  const answer =
    /** @type {{ jobs?: { workflow_name: string, name: string, conclusion: string | null }[] }} */ (
      ghJson(['api', `repos/${repo}/actions/runs/${id}/jobs?per_page=${PAGE_SIZE}`], { gh })
    );
  return (answer.jobs ?? [])
    .filter(({ conclusion }) => conclusion === 'skipped')
    .map(({ workflow_name: workflow, name }) => `${workflow}\t${name}`);
}

/**
 * @param {{ sha: string, repo?: string, workflows: string }} options
 * @param {{ git?: Runner, gh?: Runner, files?: WorkflowFiles, print?: (line: string) => void }} [io]
 * @returns {number} the exit code
 */
export function run(
  options,
  { git = defaultGit, gh = defaultGh, files = nodeWorkflowFiles, print = console.log } = {},
) {
  const repo = resolveRepo({ repo: options.repo, git });
  const directory = options.workflows.replace(/\\/gu, '/').replace(/\/$/u, '');
  const workflowFiles = files
    .list(directory)
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort()
    .map((name) => path.posix.join(directory, name));
  const { runs, total } = runsOnCommit({ gh, repo, sha: options.sha });

  print(`repository: ${repo}; head: ${options.sha}`);
  print(`runs on the head: ${runs.length}`);
  if (total > runs.length) {
    print(`warning: ${total} runs exist and ${runs.length} were read (one page)`);
  }

  print('workflows with no run on the head, and their triggers:');
  const missing = workflowsWithoutRun({ files: workflowFiles, runs });
  for (const file of missing) print(`  ${file}: ${describeTriggers(files.read(file))}`);
  if (missing.length === 0) print('  none');

  print('jobs that ran but were skipped (workflow, job):');
  const skipped = runs.flatMap(({ id }) => skippedJobs({ gh, repo, id }));
  for (const line of skipped) print(`  ${line}`);
  if (skipped.length === 0) print('  none');
  return 0;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  /** @param {string} name */
  const value = (name) => (typeof flags[name] === 'string' ? flags[name] : undefined);
  const sha = value('sha');
  // The runs endpoint matches `head_sha` whole: a short SHA finds no run, which would read as
  // "nothing exercised".
  if (sha === undefined || !/^[0-9a-f]{40}$/u.test(sha)) {
    console.error(
      'usage: unexercised-workflows.mjs --sha <head SHA>   [--repo owner/name] [--workflows .github/workflows]',
    );
    process.exitCode = 2;
    return;
  }
  process.exitCode = run({
    sha,
    repo: value('repo'),
    workflows: value('workflows') ?? '.github/workflows',
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
