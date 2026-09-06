import { describe, expect, it } from 'vitest';

import { missingChangesetWarning, publishablePackages } from './changeset-reminder.mjs';

/**
 * The three cases the hook has to get right are about when it stays quiet. A reminder that
 * fires on every commit is noise, and noise is what teaches people to reach for
 * `--no-verify` — which would also switch off commitlint and lint-staged.
 */
const CORE = { directory: 'packages/core', name: '@tyto/core' };
const EXPORT_SVG = { directory: 'packages/export-svg', name: '@tyto/export-svg' };
const publishable = [CORE, EXPORT_SVG];

describe('missingChangesetWarning', () => {
  it('warns when a publishable package changes with no changeset on the branch', () => {
    const warning = missingChangesetWarning({
      staged: ['packages/core/src/result/index.ts'],
      changesets: [],
      publishable,
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
      publishable,
    });

    expect(warning).toBeNull();
  });

  it('says nothing when only private packages and docs change', () => {
    const warning = missingChangesetWarning({
      staged: ['tools/repo-checks/src/github-config.test.ts', 'docs/git-workflow.md'],
      changesets: [],
      publishable,
    });

    expect(warning).toBeNull();
  });

  it('names every publishable package the commit touched', () => {
    const warning = missingChangesetWarning({
      staged: ['packages/core/src/index.ts', 'packages/export-svg/src/index.ts'],
      changesets: [],
      publishable,
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
      publishable,
    });

    expect(warning).toBeNull();
  });
});

describe('publishablePackages', () => {
  const repoRoot = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

  it('reads the private flag rather than trusting the directory name', () => {
    const found = publishablePackages(repoRoot);
    const names = found.map(({ name }) => name);

    expect(names).toContain('@tyto/core');
    // apps/* and tools/* are private today; the flag is what decides, not the path.
    expect(names).not.toContain('@tyto/cli');
    expect(names).not.toContain('@tyto/repo-checks');
  });
});
