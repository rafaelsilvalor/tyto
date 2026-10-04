#!/usr/bin/env node
/**
 * Decides, inside a required job, whether this pull request changed anything that job
 * measures — and says which answer it reached, in the log and in the job summary (ADR 0064).
 *
 * A required status check has to report on every pull request, and a `paths:` filter makes
 * a workflow report on most of them never, which leaves the merge button waiting for a
 * context that is not coming. So `desktop-e2e.yml` and `visual.yml` run on every pull
 * request and ask this script first. When nothing in scope changed the job still goes
 * green, and the summary says `skipped: no change under …` with the list it compared
 * against — the green is a claim about the diff, written down, not a green by construction.
 *
 * **It fails closed.** When the diff cannot be computed — a shallow checkout that lost the
 * base, a commit that is not the merge commit `pull_request` checks out, an event this
 * script was not written for — it says so and runs the suite. A skip is only ever the
 * result of having read the diff.
 *
 * Plain JavaScript rather than TypeScript, because it runs before `pnpm install`: the point
 * of skipping is not to pay for the install, so it can import nothing but Node.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Files outside any package that change what every package builds into. A new root
 * `tsconfig*.json` joins without editing this list, which is why those are matched by
 * pattern and the rest by name. The script itself is here because a change to it changes
 * every decision it makes, and the one run that proves the change is the full one.
 */
const ROOT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  '.npmrc',
  '.nvmrc',
  '.node-version',
  'tools/repo-checks/src/ci-scope.mjs',
];
const ROOT_TSCONFIG = /^tsconfig(\.[\w-]+)?\.json$/u;

const WORKSPACE_ROOTS = ['packages', 'apps', 'tools'];

/**
 * What each required suite measures, beyond the files every suite shares.
 *
 * `desktop` is a package name and its scope is computed from the dependency graph: the app
 * bundles most of the workspace, and a hand-written list is how `packages/core` went
 * unchecked on 13 of the 40 pull requests before this script existed. `apps/cli` is added
 * by hand because the graph cannot see it — three e2e suites run the built CLI and compare
 * folders, so the CLI is a dependency of the tests without being one of the package.
 *
 * `visual` keeps the list its `paths:` filter carried (TYTO-138 moved it, it did not
 * widen it); `packages/export-*` is expanded against the disk so a new exporter joins.
 */
const SUITES = {
  desktop: {
    workflow: '.github/workflows/desktop-e2e.yml',
    package: '@tyto/desktop',
    extra: ['apps/cli/'],
  },
  visual: {
    workflow: '.github/workflows/visual.yml',
    extra: [
      'packages/export-*/',
      'packages/raster/',
      'packages/templates/',
      'packages/core/',
      'packages/fonts/',
      'apps/cli/',
      'tools/template-preview/',
    ],
  },
};

/** @param {string} repoRoot */
function workspaceManifests(repoRoot) {
  return WORKSPACE_ROOTS.flatMap((root) => {
    const rootPath = `${repoRoot}/${root}`;
    if (!existsSync(rootPath)) return [];
    return readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const manifestPath = `${rootPath}/${entry.name}/package.json`;
        if (!existsSync(manifestPath)) return [];
        return [
          {
            directory: `${root}/${entry.name}/`,
            manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
          },
        ];
      });
  });
}

/**
 * The directory of `packageName` and of every workspace package it reaches through
 * `dependencies` or `devDependencies`, transitively. Dev dependencies count because the
 * e2e suites import them (`@tyto/raster` is one), and a suite that breaks is the event.
 *
 * @param {string} repoRoot
 * @param {string} packageName
 * @returns {string[]}
 */
export function workspaceClosure(repoRoot, packageName) {
  const byName = new Map(workspaceManifests(repoRoot).map((entry) => [entry.manifest.name, entry]));
  const seen = new Set();
  const pending = [packageName];
  while (pending.length > 0) {
    const name = pending.pop();
    const entry = byName.get(name);
    if (entry === undefined || seen.has(name)) continue;
    seen.add(name);
    const { dependencies = {}, devDependencies = {} } = entry.manifest;
    for (const [dependency, range] of Object.entries({ ...dependencies, ...devDependencies })) {
      if (String(range).startsWith('workspace:')) pending.push(dependency);
    }
  }
  return [...seen].map((name) => byName.get(name).directory).sort();
}

/** `packages/export-*` → one entry per directory on disk that matches it. */
function expandWildcard(repoRoot, entry) {
  if (!entry.includes('*')) return [entry];
  const [parent, pattern] = entry.replace(/\/$/u, '').split('/');
  const prefix = pattern.replace('*', '');
  return readdirSync(`${repoRoot}/${parent}`, { withFileTypes: true })
    .filter((child) => child.isDirectory() && child.name.startsWith(prefix))
    .map((child) => `${parent}/${child.name}/`);
}

/**
 * Every path this suite measures: directories end in `/` and match by prefix, files match
 * exactly.
 *
 * @param {string} repoRoot
 * @param {keyof typeof SUITES} suite
 * @returns {string[]}
 */
export function scopeOf(repoRoot, suite) {
  const definition = SUITES[suite];
  if (definition === undefined) throw new Error(`unknown suite "${suite}"`);
  const rootTsconfigs = readdirSync(repoRoot).filter((name) => ROOT_TSCONFIG.test(name));
  const graph =
    definition.package === undefined ? [] : workspaceClosure(repoRoot, definition.package);
  const extra = definition.extra.flatMap((entry) => expandWildcard(repoRoot, entry));
  return [
    ...new Set([...graph, ...extra, definition.workflow, ...ROOT_FILES, ...rootTsconfigs]),
  ].sort();
}

/**
 * @param {{ changed: string[] | null, scope: string[], failure?: string }} input
 *   `changed` is `null` when the diff could not be read; `failure` says why.
 * @returns {{ run: boolean, message: string }}
 */
export function decide({ changed, scope, failure }) {
  if (changed === null) {
    return {
      run: true,
      message: `running: no pull-request diff to scope by (${failure ?? 'no reason given'}), so nothing is skipped`,
    };
  }
  const inScope = changed.filter((file) =>
    scope.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)),
  );
  if (inScope.length > 0) {
    const shown = inScope.slice(0, 10).join(', ');
    const more = inScope.length > 10 ? ` and ${inScope.length - 10} more` : '';
    return {
      run: true,
      message: `running: ${inScope.length} of ${changed.length} changed files are in scope (${shown}${more})`,
    };
  }
  return {
    run: false,
    message: `skipped: no change under ${scope.join(', ')} (${changed.length} changed files, none in scope)`,
  };
}

/**
 * The files this pull request changes, read off the merge commit `pull_request` checks out:
 * its first parent is the base it was merged onto, so the diff is exactly what merging
 * would add — the same thing the suite would test. Anything else returns a failure.
 *
 * @param {string} eventName
 * @returns {{ changed: string[] | null, failure?: string }}
 */
export function changedFiles(
  eventName,
  git = (args) => execFileSync('git', args, { encoding: 'utf8' }),
) {
  if (eventName !== 'pull_request') {
    return { changed: null, failure: `event "${eventName}" is not a pull request` };
  }
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ');
    if (parents.length !== 3) {
      return {
        changed: null,
        failure: `HEAD has ${parents.length - 1} parents, not the 2 of a merge commit`,
      };
    }
    const output = git(['diff', '--name-only', 'HEAD^1', 'HEAD']);
    return { changed: output.split('\n').filter((line) => line !== '') };
  } catch (error) {
    return {
      changed: null,
      failure: `git failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    };
  }
}

function main() {
  const suite = process.argv[2];
  const { changed, failure } = changedFiles(process.env.GITHUB_EVENT_NAME ?? '');
  const { run, message } = decide({ changed, scope: scopeOf(process.cwd(), suite), failure });
  console.log(message);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${suite}\n\n${message}\n`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
