import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { changedFiles, decide, scopeOf, workspaceClosure } from './ci-scope.mjs';

/**
 * The script decides whether a required check measures anything on this pull request
 * (ADR 0064). Its two ways of being wrong are not symmetric: running when it could have
 * skipped costs runner minutes, skipping when it should have run lets a red merge through
 * green. So the table below leans on the second kind, and the failure path is held to
 * "run" rather than to any particular message.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('the desktop scope', () => {
  const scope = scopeOf(repoRoot, 'desktop');

  it.each([
    ['docs only', ['docs/git-workflow.md', 'README.md'], false],
    ['a package the app bundles, two hops away', ['packages/core/src/index.ts'], true],
    ['raster, which the e2e suites also import', ['packages/raster/src/index.ts'], true],
    ['the CLI the e2e suites compare against', ['apps/cli/src/main.ts'], true],
    ['the app itself', ['apps/desktop/src/main/index.ts'], true],
    ['a root tsconfig', ['tsconfig.base.json'], true],
    ['the lockfile', ['pnpm-lock.yaml'], true],
    ['the workflow', ['.github/workflows/desktop-e2e.yml'], true],
    ['the script itself', ['tools/repo-checks/src/ci-scope.mjs'], true],
    ['a tool the app does not use', ['tools/template-preview/src/server.ts'], false],
    ['the other workflow', ['.github/workflows/visual.yml'], false],
  ])('%s → run is %s', (_case, changed, run) => {
    expect(decide({ changed, scope }).run).toBe(run);
  });

  it('reaches every package the app depends on, through the graph rather than a list', () => {
    // `packages/core` is a dependency of a dependency: the blind spot the `paths:` filter
    // had, and the one entry a hand-written list was most likely to leave out.
    expect(workspaceClosure(repoRoot, '@tyto/desktop')).toEqual(
      expect.arrayContaining(['apps/desktop/', 'packages/core/', 'packages/template-kit/']),
    );
  });

  it('follows devDependencies too, which no package in this repository needs yet', () => {
    // Every dev dependency of `@tyto/desktop` today is also reached through a runtime one
    // (`@tyto/raster` through `@tyto/io`), so the real graph cannot tell whether this
    // branch works. A two-package workspace on disk can.
    const root = mkdtempSync(join(tmpdir(), 'ci-scope-'));
    const write = (directory, manifest) => {
      mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, directory, 'package.json'), JSON.stringify(manifest));
    };
    write('apps/app', { name: 'app', devDependencies: { tested: 'workspace:*' } });
    write('packages/tested', { name: 'tested' });
    write('packages/unrelated', { name: 'unrelated' });

    expect(workspaceClosure(root, 'app')).toEqual(['apps/app/', 'packages/tested/']);
  });

  it('matches a directory by its prefix and not by a name that starts the same way', () => {
    expect(decide({ changed: ['packages/core-extra/x.ts'], scope: ['packages/core/'] }).run).toBe(
      false,
    );
  });
});

describe('the visual scope', () => {
  const scope = scopeOf(repoRoot, 'visual');

  it.each([
    ['docs only', ['docs/architecture.md'], false],
    ['an exporter, found through the wildcard', ['packages/export-svg/src/index.ts'], true],
    ['packages/core', ['packages/core/src/index.ts'], true],
    ['the template preview', ['tools/template-preview/src/server.ts'], true],
    ['a root tsconfig', ['tsconfig.json'], true],
    ['the script itself', ['tools/repo-checks/src/ci-scope.mjs'], true],
    [
      'the desktop app, which this suite does not render',
      ['apps/desktop/src/main/index.ts'],
      false,
    ],
  ])('%s → run is %s', (_case, changed, run) => {
    expect(decide({ changed, scope }).run).toBe(run);
  });
});

describe('a skip', () => {
  it('names what it compared against, so the green says what it measured', () => {
    const { run, message } = decide({
      changed: ['docs/a.md'],
      scope: ['packages/core/', 'turbo.json'],
    });
    expect(run).toBe(false);
    expect(message).toBe(
      'skipped: no change under packages/core/, turbo.json (1 changed files, none in scope)',
    );
  });
});

describe('failing closed', () => {
  it('runs when the diff could not be read', () => {
    expect(decide({ changed: null, scope: [], failure: 'git failed' }).run).toBe(true);
  });

  it('does not read a diff off a commit that is not a merge commit', () => {
    // A `fetch-depth: 1` checkout, or a `pull_request` ref that is not the merge, gives a
    // HEAD with one parent; diffing it against `HEAD^1` would compare the wrong things.
    const git = (args) => (args[0] === 'rev-list' ? 'aaa bbb\n' : 'docs/a.md\n');
    expect(changedFiles('pull_request', git)).toEqual({
      changed: null,
      failure: 'HEAD has 1 parents, not the 2 of a merge commit',
    });
  });

  it('turns a git error into a failure rather than an empty diff', () => {
    // An empty diff would be read as "nothing in scope" and skip — exactly the wrong answer.
    const git = () => {
      throw new Error('fatal: bad revision HEAD^1');
    };
    expect(changedFiles('pull_request', git).changed).toBeNull();
  });

  it('runs everything on an event that is not a pull request', () => {
    expect(changedFiles('push').changed).toBeNull();
  });

  it('reads the files of a merge commit', () => {
    const git = (args) =>
      args[0] === 'rev-list' ? 'merge base head\n' : 'docs/a.md\npackages/core/x.ts\n';
    expect(changedFiles('pull_request', git)).toEqual({
      changed: ['docs/a.md', 'packages/core/x.ts'],
    });
  });
});
