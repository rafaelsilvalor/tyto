#!/usr/bin/env node
/**
 * Writes, at release time, the changesets Dependabot's merged bumps could not carry
 * (ADR 0070, TYTO-155).
 *
 * `changeset-coverage.mjs` lets a Dependabot pull request through without a changeset when
 * its diff is dependency ranges alone. The bump still ships — `zod` and the CodeMirror
 * packages are inside the installed app — so the release has to say so, and this is where
 * it does: `release.yml` runs this before `changesets/action`, which then versions these
 * files like any other. They are **never committed**; the version PR consumes them, and the
 * next run of `release.yml` regenerates them from history until it does.
 *
 * Why not commit them onto the Dependabot branch instead: a push made with `GITHUB_TOKEN`
 * starts no workflow run, so the PR's required checks would never report; no PAT or App
 * secret exists to push with; and Dependabot stops rebasing a branch somebody else pushed
 * to. The ADR has the measurements.
 *
 * The range is every Dependabot commit on the first-parent history since the last
 * version-packages commit — the commit the version PR squashes into, whose subject is
 * `VERSION_PACKAGES_TITLE` plus ` (#N)`. **When no such commit is found it fails**, rather
 * than reading all of history and re-announcing every bump ever released.
 * `github-config.test.ts` holds the title to `release.yml`'s, so renaming one without the
 * other fails before a merge.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEPENDABOT_LOGIN,
  SHIPPED_DEV_DEPENDENCIES,
  shippedDependencyChanges,
} from './changeset-coverage.mjs';

/** The version PR's title, and so the subject its squash merge lands under on `main`. */
export const VERSION_PACKAGES_TITLE = 'chore(release): TYTO-0 version packages';

/**
 * The title plus the pull request suffix squash merge appends: `(#9)`, or
 * `(owner/repo#234)` on the history carried over from the archive repository.
 *
 * @param {string} subject
 */
export function isVersionPackagesSubject(subject) {
  if (!subject.startsWith(`${VERSION_PACKAGES_TITLE} (`)) return false;
  return /^\((?:[\w.-]+\/[\w.-]+)?#\d+\)$/u.test(subject.slice(VERSION_PACKAGES_TITLE.length + 1));
}

/** @param {string[]} args */
const defaultGit = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * @param {{ head: string, since?: string, git?: (args: string[]) => string }} options
 * @returns {{ since: string, commits: { sha: string, subject: string }[] }}
 */
export function dependabotCommits({ head, since, git = defaultGit }) {
  const history = git(['log', '--first-parent', '--format=%H%x09%an%x09%s', head])
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = '', author = '', ...subject] = line.split('\t');
      return { sha, author, subject: subject.join('\t') };
    });

  let boundary = since === undefined ? undefined : git(['rev-parse', since]).trim();
  if (boundary === undefined) {
    boundary = history.find(({ subject }) => isVersionPackagesSubject(subject))?.sha;
    if (boundary === undefined) {
      throw new Error(
        `no commit on the first-parent history of ${head} has the subject "${VERSION_PACKAGES_TITLE} (#N)". ` +
          'Refusing to read all of history: every bump ever released would be announced again. ' +
          'If the version PR title changed, change VERSION_PACKAGES_TITLE with it.',
      );
    }
  }

  const index = history.findIndex(({ sha }) => sha === boundary);
  if (index === -1) throw new Error(`${boundary} is not on the first-parent history of ${head}`);
  const commits = history
    .slice(0, index)
    .filter(({ author }) => author === DEPENDABOT_LOGIN)
    .map(({ sha, subject }) => ({ sha, subject }))
    .reverse();
  return { since: boundary, commits };
}

/**
 * The changesets one Dependabot commit calls for: one file per versioned package whose
 * shipped dependencies moved, so each changelog lists only its own lines. A commit that
 * already adds a changeset gets none — somebody wrote it by hand (#198 had one), and a
 * second would print the bump twice.
 *
 * `ignoreHandWritten` exists for the dry run alone: it shows what would have been written
 * for a commit that did carry one.
 *
 * @param {{ sha: string, subject: string }} commit
 * @param {{ git?: (args: string[]) => string, ignoreHandWritten?: boolean }} [options]
 * @returns {{ file: string, text: string }[]}
 */
export function changesetsFor(commit, { git = defaultGit, ignoreHandWritten = false } = {}) {
  const files = git([
    'diff-tree',
    '--no-commit-id',
    '-r',
    '--name-status',
    `${commit.sha}^`,
    commit.sha,
  ])
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [status = '', path = ''] = line.split('\t');
      return { status, path };
    });

  const handWritten = files.some(
    ({ status, path }) => status === 'A' && /^\.changeset\/.+\.md$/u.test(path),
  );
  if (handWritten && !ignoreHandWritten) return [];

  /** @param {string} rev @param {string} path */
  const manifestAt = (rev, path) => {
    try {
      return JSON.parse(git(['show', `${rev}:${path}`]));
    } catch {
      return undefined;
    }
  };

  return files
    .filter(({ path }) => /^(?:packages|apps)\/[^/]+\/package\.json$/u.test(path))
    .flatMap(({ path }) => {
      const before = manifestAt(`${commit.sha}^`, path);
      const after = manifestAt(commit.sha, path);
      if (before === undefined || after?.version === undefined) return [];

      const changes = shippedDependencyChanges(
        before,
        after,
        SHIPPED_DEV_DEPENDENCIES[after.name] ?? [],
      );
      if (changes.length === 0) return [];

      const short = commit.sha.slice(0, 7);
      const directory = path.split('/')[1];
      const lines = changes.map(
        ({ name, from, to }) => `- \`${name}\` ${from ?? '(added)'} → ${to ?? '(removed)'}`,
      );
      const text = [
        '---',
        `'${after.name}': patch`,
        '---',
        '',
        `Dependencies updated by Dependabot (${short}, ${commit.subject}):`,
        '',
        ...lines,
        '',
      ].join('\n');
      return [{ file: `.changeset/dependabot-${short}-${directory}.md`, text }];
    });
}

/** @param {string[]} argv */
function parseArguments(argv) {
  /** @type {Record<string, string>} */
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? '';
    if (flag === '--dry-run') options.dryRun = 'true';
    else if (flag === '--ignore-hand-written') options.ignoreHandWritten = 'true';
    else if (flag.startsWith('--')) options[flag.slice(2)] = argv[(index += 1)] ?? '';
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const head = options.head ?? 'HEAD';
  const { since, commits } = dependabotCommits({ head, since: options.since });

  console.log(`Dependabot commits on ${head} since ${since.slice(0, 7)}: ${commits.length}`);
  for (const commit of commits) {
    const changesets = changesetsFor(commit, {
      ignoreHandWritten: options.dryRun === 'true' && options.ignoreHandWritten === 'true',
    });
    console.log(
      `  ${commit.sha.slice(0, 7)} ${commit.subject} — ${changesets.length} changeset(s)` +
        (changesets.length === 0
          ? ' (it adds its own changeset, or moves no shipped dependency)'
          : ''),
    );
    for (const { file, text } of changesets) {
      if (options.dryRun === 'true') {
        console.log(`\n# ${file} (dry run, not written)\n${text}`);
      } else {
        writeFileSync(join(process.cwd(), file), text);
        console.log(`    wrote ${file}`);
      }
    }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
