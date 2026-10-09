#!/usr/bin/env node
/**
 * Fails a pull request that changes a versioned package without a changeset of its own
 * naming it (ADR 0070, TYTO-155).
 *
 * It replaces `changeset status` as the question `ci.yml` asks, because that command
 * answers a narrower one than everybody read it as. It fails only when `.changeset/` holds
 * no changeset at all, and never asks whether the changed packages are covered — so a
 * branch editing `packages/core` with no changeset passed whenever somebody else's was
 * pending, and a Dependabot bump went red whenever none was, which is every merge of the
 * version PR. Here the question is per package, and only changesets **this branch added**
 * count: a pending one from another card describes another change.
 *
 * Three ways a changed package counts as covered, and nothing else:
 * - a changeset added by the branch names it, or the branch added an empty one
 *   (`pnpm changeset add --empty`), which is the explicit "nothing here ships";
 * - its diff is its `package.json` alone and touches only `devDependencies` — a tool bump
 *   ships nothing. **Except** the entries in `SHIPPED_DEV_DEPENDENCIES`: `electron` is a
 *   devDependency of the desktop app and is the runtime the installer carries;
 * - the pull request is Dependabot's and the package's diff is its `package.json` alone,
 *   touching only dependency fields. Dependabot cannot write a changeset; `release.yml`
 *   writes it at release time instead (`dependabot-changesets.mjs`).
 *
 * When `.changeset/` holds any changeset it then runs `changeset status` as well, because
 * that is still the one place the tool itself validates the files `release.yml` will
 * version (the mixed-file refusal of TYTO-109 is that class). With the folder empty it has
 * nothing to validate, and running it there is exactly the red this card removes.
 *
 * Plain JavaScript and git alone, like `ci-scope.mjs`: nothing to build, and every input is
 * read at a revision, so the same run can be pointed at any two refs from a laptop.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Where versioned packages live; `tools/*` carry no `version` field (TYTO-94). */
const WORKSPACE_ROOTS = ['packages', 'apps'];

/**
 * devDependencies that end up inside what a person installs, by package name. `electron`
 * is declared as a devDependency because electron-builder requires it to be, and it is
 * still the Chromium and Node the packaged app runs on.
 */
export const SHIPPED_DEV_DEPENDENCIES = { '@tyto/desktop': ['electron'] };

/** Manifest fields a dependency bump may touch. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export const DEPENDABOT_LOGIN = 'dependabot[bot]';

/** @param {string[]} args */
const defaultGit = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * The packages a changeset file names, and whether it is the empty kind. The front matter
 * is the YAML-ish block Changesets writes: one `'name': bump` per line.
 *
 * @param {string} text
 * @returns {{ packages: string[], empty: boolean }}
 */
export function parseChangeset(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n?---/u.exec(text.trimStart());
  if (match === null) return { packages: [], empty: false };

  const packages = (match[1] ?? '')
    .split(/\r?\n/u)
    .map((line) => /^\s*['"]?([^'":\s]+)['"]?\s*:\s*(major|minor|patch|none)\s*$/u.exec(line))
    .filter((found) => found !== null)
    .map((found) => found[1]);

  return { packages, empty: packages.length === 0 };
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string[]} fields
 */
const without = (manifest, fields) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(manifest).filter(([key]) => !fields.includes(key))),
  );

/**
 * Every dependency whose range differs between two manifests, in the fields that ship:
 * everything but `devDependencies`, plus the shipped devDependencies named for this package.
 *
 * @param {Record<string, any>} before
 * @param {Record<string, any>} after
 * @param {string[]} shippedDev
 * @returns {{ name: string, from: string | undefined, to: string | undefined }[]}
 */
export function shippedDependencyChanges(before, after, shippedDev) {
  /** @param {Record<string, any>} manifest */
  const shipped = (manifest) => {
    /** @type {Record<string, string>} */
    const ranges = {};
    for (const field of DEPENDENCY_FIELDS) {
      if (field === 'devDependencies') continue;
      Object.assign(ranges, manifest[field] ?? {});
    }
    for (const name of shippedDev) {
      const range = manifest.devDependencies?.[name];
      if (range !== undefined) ranges[name] = range;
    }
    return ranges;
  };

  const from = shipped(before);
  const to = shipped(after);
  return [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .sort()
    .filter((name) => from[name] !== to[name])
    .map((name) => ({ name, from: from[name], to: to[name] }));
}

/**
 * What kind of change one manifest went through.
 *
 * @param {Record<string, any> | undefined} before
 * @param {Record<string, any> | undefined} after
 * @param {string[]} shippedDev
 * @returns {'dev-only' | 'dependencies' | 'other'}
 */
export function classifyManifestChange(before, after, shippedDev) {
  if (before === undefined || after === undefined) return 'other';
  if (without(before, DEPENDENCY_FIELDS) !== without(after, DEPENDENCY_FIELDS)) return 'other';
  return shippedDependencyChanges(before, after, shippedDev).length === 0
    ? 'dev-only'
    : 'dependencies';
}

/**
 * The verdict for every versioned package the branch changed.
 *
 * @param {{
 *   changed: { name: string, kind: 'dev-only' | 'dependencies' | 'other' }[],
 *   addedChangesets: { packages: string[], empty: boolean }[],
 *   dependabot: boolean,
 * }} input
 * @returns {{ name: string, covered: boolean, reason: string }[]}
 */
export function coverage({ changed, addedChangesets, dependabot }) {
  const named = new Set(addedChangesets.flatMap((changeset) => changeset.packages));
  const optedOut = addedChangesets.some((changeset) => changeset.empty);

  return changed.map(({ name, kind }) => {
    if (named.has(name))
      return { name, covered: true, reason: 'named in a changeset this branch added' };
    if (optedOut) return { name, covered: true, reason: 'this branch added an empty changeset' };
    if (kind === 'dev-only') return { name, covered: true, reason: 'only devDependencies changed' };
    if (dependabot && kind === 'dependencies') {
      return { name, covered: true, reason: 'Dependabot bump; release.yml writes its changeset' };
    }
    return { name, covered: false, reason: 'changed, and no changeset this branch added names it' };
  });
}

/**
 * Reads what the check needs from git, at two revisions, without touching the working tree.
 *
 * @param {{ base: string, head: string, git?: (args: string[]) => string }} options
 */
export function readBranch({ base, head, git = defaultGit }) {
  const mergeBase = git(['merge-base', base, head]).trim();
  const lines = (/** @type {string} */ output) =>
    output.split('\n').filter((line) => line.length > 0);
  /** @param {string} rev @param {string} path */
  const readAt = (rev, path) => {
    try {
      return git(['show', `${rev}:${path}`]);
    } catch {
      return undefined;
    }
  };
  /** @param {string} rev @param {string} path */
  const manifestAt = (rev, path) => {
    const text = readAt(rev, path);
    return text === undefined ? undefined : JSON.parse(text);
  };

  const changedFiles = lines(git(['diff', '--name-only', mergeBase, head]));
  const directories = lines(
    git(['ls-tree', '-d', '--name-only', head, ...WORKSPACE_ROOTS.map((root) => `${root}/`)]),
  );

  const changed = directories.flatMap((directory) => {
    const files = changedFiles.filter((file) => file.startsWith(`${directory}/`));
    if (files.length === 0) return [];
    const after = manifestAt(head, `${directory}/package.json`);
    if (after?.version === undefined) return [];

    const name = after.name ?? directory;
    const manifestOnly = files.every((file) => file === `${directory}/package.json`);
    const kind = manifestOnly
      ? classifyManifestChange(
          manifestAt(mergeBase, `${directory}/package.json`),
          after,
          SHIPPED_DEV_DEPENDENCIES[name] ?? [],
        )
      : 'other';
    return [{ name, kind }];
  });

  const addedChangesets = lines(
    git(['diff', '--name-only', '--diff-filter=A', mergeBase, head, '--', '.changeset/']),
  )
    .filter((file) => file.endsWith('.md') && !file.toLowerCase().endsWith('/readme.md'))
    .map((file) => ({ file, ...parseChangeset(readAt(head, file) ?? '') }));

  const pendingChangesets = lines(git(['ls-tree', '--name-only', head, '.changeset/'])).filter(
    (file) => file.endsWith('.md') && !file.toLowerCase().endsWith('/readme.md'),
  );

  return { mergeBase, changed, addedChangesets, pendingChangesets };
}

/** @param {string[]} argv */
function parseArguments(argv) {
  /** @type {Record<string, string>} */
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? '';
    if (flag === '--skip-status') options.skipStatus = 'true';
    else if (flag.startsWith('--')) options[flag.slice(2)] = argv[(index += 1)] ?? '';
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const base = options.base ?? 'main';
  const head = options.head ?? 'HEAD';
  const author = options.author ?? process.env.PR_AUTHOR ?? '';
  const dependabot = author === DEPENDABOT_LOGIN;

  const branch = readBranch({ base, head });
  const verdicts = coverage({
    changed: branch.changed,
    addedChangesets: branch.addedChangesets,
    dependabot,
  });

  console.log(`changeset coverage: ${base}...${head} (merge base ${branch.mergeBase.slice(0, 7)})`);
  console.log(
    `author: ${author || '(not a pull request)'}${dependabot ? ' — Dependabot rules apply' : ''}`,
  );
  console.log(
    `changesets this branch added: ${branch.addedChangesets.map(({ file }) => file).join(', ') || 'none'}`,
  );
  for (const { name, covered, reason } of verdicts) {
    console.log(`  ${covered ? 'ok     ' : 'MISSING'} ${name} — ${reason}`);
  }
  if (verdicts.length === 0) console.log('  no versioned package changed');

  const missing = verdicts.filter(({ covered }) => !covered);
  if (missing.length > 0) {
    console.error(
      [
        '',
        `${missing.length} of ${verdicts.length} changed versioned packages have no changeset of this branch's own.`,
        'A changeset another card left pending describes that card, not this one. Add one:',
        '  pnpm changeset            # names the packages and the bump',
        '  pnpm changeset add --empty  # when nothing here ships (a test, a comment)',
        'docs/git-workflow.md has the rule; ADR 0070 has why.',
      ].join('\n'),
    );
    process.exit(1);
  }

  if (options.skipStatus === 'true') return;
  if (branch.pendingChangesets.length === 0) {
    console.log(
      '`.changeset/` is empty at the head: `changeset status` has nothing to validate, skipped.',
    );
    return;
  }
  console.log(
    `\nValidating the ${branch.pendingChangesets.length} pending changesets with \`changeset status\`:`,
  );
  execFileSync('pnpm', ['exec', 'changeset', 'status'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
