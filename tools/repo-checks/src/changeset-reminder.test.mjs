import { describe, expect, it } from 'vitest';

import { missingChangesetWarning, versionedPackages } from './changeset-reminder.mjs';

/**
 * The three cases the hook has to get right are about when it stays quiet. A reminder that
 * fires on every commit is noise, and noise is what teaches people to reach for
 * `--no-verify` — which would also switch off commitlint and lint-staged.
 */
const CORE = { directory: 'packages/core', name: '@tyto/core' };
const EXPORT_SVG = { directory: 'packages/export-svg', name: '@tyto/export-svg' };
const versioned = [CORE, EXPORT_SVG];

describe('missingChangesetWarning', () => {
  it('warns when a versioned package changes with no changeset on the branch', () => {
    const warning = missingChangesetWarning({
      staged: ['packages/core/src/result/index.ts'],
      changesets: [],
      versioned,
    });

    expect(warning).toContain('@tyto/core');
    expect(warning).toContain('pnpm changeset');
  });

  it('says nothing when the branch already carries a changeset', () => {
    // The changeset does not have to be in this commit: one added earlier on the branch
    // still describes the release, and re-asking for it would be wrong.
    const warning = missingChangesetWarning({
      staged: ['packages/core/src/result/index.ts'],
      changesets: ['warm-poems-shout.md'],
      versioned,
    });

    expect(warning).toBeNull();
  });

  it('says nothing when only unversioned packages and docs change', () => {
    // `tools/*` carry no `version` field, which is the same clause Changesets skips them
    // with. Private is no longer the line: both apps are private and both are versioned.
    const warning = missingChangesetWarning({
      staged: ['tools/repo-checks/src/github-config.test.ts', 'docs/git-workflow.md'],
      changesets: [],
      versioned,
    });

    expect(warning).toBeNull();
  });

  it('names every versioned package the commit touched', () => {
    const warning = missingChangesetWarning({
      staged: ['packages/core/src/index.ts', 'packages/export-svg/src/index.ts'],
      changesets: [],
      versioned,
    });

    expect(warning).toContain('@tyto/core');
    expect(warning).toContain('@tyto/export-svg');
  });

  it('does not mistake a prefix for a directory', () => {
    // `packages/core-utils/...` starts with `packages/core` as a string but is another
    // package, so the comparison has to include the separator.
    const warning = missingChangesetWarning({
      staged: ['packages/core-utils/src/index.ts'],
      changesets: [],
      versioned,
    });

    expect(warning).toBeNull();
  });
});

describe('versionedPackages', () => {
  const repoRoot = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

  it('reads the version field rather than the private flag or the directory name', () => {
    const found = versionedPackages(repoRoot);
    const names = found.map(({ name }) => name);

    expect(names).toContain('@tyto/core');
    // Private and versioned are two different questions since TYTO-94: `@tyto/cli` is
    // private and is versioned, so a branch that only touches it wants the reminder.
    expect(names).toContain('@tyto/cli');
    // `tools/*` carry no `version` at all, which is what keeps them out — not the path.
    expect(names).not.toContain('@tyto/repo-checks');
  });
});
