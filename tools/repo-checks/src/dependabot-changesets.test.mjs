import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  VERSION_PACKAGES_TITLE,
  changesetsFor,
  dependabotCommits,
  isVersionPackagesSubject,
} from './dependabot-changesets.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Where the generator stops is the part that fails silently if it drifts: a version PR
 * renamed in `release.yml` and not here would make the generator read past every release
 * and announce old bumps again. So the title is pinned to the workflow, and the matcher to
 * the subjects that are really on `main`.
 */
describe('the last version-packages commit', () => {
  it('is found by the title release.yml gives the version PR', () => {
    const release = parse(readFileSync(`${repoRoot}.github/workflows/release.yml`, 'utf8'));
    const step = Object.values(release.jobs)
      .flatMap((job) => job.steps ?? [])
      .find((candidate) => candidate.uses?.startsWith('changesets/action@'));

    expect(step?.with?.['pr-title']).toBe(VERSION_PACKAGES_TITLE);
    expect(step?.with?.['commit-message']).toBe(VERSION_PACKAGES_TITLE);
  });

  it('matches the squash subjects on main, and nothing that merely mentions them', () => {
    expect(isVersionPackagesSubject(`${VERSION_PACKAGES_TITLE} (#9)`)).toBe(true);
    expect(
      isVersionPackagesSubject(`${VERSION_PACKAGES_TITLE} (rafaelsilvalor/tyto-archive#234)`),
    ).toBe(true);
    expect(isVersionPackagesSubject(VERSION_PACKAGES_TITLE)).toBe(false);
    expect(isVersionPackagesSubject(`revert: ${VERSION_PACKAGES_TITLE} (#9)`)).toBe(false);
    expect(isVersionPackagesSubject(`${VERSION_PACKAGES_TITLE} (#9) and more`)).toBe(false);
  });

  it('is on the history this repository actually has', () => {
    // CI checks out with `fetch-depth: 0`, so the real log is here to ask. A title that
    // matched nothing on `main` would make the release step fail on its next run.
    const subjects = execFileSync('git', ['log', '--first-parent', '--format=%s', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).split('\n');
    expect(subjects.some(isVersionPackagesSubject)).toBe(true);
  });
});

/** A first-parent log and two commits' worth of manifests, served the way git would. */
const LOG = [
  ['c4', 'dependabot[bot]', 'chore(deps): Bump zod (#12)'],
  ['c3', 'Rafael', 'feat(core): TYTO-1 something (#11)'],
  ['c2', 'github-actions[bot]', `${VERSION_PACKAGES_TITLE} (#10)`],
  ['c1', 'dependabot[bot]', 'chore(deps): Bump yaml (#8)'],
]
  .map((fields) => fields.join('\t'))
  .join('\n');

/** @param {Record<string, string>} files @param {string} [nameStatus] */
const fakeGit =
  (files, nameStatus = 'M\tpackages/core/package.json\nM\tpnpm-lock.yaml') =>
  (/** @type {string[]} */ args) => {
    if (args[0] === 'log') return LOG;
    if (args[0] === 'rev-parse') return `${args[1]}\n`;
    if (args[0] === 'diff-tree') return nameStatus;
    if (args[0] === 'show') {
      const text = files[args[1] ?? ''];
      if (text === undefined) throw new Error(`no ${args[1]}`);
      return text;
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

describe('dependabotCommits', () => {
  it('takes the Dependabot commits after the last version-packages commit, oldest first', () => {
    const { since, commits } = dependabotCommits({ head: 'HEAD', git: fakeGit({}) });
    expect(since).toBe('c2');
    expect(commits.map(({ sha }) => sha)).toEqual(['c4']);
  });

  it('refuses to run when no version-packages commit is on the history', () => {
    const git = (/** @type {string[]} */ args) =>
      args[0] === 'log' ? 'c1\tdependabot[bot]\tchore(deps): Bump yaml (#8)' : '';
    expect(() => dependabotCommits({ head: 'HEAD', git })).toThrow(
      /Refusing to read all of history/u,
    );
  });
});

describe('changesetsFor', () => {
  const core = (/** @type {Record<string, string>} */ dependencies, devDependencies = {}) =>
    JSON.stringify({ name: '@tyto/core', version: '1.0.0', dependencies, devDependencies });
  const commit = { sha: 'c4aaaaaaaa', subject: 'chore(deps): Bump zod (#12)' };

  it('writes a patch naming each shipped dependency, old and new', () => {
    const [changeset] = changesetsFor(commit, {
      git: fakeGit({
        'c4aaaaaaaa^:packages/core/package.json': core({ zod: '^4.6.1', yaml: '^2.9.0' }),
        'c4aaaaaaaa:packages/core/package.json': core({ zod: '^4.6.5', yaml: '^2.9.0' }),
      }),
    });
    expect(changeset?.file).toBe('.changeset/dependabot-c4aaaaa-core.md');
    expect(changeset?.text).toContain("'@tyto/core': patch");
    expect(changeset?.text).toContain('- `zod` ^4.6.1 → ^4.6.5');
    expect(changeset?.text).not.toContain('yaml');
  });

  it('writes nothing for a devDependencies-only bump', () => {
    const changesets = changesetsFor(commit, {
      git: fakeGit({
        'c4aaaaaaaa^:packages/core/package.json': core({}, { vitest: '^5.0.1' }),
        'c4aaaaaaaa:packages/core/package.json': core({}, { vitest: '^5.0.3' }),
      }),
    });
    expect(changesets).toEqual([]);
  });

  it('writes a desktop patch for an Electron bump, devDependency as it is', () => {
    const desktop = (/** @type {string} */ electron) =>
      JSON.stringify({ name: '@tyto/desktop', version: '0.7.0', devDependencies: { electron } });
    const [changeset] = changesetsFor(commit, {
      git: fakeGit(
        {
          'c4aaaaaaaa^:apps/desktop/package.json': desktop('^44.4.5'),
          'c4aaaaaaaa:apps/desktop/package.json': desktop('^44.5.1'),
        },
        'M\tapps/desktop/package.json',
      ),
    });
    expect(changeset?.text).toContain("'@tyto/desktop': patch");
    expect(changeset?.text).toContain('- `electron` ^44.4.5 → ^44.5.1');
  });

  it('writes nothing for a commit that already carries a hand-written changeset', () => {
    const files = {
      'c4aaaaaaaa^:packages/core/package.json': core({ zod: '^4.6.1' }),
      'c4aaaaaaaa:packages/core/package.json': core({ zod: '^4.6.5' }),
    };
    const nameStatus = 'A\t.changeset/zod.md\nM\tpackages/core/package.json';
    expect(changesetsFor(commit, { git: fakeGit(files, nameStatus) })).toEqual([]);
  });
});
