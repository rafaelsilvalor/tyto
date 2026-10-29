import { type Diagnostic, diagnostic } from '@tyto/core';
import {
  type InstalledPacks,
  NO_INSTALLED_PACKS,
  NO_PLUGIN_FILES,
  type PluginFilesCopyOnDisk,
  type PluginFilesSyncOptions,
  type SyncedPluginFiles,
} from '@tyto/io';
import { type LoadedPlugins, NO_PLUGINS, type PluginStore } from '@tyto/plugin-api';
import { describe, expect, it, vi } from 'vitest';

import {
  type DesktopPluginFilesOptions,
  type FetchedTemplates,
  createDesktopPluginFiles,
  shownPath,
} from './plugin-files.js';

/**
 * When the desktop syncs, and what the window gets (TYTO-433). The sync itself is `@tyto/io`'s,
 * tested there and through the CLI; here it is a fake, so what is pinned is this module's own
 * rule: the copies' plugin set starts again only when what loads changed, a pack offers only
 * the templates its file names, and a row never carries a range into a plugin file.
 */

function copy(
  plugin: string,
  overrides: Partial<PluginFilesCopyOnDisk> = {},
): PluginFilesCopyOnDisk {
  return {
    plugin,
    git: `https://example.invalid/${plugin}.git`,
    ref: 'v1',
    commit: 'a'.repeat(40),
    file: 'templates.yaml',
    wholePlugin: false,
    templates: [`${plugin}-template`],
    directory: `/cache/${plugin}/one`,
    ...overrides,
  };
}

interface Harness {
  readonly plugins: ReturnType<typeof createDesktopPluginFiles>;
  readonly asked: PluginFilesSyncOptions[];
  readonly applied: FetchedTemplates[];
  readonly started: PluginStore[];
  readonly closed: string[];
}

function harness(
  answers: SyncedPluginFiles[],
  packs: (loaded: LoadedPlugins) => InstalledPacks = () => NO_INSTALLED_PACKS,
  overrides: Partial<DesktopPluginFilesOptions> = {},
): Harness {
  const asked: PluginFilesSyncOptions[] = [];
  const applied: FetchedTemplates[] = [];
  const started: PluginStore[] = [];
  const closed: string[] = [];
  let next = 0;
  const plugins = createDesktopPluginFiles({
    home: '/home/.tyto',
    builtInNames: new Set(['built-in-templates']),
    sync: (options) => {
      asked.push(options);
      return Promise.resolve(answers[Math.min(next++, answers.length - 1)] ?? NO_PLUGIN_FILES);
    },
    approve: () => Promise.resolve(false),
    start: (store) => {
      started.push(store);
      const set = `set ${String(started.length)}`;
      return Promise.resolve({
        ...NO_PLUGINS,
        close: () => {
          closed.push(set);
          return Promise.resolve();
        },
      });
    },
    packs: (loaded) => Promise.resolve(packs(loaded)),
    apply: (fetched) => {
      applied.push(fetched);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { plugins, asked, applied, started, closed };
}

const synced = (
  copies: PluginFilesCopyOnDisk[],
  diagnostics: Diagnostic[] = [],
): SyncedPluginFiles => ({
  ...NO_PLUGIN_FILES,
  copies,
  diagnostics,
});

describe('a sync', () => {
  it('fetches, never moving a ref unless asked, with the open folder only when there is one', async () => {
    const { plugins, asked } = harness([synced([])]);

    await plugins.sync({ update: false });
    await plugins.sync({ update: true, workspace: { folder: '/work', trusted: true } });

    expect(asked.map((options) => [options.update, options.fetches, options.workspace])).toEqual([
      [false, true, undefined],
      [true, true, { folder: '/work', trusted: true }],
    ]);
    expect([...(asked[0]?.builtInNames ?? [])]).toEqual(['built-in-templates']);
  });

  it('starts the copies again only when what loads changed', async () => {
    const one = copy('tabela');
    const { plugins, started, closed } = harness([
      synced([one]),
      synced([one]),
      synced([copy('tabela', { directory: '/cache/tabela/two' })]),
    ]);

    await plugins.sync({ update: false });
    await plugins.sync({ update: false });
    expect(started).toHaveLength(1);

    await plugins.sync({ update: true });
    expect(started).toHaveLength(2);
    expect(closed).toEqual(['set 1']);
    await plugins.close();
    expect(closed).toEqual(['set 1', 'set 2']);
  });

  it('starts a store that lists the copies and none of the installed plugins', async () => {
    const { plugins, started } = harness([synced([copy('tabela')])]);

    await plugins.sync({ update: false });

    expect(started[0]?.directoryOf('tabela')).toBe('/cache/tabela/one');
  });

  it('runs one sync at a time, in the order asked', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { plugins } = harness([synced([])], undefined, {
      sync: async () => {
        const call = ++calls;
        order.push(`start ${String(call)}`);
        if (call === 1) await held;
        order.push(`end ${String(call)}`);
        return NO_PLUGIN_FILES;
      },
    });

    const first = plugins.sync({ update: false });
    const second = plugins.sync({ update: false });
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('keeps syncing after one that failed', async () => {
    const sync = vi
      .fn<(options: PluginFilesSyncOptions) => Promise<SyncedPluginFiles>>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue(NO_PLUGIN_FILES);
    const { plugins, applied } = harness([], undefined, { sync });

    await expect(plugins.sync({ update: false })).rejects.toThrow('disk');
    await plugins.sync({ update: false });

    expect(applied).toHaveLength(1);
  });
});

describe('what the window gets', () => {
  it('offers only the templates a file names, and says which installed plugins a copy replaces', async () => {
    const named = copy('tabela', { templates: ['tabela'] });
    const whole = copy('example', { wholePlugin: true, directory: '/cache/example/one' });
    const { plugins, applied } = harness([synced([named, whole])], () => ({
      ...NO_INSTALLED_PACKS,
      directories: ['/cache/tabela/one/templates', '/cache/example/one/templates'],
      owners: new Map([
        ['/cache/tabela/one/templates', 'tabela'],
        ['/cache/example/one/templates', 'example'],
      ]),
    }));

    await plugins.sync({ update: false });

    const fetched = applied[0];
    expect([...(fetched?.only ?? [])]).toEqual([
      ['/cache/tabela/one/templates', new Set(['tabela'])],
    ]);
    expect([...(fetched?.replaces ?? [])]).toEqual(['tabela', 'example']);
  });

  it("names a failed fetch's repository, and puts a file's place in front instead of a range", async () => {
    const failed = diagnostic('W_PLUGIN_FILE_FETCH', {
      git: 'https://example.invalid/tabela.git',
      ref: 'v1',
      problem: 'fatal: repository not found',
      outcome: 'The copy of commit abc fetched earlier loads.',
    });
    const ranged = diagnostic(
      'W_PLUGIN_FILE_KEY_UNKNOWN',
      { path: 'colour', file: 'templates.yaml' },
      { range: { start: 12, end: 18 } },
    );
    const { plugins, applied } = harness([], undefined, {
      sync: (options) => {
        options.onFileRead?.(
          '/work/.tyto/plugin-files/templates.yaml',
          'version: 1\ncolour: red\n',
          [ranged],
        );
        return Promise.resolve(synced([], [failed, ranged]));
      },
    });

    await plugins.sync({ update: false, workspace: { folder: '/work', trusted: true } });

    const [fetch, key] = applied[0]?.problems ?? [];
    expect(fetch?.message).toContain('https://example.invalid/tabela.git');
    expect(fetch?.message).toContain('fatal: repository not found');
    expect(key?.range).toBeUndefined();
    expect(key?.message).toMatch(/^\.tyto[\\/]plugin-files[\\/]templates\.yaml:2:2: /u);
  });
});

describe('a range-less row', () => {
  it('carries the plugin file that named the source it is about (TYTO-433)', async () => {
    const failed = diagnostic('W_PLUGIN_FILE_FETCH', {
      git: 'https://example.invalid/tabela.git',
      ref: 'v1',
      problem: 'fatal: repository not found',
      outcome: 'Nothing from it loads.',
    });
    const { plugins, applied } = harness([], undefined, {
      sync: (options) => {
        options.onSourceProblem?.('/home/.tyto/plugin-files/templates.yaml', [failed]);
        return Promise.resolve(synced([], [failed]));
      },
    });

    await plugins.sync({ update: false });

    expect(applied[0]?.problems[0]?.message).toBe(
      `/home/.tyto/plugin-files/templates.yaml: ${failed.message}`,
    );
  });
});

describe('shownPath', () => {
  it('shortens a path inside the open folder and leaves any other whole', () => {
    expect(shownPath('/work', '/work/.tyto/plugin-files/a.yaml')).toMatch(/^\.tyto/u);
    expect(shownPath('/work', '/home/.tyto/plugin-files/a.yaml')).toBe(
      '/home/.tyto/plugin-files/a.yaml',
    );
    expect(shownPath(undefined, '/home/a.yaml')).toBe('/home/a.yaml');
  });
});
