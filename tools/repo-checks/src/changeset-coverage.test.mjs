import { describe, expect, it } from 'vitest';

import {
  classifyManifestChange,
  coverage,
  parseChangeset,
  readBranch,
} from './changeset-coverage.mjs';

/**
 * One case per rule the check applies, and the two cases the old `changeset status` got
 * wrong (TYTO-155): a human change passing because somebody else's changeset was pending,
 * and a Dependabot bump failing because nobody's was.
 */
const manifest = (overrides = {}) => ({
  name: '@tyto/editor',
  version: '0.9.0',
  dependencies: { '@codemirror/view': '^6.43.12' },
  devDependencies: { vite: '^8.3.0' },
  ...overrides,
});

describe('parseChangeset', () => {
  it('reads every package the front matter names, quoted either way', () => {
    const parsed = parseChangeset(
      '---\n\'@tyto/core\': patch\n"@tyto/editor": minor\n---\n\nText.\n',
    );
    expect(parsed).toEqual({ packages: ['@tyto/core', '@tyto/editor'], empty: false });
  });

  it('reads `changeset add --empty` as the explicit opt-out', () => {
    expect(parseChangeset('---\n---\n\nTest-only.\n')).toEqual({ packages: [], empty: true });
  });

  it('reads CRLF front matter, which a Windows checkout can produce', () => {
    expect(parseChangeset("---\r\n'@tyto/core': patch\r\n---\r\n").packages).toEqual([
      '@tyto/core',
    ]);
  });
});

describe('classifyManifestChange', () => {
  it('calls a devDependencies-only edit dev-only', () => {
    const after = manifest({ devDependencies: { vite: '^8.3.3' } });
    expect(classifyManifestChange(manifest(), after, [])).toBe('dev-only');
  });

  it('calls a dependencies edit a shipped change', () => {
    const after = manifest({ dependencies: { '@codemirror/view': '^6.43.13' } });
    expect(classifyManifestChange(manifest(), after, [])).toBe('dependencies');
  });

  it('calls electron a shipped change in the package that names it, devDependency or not', () => {
    const before = manifest({ name: '@tyto/desktop', devDependencies: { electron: '^44.4.5' } });
    const after = manifest({ name: '@tyto/desktop', devDependencies: { electron: '^44.5.1' } });
    expect(classifyManifestChange(before, after, ['electron'])).toBe('dependencies');
    expect(classifyManifestChange(before, after, [])).toBe('dev-only');
  });

  it('calls anything outside the dependency fields other', () => {
    const after = manifest({ devDependencies: { vite: '^8.3.3' }, main: 'dist/index.js' });
    expect(classifyManifestChange(manifest(), after, [])).toBe('other');
  });

  it('calls a manifest that did not exist at the base other', () => {
    expect(classifyManifestChange(undefined, manifest(), [])).toBe('other');
  });
});

describe('coverage', () => {
  const core = { name: '@tyto/core', kind: /** @type {const} */ ('other') };

  it('fails a changed package no changeset of the branch names, whatever else is pending', () => {
    // The case `changeset status` passed: the pending changesets of other cards are not
    // an input here at all, only the ones this branch added.
    const [verdict] = coverage({ changed: [core], addedChangesets: [], dependabot: false });
    expect(verdict?.covered).toBe(false);
  });

  it('passes a package a changeset of the branch names', () => {
    const [verdict] = coverage({
      changed: [core],
      addedChangesets: [{ packages: ['@tyto/core'], empty: false }],
      dependabot: false,
    });
    expect(verdict?.covered).toBe(true);
  });

  it('does not let a changeset naming another package cover this one', () => {
    const [verdict] = coverage({
      changed: [core],
      addedChangesets: [{ packages: ['@tyto/editor'], empty: false }],
      dependabot: false,
    });
    expect(verdict?.covered).toBe(false);
  });

  it('passes everything when the branch added an empty changeset', () => {
    const [verdict] = coverage({
      changed: [core],
      addedChangesets: [{ packages: [], empty: true }],
      dependabot: false,
    });
    expect(verdict?.covered).toBe(true);
  });

  it('passes a devDependencies-only change with no changeset', () => {
    const [verdict] = coverage({
      changed: [{ name: '@tyto/editor', kind: 'dev-only' }],
      addedChangesets: [],
      dependabot: false,
    });
    expect(verdict?.covered).toBe(true);
  });

  it('fails a human bump of a shipped dependency with no changeset', () => {
    const [verdict] = coverage({
      changed: [{ name: '@tyto/editor', kind: 'dependencies' }],
      addedChangesets: [],
      dependabot: false,
    });
    expect(verdict?.covered).toBe(false);
  });

  it('passes the same bump when Dependabot opened the pull request', () => {
    const [verdict] = coverage({
      changed: [{ name: '@tyto/editor', kind: 'dependencies' }],
      addedChangesets: [],
      dependabot: true,
    });
    expect(verdict?.covered).toBe(true);
  });

  it('does not pass a Dependabot pull request that changes more than dependencies', () => {
    const [verdict] = coverage({ changed: [core], addedChangesets: [], dependabot: true });
    expect(verdict?.covered).toBe(false);
  });
});

describe('readBranch', () => {
  /**
   * A fake git answering the handful of commands the check sends. Each fixture is a branch
   * off `base` in one of the shapes the rules distinguish.
   *
   * `pending` is what `.changeset/` holds at the head beyond what the branch added — the
   * other cards' files, which must not count.
   *
   * @param {{ changed: string[], added?: string[], pending?: string[], files: Record<string, string> }} fixture
   */
  const fakeGit =
    ({ changed, added = [], pending = [], files }) =>
    (/** @type {string[]} */ args) => {
      const [command] = args;
      if (command === 'merge-base') return 'base\n';
      if (command === 'diff' && args.includes('--diff-filter=A')) return added.join('\n');
      if (command === 'diff') return changed.join('\n');
      if (command === 'ls-tree' && args.includes('-d'))
        return 'apps/desktop\npackages/core\npackages/editor\n';
      if (command === 'ls-tree') return [...pending, ...added].join('\n');
      if (command === 'show') {
        const text = files[args[1] ?? ''];
        if (text === undefined) throw new Error(`no ${args[1]}`);
        return text;
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    };

  const json = (/** @type {object} */ value) => JSON.stringify(value, null, 2);
  const desktop = (/** @type {string} */ electron) =>
    json({
      name: '@tyto/desktop',
      version: '0.7.0',
      devDependencies: { electron, vite: '^8.3.0' },
    });

  it('reads a package that changed outside its manifest as other', () => {
    const branch = readBranch({
      base: 'main',
      head: 'HEAD',
      git: fakeGit({
        changed: ['packages/core/src/index.ts', 'docs/x.md'],
        files: {
          'HEAD:packages/core/package.json': json({ name: '@tyto/core', version: '1.0.0' }),
        },
      }),
    });
    expect(branch.changed).toEqual([{ name: '@tyto/core', kind: 'other' }]);
  });

  it('reads an electron bump in the desktop manifest as a shipped one', () => {
    const branch = readBranch({
      base: 'main',
      head: 'HEAD',
      git: fakeGit({
        changed: ['apps/desktop/package.json', 'pnpm-lock.yaml'],
        files: {
          'HEAD:apps/desktop/package.json': desktop('^44.5.1'),
          'base:apps/desktop/package.json': desktop('^44.4.5'),
        },
      }),
    });
    expect(branch.changed).toEqual([{ name: '@tyto/desktop', kind: 'dependencies' }]);
  });

  it('reads only the changesets the branch added, and what they name', () => {
    const branch = readBranch({
      base: 'main',
      head: 'HEAD',
      git: fakeGit({
        changed: ['.changeset/mine.md'],
        added: ['.changeset/mine.md', '.changeset/README.md'],
        files: { 'HEAD:.changeset/mine.md': "---\n'@tyto/core': patch\n---\n" },
      }),
    });
    expect(branch.addedChangesets).toEqual([
      { file: '.changeset/mine.md', packages: ['@tyto/core'], empty: false },
    ]);
  });

  it('does not count a pending changeset another card left in the folder', () => {
    // The exact shape `changeset status` passed: `packages/core` edited, nothing added, and
    // another card's file naming `@tyto/core` sitting in `.changeset/`.
    const branch = readBranch({
      base: 'main',
      head: 'HEAD',
      git: fakeGit({
        changed: ['packages/core/src/index.ts'],
        pending: ['.changeset/other-card.md'],
        files: {
          'HEAD:packages/core/package.json': json({ name: '@tyto/core', version: '1.0.0' }),
          'HEAD:.changeset/other-card.md': "---\n'@tyto/core': patch\n---\n",
        },
      }),
    });
    expect(branch.addedChangesets).toEqual([]);
    expect(branch.pendingChangesets).toEqual(['.changeset/other-card.md']);
    const verdicts = coverage({
      changed: branch.changed,
      addedChangesets: branch.addedChangesets,
      dependabot: false,
    });
    expect(verdicts).toEqual([expect.objectContaining({ name: '@tyto/core', covered: false })]);
  });
});
