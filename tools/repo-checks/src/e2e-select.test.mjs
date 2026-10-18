import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scopeOf } from './ci-scope.mjs';
import {
  commandsFor,
  e2eFilesOnDisk,
  globToRegExp,
  readMap,
  select,
  summarize,
  threeDotDiff,
} from './e2e-select.mjs';

/**
 * The local e2e selector (TYTO-309). CI runs the whole suite on every push, so the selector
 * may leave the shared wiring to it; what it may not do is drop a file a narrow change reaches.
 * So the cases here are the ways it must fall back to the full suite, the paths it leaves to
 * CI, and the selections in between.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const real = {
  scope: scopeOf(repoRoot, 'desktop'),
  map: readMap(repoRoot),
  onDisk: e2eFilesOnDisk(repoRoot),
};
const choose = (changed) => select({ ...real, changed });

describe('falling back to the full suite', () => {
  it.each([
    ['the preload', 'apps/desktop/src/preload/bridge.ts'],
    ['the build config', 'apps/desktop/electron.vite.config.ts'],
    ['the desktop package', 'apps/desktop/package.json'],
    ['a packaging script', 'apps/desktop/scripts/fetch-node.ts'],
    ['the desktop e2e vitest config', 'apps/desktop/vitest.desktop.config.ts'],
    ['the e2e close helper', 'apps/desktop/e2e/close-app.ts'],
    ['an e2e helper', 'apps/desktop/e2e/first-window.ts'],
    ['an e2e fixture', 'apps/desktop/e2e/__fixtures__/offscreen.scene.json'],
    ['the lockfile', 'pnpm-lock.yaml'],
    ['a root tsconfig', 'tsconfig.base.json'],
    ['the map', 'tools/repo-checks/src/desktop-e2e-map.json'],
    ['the selector', 'tools/repo-checks/src/e2e-select.mjs'],
    ['ci-scope', 'tools/repo-checks/src/ci-scope.mjs'],
    ['the workflow', '.github/workflows/desktop-e2e.yml'],
    ['a new source file no entry covers', 'apps/desktop/src/renderer/brand-new.ts'],
  ])('%s', (_case, path) => {
    const selection = choose(['docs/architecture.md', path]);
    expect(selection.mode).toBe('full');
    expect(selection.count).toBe(selection.total);
    expect(selection.packageSuite).toBe(true);
  });

  it('when the diff cannot be read', () => {
    expect(select({ ...real, changed: null, failure: 'shallow' }).mode).toBe('full');
  });

  it('when one path of many is on the run-everything list, whatever the others select', () => {
    const selection = choose([
      'apps/desktop/src/renderer/tab-drag.ts',
      'apps/desktop/src/preload/index.ts',
    ]);
    expect(selection.mode).toBe('full');
  });
});

describe('reaching nothing locally, since CI runs everything on every push', () => {
  it.each([
    ['an IPC contract', 'apps/desktop/shared/ipc.ts'],
    ['the command list', 'apps/desktop/shared/commands.ts'],
    ['the settings contract', 'apps/desktop/shared/settings.ts'],
    ['a translation', 'apps/desktop/shared/i18n/en.ts'],
    ['the main entry', 'apps/desktop/src/main/index.ts'],
    ['the main IPC handlers', 'apps/desktop/src/main/ipc.ts'],
    ['the window', 'apps/desktop/src/main/window.ts'],
    ['the renderer entry', 'apps/desktop/src/renderer/main.ts'],
    ['the renderer shell', 'apps/desktop/src/renderer/shell.ts'],
    ['the shell sheet', 'apps/desktop/src/renderer/shell.css'],
    ['the tokens sheet', 'apps/desktop/src/renderer/tokens.css'],
    ['the renderer page', 'apps/desktop/src/renderer/index.html'],
    ['packages/core, mapped to all', 'packages/core/src/index.ts'],
    ['the CLI, mapped to all', 'apps/cli/src/main.ts'],
    ['a document module, mapped to all', 'apps/desktop/src/main/documents.ts'],
  ])('%s', (_case, path) => {
    expect(choose([path])).toMatchObject({
      mode: 'selected',
      files: [],
      count: 0,
      packageSuite: false,
      ignored: [path],
    });
  });

  it('adds nothing to what the other paths select', () => {
    const selection = choose([
      'apps/desktop/shared/i18n/en.ts',
      'apps/desktop/src/renderer/tab-drag.ts',
      'apps/desktop/src/main/session.ts',
    ]);
    expect(selection).toMatchObject({
      mode: 'selected',
      files: ['e2e/tab-drag.desktop.test.ts'],
      ignored: ['apps/desktop/shared/i18n/en.ts', 'apps/desktop/src/main/session.ts'],
    });
  });

  it('names the ignored paths on one line of the summary', () => {
    const lines = summarize(
      choose(['apps/desktop/shared/i18n/en.ts', 'apps/desktop/shared/commands.ts']),
    ).split('\n');
    expect(lines).toContain(
      'ignored locally, CI runs everything: apps/desktop/shared/i18n/en.ts, apps/desktop/shared/commands.ts',
    );
    expect(lines.at(-1)).toBe('nothing to run');
  });

  it('prints no ignored line when nothing was ignored', () => {
    expect(summarize(choose(['apps/desktop/src/renderer/tab-drag.ts']))).not.toContain(
      'ignored locally',
    );
  });

  it('still names them when something else runs everything', () => {
    expect(choose(['apps/desktop/shared/ipc.ts', 'pnpm-lock.yaml'])).toMatchObject({
      mode: 'full',
      ignored: ['apps/desktop/shared/ipc.ts'],
    });
  });
});

describe('selecting', () => {
  it('a source file selects the files its entry lists, and nothing else', () => {
    const selection = choose(['apps/desktop/src/renderer/tab-drag.ts']);
    expect(selection).toMatchObject({
      mode: 'selected',
      files: ['e2e/tab-drag.desktop.test.ts'],
      count: 1,
      packageSuite: false,
    });
    expect(selection.total).toBe(real.onDisk.desktop.length);
  });

  it('a changed e2e file selects itself', () => {
    expect(choose(['apps/desktop/e2e/theme.desktop.test.ts']).files).toEqual([
      'e2e/theme.desktop.test.ts',
    ]);
  });

  it('a new e2e file selects itself, even beside wiring that reaches nothing', () => {
    const onDisk = {
      ...real.onDisk,
      desktop: [...real.onDisk.desktop, 'brand-new.desktop.test.ts'].sort(),
    };
    const selection = select({
      ...real,
      onDisk,
      changed: ['apps/desktop/e2e/brand-new.desktop.test.ts', 'apps/desktop/shared/i18n/en.ts'],
    });
    expect(selection).toMatchObject({
      mode: 'selected',
      files: ['e2e/brand-new.desktop.test.ts'],
      count: 1,
      total: real.onDisk.desktop.length + 1,
    });
  });

  it('a deleted e2e file is not handed to the runner', () => {
    expect(choose(['apps/desktop/e2e/gone.desktop.test.ts'])).toMatchObject({
      mode: 'selected',
      files: [],
      count: 0,
    });
  });

  it('a changed package test turns the package suite on and selects no desktop file', () => {
    expect(choose(['apps/desktop/e2e/update.package.test.ts'])).toMatchObject({
      mode: 'selected',
      count: 0,
      packageSuite: true,
    });
  });

  it('the update feed reaches the package suite through its entry', () => {
    expect(choose(['apps/desktop/src/main/update-feed.ts']).packageSuite).toBe(true);
  });

  it('unions what several paths select', () => {
    const selection = choose([
      'apps/desktop/src/renderer/tab-drag.ts',
      'apps/desktop/src/renderer/template-mode-tag.ts',
    ]);
    expect(selection.files).toEqual([
      'e2e/tab-drag.desktop.test.ts',
      'e2e/template-mode.desktop.test.ts',
      'e2e/template-session.desktop.test.ts',
    ]);
  });

  it.each([
    ['Markdown', 'apps/desktop/CHANGELOG.md'],
    ['a changeset', '.changeset/brave-owls-sing.md'],
    ['a unit test of the app', 'apps/desktop/src/main/queue.test.ts'],
    ['a unit test of a package mapped to all', 'packages/core/src/scene.test.ts'],
    ['a unit test beside the e2e files', 'apps/desktop/e2e/launch-isolation.test.ts'],
    ['a tool outside the desktop scope', 'tools/template-preview/src/server.ts'],
    ['the docs site', 'apps/docs/index.html'],
  ])('ignores %s', (_case, path) => {
    expect(choose([path])).toMatchObject({ mode: 'selected', count: 0, packageSuite: false });
  });
});

describe('the command it prints', () => {
  it('names the selected files for test:desktop', () => {
    expect(commandsFor(choose(['apps/desktop/src/renderer/tab-drag.ts']))).toEqual([
      'pnpm --filter @tyto/desktop test:desktop e2e/tab-drag.desktop.test.ts',
    ]);
  });

  it('runs both suites whole in full mode', () => {
    expect(commandsFor(choose(['pnpm-lock.yaml']))).toEqual([
      'pnpm --filter @tyto/desktop test:desktop',
      'pnpm --filter @tyto/desktop test:package',
    ]);
  });

  it('prints nothing to run when nothing is selected', () => {
    expect(commandsFor(choose(['docs/architecture.md']))).toEqual([]);
  });
});

describe('the diff', () => {
  it('reads base...head, three dots', () => {
    const calls = [];
    const git = (args) => {
      calls.push(args);
      return 'a.ts\nb.ts\n';
    };
    expect(threeDotDiff({ base: 'origin/main', head: 'abc' }, git)).toEqual({
      changed: ['a.ts', 'b.ts'],
    });
    expect(calls).toEqual([['diff', '--name-only', 'origin/main...abc']]);
  });

  it('adds the working tree, untracked files included, in local mode', () => {
    const answers = {
      'merge-base': 'base-sha\n',
      diff: 'committed.ts\nedited.ts\n',
      'ls-files': 'new.ts\n',
    };
    const git = (args) => answers[args[0]];
    expect(threeDotDiff({ base: 'origin/main', workingTree: true }, git)).toEqual({
      changed: ['committed.ts', 'edited.ts', 'new.ts'],
    });
  });

  it('reports a git failure instead of an empty diff', () => {
    const git = () => {
      throw new Error('fatal: bad revision');
    };
    expect(threeDotDiff({ base: 'nope' }, git)).toEqual({
      changed: null,
      failure: 'git failed: fatal: bad revision',
    });
  });
});

describe('the glob syntax', () => {
  it.each([
    ['apps/desktop/src/preload/**', 'apps/desktop/src/preload/a/b.ts', true],
    ['apps/desktop/shared/{ipc,commands}.ts', 'apps/desktop/shared/commands.ts', true],
    ['apps/desktop/shared/{ipc,commands}.ts', 'apps/desktop/shared/layout.ts', false],
    ['packages/export-*/**', 'packages/export-svg/src/index.ts', true],
    ['tsconfig*.json', 'apps/desktop/tsconfig.json', false],
    ['**/*.md', 'README.md', true],
    ['**/*.md', 'docs/adr/0001.md', true],
    ['apps/desktop/src/main/ipc.ts', 'apps/desktop/src/main/ipcXts', false],
  ])('%s against %s is %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});
