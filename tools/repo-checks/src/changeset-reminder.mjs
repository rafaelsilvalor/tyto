#!/usr/bin/env node
/**
 * Reminds, and never blocks, when a commit touches a publishable package while the branch
 * carries no changeset (docs/git-workflow.md).
 *
 * Warning instead of failing is the point, not a compromise. A changeset is usually
 * written after the code it describes, in a later commit on the same branch, so a check
 * that refused the commit would be wrong most of the times it fired — and the way around
 * it, `--no-verify`, also switches off commitlint and lint-staged. A reminder that costs
 * nothing to ignore keeps the two hooks that do have to hold.
 *
 * Plain JavaScript rather than TypeScript, because a git hook has to run with no build
 * step and this package has none.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

/** Where workspace packages live. `tools/*` is deliberately absent: those are never published. */
const WORKSPACE_ROOTS = ['packages', 'apps'];

/**
 * Publishable means "not marked private", the same thing Changesets means by it. Reading
 * the flag rather than hardcoding a list of directories is what keeps this correct the day
 * a publishable package appears outside `packages/`.
 *
 * @param {string} repoRoot
 * @returns {{ directory: string, name: string }[]}
 */
export function publishablePackages(repoRoot) {
  return WORKSPACE_ROOTS.flatMap((root) => {
    const rootPath = `${repoRoot}/${root}`;
    if (!existsSync(rootPath)) return [];

    return readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const directory = `${root}/${entry.name}`;
        const manifestPath = `${repoRoot}/${directory}/package.json`;
        if (!existsSync(manifestPath)) return [];

        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.private === true) return [];
        return [{ directory, name: manifest.name ?? directory }];
      });
  });
}

/**
 * Git always reports paths with forward slashes, on Windows too, so the prefixes this is
 * compared against are built with `/` rather than `path.join`.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function stagedFiles(repoRoot) {
  const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return output.split('\n').filter((line) => line.length > 0);
}

/**
 * Changesets that the release has not consumed yet, wherever on the branch they were added
 * — a changeset committed yesterday still counts today.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function pendingChangesets(repoRoot) {
  const directory = `${repoRoot}/.changeset`;
  if (!existsSync(directory)) return [];

  return readdirSync(directory).filter(
    (file) => file.endsWith('.md') && file.toLowerCase() !== 'readme.md',
  );
}

/**
 * @param {{ staged: string[], changesets: string[], publishable: { directory: string, name: string }[] }} input
 * @returns {string | null} the warning, or null when there is nothing to say
 */
export function missingChangesetWarning({ staged, changesets, publishable }) {
  if (changesets.length > 0) return null;

  const touched = publishable
    .filter(({ directory }) => staged.some((file) => file.startsWith(`${directory}/`)))
    .map(({ name }) => name);

  if (touched.length === 0) return null;

  return [
    `This commit touches ${touched.join(', ')} and the branch has no changeset.`,
    'A PR touching a publishable package needs one (docs/git-workflow.md):',
    '  pnpm changeset',
    'Reminder only — the commit went through.',
  ].join('\n');
}

function main() {
  try {
    const repoRoot = process.cwd();
    const warning = missingChangesetWarning({
      staged: stagedFiles(repoRoot),
      changesets: pendingChangesets(repoRoot),
      publishable: publishablePackages(repoRoot),
    });
    if (warning) console.warn(`\n${warning}\n`);
  } catch (error) {
    // A reminder must never be the reason a commit fails, so even a broken reminder is
    // reported and then forgiven.
    console.warn(`changeset reminder skipped: ${error instanceof Error ? error.message : error}`);
  }
}

if (process.argv[1]?.endsWith('changeset-reminder.mjs')) main();
