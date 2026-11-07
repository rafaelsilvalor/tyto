import { ok } from '@tyto/core';
import type { LoadedPlugins, Plugin } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type FetchedPlugins, type WindowPlugins, windowPlugins } from './window-plugins.js';

const manifest = (name: string, contributes: readonly string[], permissions: string[] = []) => ({
  name,
  version: '1.0.0',
  engine: '>=0.1',
  contributes,
  permissions,
});

const DEMO: Plugin = {
  id: 'demo',
  manifest: manifest('demo', ['directive', 'panel'], ['net:api.example.com']),
  activate: (host) => {
    host.registerDirective({
      id: 'demo',
      names: ['shout'],
      transform: () => ok([{ name: 'titulo', body: [{ kind: 'text', value: 'OI' }] }]),
    });
    return host.registerPanel({ id: 'contagem', title: 'Contagem', entry: 'panel/index.html' });
  },
};

const OTHER: Plugin = {
  id: 'outro',
  manifest: manifest('outro', ['panel']),
  activate: (host) => host.registerPanel({ id: 'lista', title: 'Lista', entry: 'lista.html' }),
};

const loaded = (...plugins: Plugin[]): LoadedPlugins => ({
  plugins,
  warnings: [],
  close: () => Promise.resolve(),
});

describe('windowPlugins', () => {
  it('offers nothing until the plugins have started, and theirs after', async () => {
    let start: (value: LoadedPlugins) => void = () => undefined;
    const window = windowPlugins(new Promise((resolve) => (start = resolve)));

    expect(window.names()).toEqual([]);
    expect(window.resolver.find('demo', 'shout')).toBeUndefined();
    expect(window.panels()).toEqual([]);

    start(loaded(DEMO));
    await window.ready;
    expect(window.names()).toEqual(['demo/shout']);
    expect(window.resolver.find('demo', 'shout')).toBeTypeOf('function');
  });

  it('knows which plugin registered each panel, and what that plugin was granted', async () => {
    const window = windowPlugins(Promise.resolve(loaded(DEMO, OTHER)));
    await window.ready;

    expect(window.panels().map(({ plugin, panel }) => [plugin, panel.id])).toEqual([
      ['demo', 'contagem'],
      ['outro', 'lista'],
    ]);
    expect(window.permissionsOf('demo')).toEqual(['net:api.example.com']);
    expect(window.permissionsOf('nobody')).toBeUndefined();
  });

  it('knows which plugin bound which keys, in activation order (TYTO-207)', async () => {
    const KEYS: Plugin = {
      id: 'teclas',
      manifest: manifest('teclas', ['editor.keymap']),
      activate: (host) =>
        host.registerKeymap({
          id: 'vim',
          bindings: { 'alt+j': 'preview.zoomIn' },
          when: 'vim.normal',
        }),
    };
    const window = windowPlugins(Promise.resolve(loaded(DEMO, KEYS)));
    expect(window.keymaps()).toEqual([]);
    await window.ready;

    expect(window.keymaps()).toEqual([
      {
        plugin: 'teclas',
        keymap: { id: 'vim', bindings: { 'alt+j': 'preview.zoomIn' }, when: 'vim.normal' },
      },
    ]);
  });

  it('knows which plugin mapped which vim keys (TYTO-418)', async () => {
    const VIM: Plugin = {
      id: 'vimmer',
      manifest: manifest('vimmer', ['editor.vim']),
      activate: (host) =>
        host.registerVim({ id: 'exchange', mappings: [{ keys: 'cx', operation: 'exchange' }] }),
    };
    const window = windowPlugins(Promise.resolve(loaded(DEMO, VIM)));
    expect(window.vim()).toEqual([]);
    await window.ready;

    expect(window.vim()).toEqual([
      {
        plugin: 'vimmer',
        contribution: { id: 'exchange', mappings: [{ keys: 'cx', operation: 'exchange' }] },
      },
    ]);
  });

  it('is ready, with nothing, when the plugins could not be started', async () => {
    const window = windowPlugins(Promise.reject(new Error('disk')));
    await window.ready;
    expect(window.panels()).toEqual([]);
  });

  // TYTO-254, ADR 0145: the installed plugins' settings, and the door their values go through.
  it("declares the installed plugins' settings once started, and hands them their values", async () => {
    let start: (value: LoadedPlugins) => void = () => undefined;
    const read: unknown[] = [];
    const CONNECTOR: Plugin = {
      id: 'conector',
      manifest: manifest('conector', ['configuration']),
      activate: (host) => {
        host.events.on('configured', () => {
          read.push(host.config(z.object({ baseUrl: z.string() }).optional())?.baseUrl);
        });
        return host.registerConfiguration({
          id: 'baseUrl',
          form: { type: 'string', format: 'uri' },
          default: 'https://default.example',
          description: 'Where the service is.',
        });
      },
    };
    const window = windowPlugins(new Promise((resolve) => (start = resolve)));
    expect(window.configurations()).toEqual([]);
    expect(window.running()).toEqual([]);

    start(loaded(CONNECTOR));
    await window.ready;
    expect(window.configurations().map((setting) => [setting.key, setting.prefixed])).toEqual([
      ['conector.baseUrl', true],
    ]);
    expect(window.running()).toEqual(['conector']);

    window.configure({ conector: { baseUrl: 'https://acme.example' } });
    expect(read).toEqual(['https://acme.example']);
  });

  // TYTO-377, ADR 0148: the recipe notebook's verbs, read per call and gated like the rest.
  it('offers no recipe verbs until the plugins have started, and each with its plugin after', async () => {
    let start: (value: LoadedPlugins) => void = () => undefined;
    const CONNECTOR: Plugin = {
      id: 'conector',
      manifest: {
        ...manifest('conector', ['recipe-verb', 'recipe-derivation']),
        namespace: 'acme',
      },
      activate: (host) => {
        host.registerRecipeVerb({
          id: 'acme.tidy',
          kind: 'transform',
          arguments: [],
          transform: ({ table }) => ok(table),
        });
        return host.registerRecipeDerivation({
          id: 'acme.kind',
          requires: [],
          produces: [],
          derive: (table) => ok(table),
        });
      },
    };
    const window = windowPlugins(new Promise((resolve) => (start = resolve)));
    const recipes = window.recipeContributions();
    expect(recipes.recipeVerbs()).toEqual([]);
    expect(recipes.ownedRecipeVerbs()).toEqual([]);
    expect(recipes.recipeDerivations()).toEqual([]);

    start(loaded(CONNECTOR));
    await window.ready;
    // The object asked for before start-up answers now: it reads the host on every call.
    expect(recipes.recipeVerbs().map((verb) => verb.id)).toEqual(['acme.tidy']);
    expect(recipes.ownedRecipeVerbs().map(({ plugin, verb }) => [plugin, verb.id])).toEqual([
      ['conector', 'acme.tidy'],
    ]);
    expect(recipes.recipeDerivations().map((derivation) => derivation.id)).toEqual(['acme.kind']);
  });
});

/**
 * The plugins the plugin files fetched (TYTO-466): handed to the same object, activated into
 * the same host before the installed plugins, and withdrawn whole when the set starts again.
 */
describe('the fetched set', () => {
  const plugin = (
    id: string,
    contributes: readonly string[],
    activate: Plugin['activate'],
    extra: Record<string, unknown> = {},
  ): Plugin => ({ id, manifest: { ...manifest(id, contributes), ...extra }, activate });

  const fetchedSet = (...plugins: Plugin[]): FetchedPlugins => ({
    loaded: loaded(...plugins),
    directoryOf: (name) => `/cache/${name}`,
  });

  /** One fetched plugin per extension point, and what the window reads it through. */
  const POINTS: readonly {
    readonly point: string;
    readonly plugin: Plugin;
    readonly read: (window: WindowPlugins) => readonly unknown[];
  }[] = [
    {
      point: 'directive',
      plugin: plugin('d', ['directive'], (host) =>
        host.registerDirective({ id: 'd', names: ['shout'], transform: () => ok([]) }),
      ),
      read: (window) => window.names(),
    },
    {
      point: 'panel',
      plugin: plugin('p', ['panel'], (host) =>
        host.registerPanel({ id: 'lista', title: 'Lista', entry: 'lista.html' }),
      ),
      read: (window) => window.panels(),
    },
    {
      point: 'editor.keymap',
      plugin: plugin('k', ['editor.keymap'], (host) =>
        host.registerKeymap({ id: 'keys', bindings: { 'alt+j': 'preview.zoomIn' } }),
      ),
      read: (window) => window.keymaps(),
    },
    {
      point: 'editor.vim',
      plugin: plugin('v', ['editor.vim'], (host) =>
        host.registerVim({ id: 'exchange', mappings: [{ keys: 'cx', operation: 'exchange' }] }),
      ),
      read: (window) => window.vim(),
    },
    {
      point: 'theme',
      plugin: plugin('t', ['theme'], (host) =>
        host.registerTheme({ id: 'dusk', label: 'Dusk', kind: 'dark', path: 'dusk.json' }),
      ),
      read: (window) => window.themes(),
    },
    {
      point: 'brand-kit',
      plugin: plugin('b', ['brand-kit'], (host) =>
        host.registerBrandKit({ id: 'kit', brands: { 'test-brand': { signature: '@b' } } }),
      ),
      read: (window) => [...window.brandKits().kits.keys()],
    },
    {
      point: 'asset-source',
      plugin: plugin('a', ['asset-source'], (host) =>
        host.registerAssetSource({
          id: 'images',
          schemes: ['test'],
          fetch: () => ok({ bytes: new Uint8Array([1]), mime: 'image/png' }),
        }),
      ),
      read: (window) => window.assetSources(),
    },
    {
      point: 'font-source',
      plugin: plugin('f', ['font-source'], (host) =>
        host.registerFontSource({
          id: 'faces',
          families: ['Inter'],
          fetch: () => ok(new Uint8Array([1])),
        }),
      ),
      read: (window) => window.fontSources(),
    },
    {
      point: 'configuration',
      plugin: plugin('c', ['configuration'], (host) =>
        host.registerConfiguration({
          id: 'baseUrl',
          form: { type: 'string', format: 'uri' },
          default: 'https://default.example',
          description: 'Where the service is.',
        }),
      ),
      read: (window) => window.configurations(),
    },
    {
      point: 'recipe-verb',
      plugin: plugin(
        'r',
        ['recipe-verb'],
        (host) =>
          host.registerRecipeVerb({
            id: 'acme.tidy',
            kind: 'transform',
            arguments: [],
            transform: ({ table }) => ok(table),
          }),
        { namespace: 'acme' },
      ),
      read: (window) => window.recipeContributions().recipeVerbs(),
    },
  ];

  it.each(POINTS)('contributes its $point to the window', async ({ plugin: fetched, read }) => {
    const window = windowPlugins(Promise.resolve(loaded()));
    await window.ready;
    expect(read(window)).toHaveLength(0);

    window.setFetched(fetchedSet(fetched));
    expect(read(window)).toHaveLength(1);
    expect(window.running()).toEqual([fetched.id]);

    // Withdrawn whole when the set is taken away: nothing of it is offered again.
    window.setFetched(undefined);
    expect(read(window)).toHaveLength(0);
  });

  it('is kept when handed over before the installed plugins have started, and taken at start', async () => {
    let start: (value: LoadedPlugins) => void = () => undefined;
    const window = windowPlugins(new Promise((resolve) => (start = resolve)));
    window.setFetched(fetchedSet(OTHER));
    expect(window.panels()).toEqual([]);

    start(loaded(DEMO));
    await window.ready;
    expect(window.panels().map(({ plugin: owner }) => owner)).toEqual(['outro', 'demo']);
  });

  it('starts again with no stale panel, key, theme or directive of the previous set', async () => {
    const first = plugin('primeiro', ['panel', 'editor.keymap', 'theme', 'directive'], (host) => {
      host.registerPanel({ id: 'velho', title: 'Velho', entry: 'velho.html' });
      host.registerKeymap({ id: 'velho', bindings: { 'alt+v': 'preview.zoomIn' } });
      host.registerTheme({ id: 'velho', label: 'Velho', kind: 'dark', path: 'velho.json' });
      return host.registerDirective({ id: 'velho', names: ['old'], transform: () => ok([]) });
    });
    const second = plugin('segundo', ['panel'], (host) =>
      host.registerPanel({ id: 'novo', title: 'Novo', entry: 'novo.html' }),
    );
    const window = windowPlugins(Promise.resolve(loaded(DEMO)));
    await window.ready;

    window.setFetched(fetchedSet(first));
    window.setFetched(fetchedSet(second));

    expect(window.panels().map(({ plugin: owner, panel }) => `${owner}/${panel.id}`)).toEqual([
      'segundo/novo',
      'demo/contagem',
    ]);
    expect(window.keymaps()).toEqual([]);
    expect(window.themes()).toEqual([]);
    expect(window.names()).toEqual(['demo/shout']);
    expect(window.running()).toEqual(['segundo', 'demo']);
    expect(window.fetchedDirectory('segundo')).toBe('/cache/segundo');
    expect(window.fetchedDirectory('primeiro')).toBeUndefined();
    expect(window.fetchedDirectory('demo')).toBeUndefined();
  });

  // ADR 0151 decision 7: the plugin files come before `tyto plugin install` in the search
  // order, and the earlier source wins.
  it('wins an id an installed plugin also contributes, the installed one being refused', async () => {
    const fetched = plugin('baixado', ['directive', 'brand-kit'], (host) => {
      host.registerBrandKit({ id: 'kit', brands: { 'test-brand': { signature: '@baixado' } } });
      return host.registerDirective({ id: 'demo', names: ['shout'], transform: () => ok([]) });
    });
    const window = windowPlugins(Promise.resolve(loaded(DEMO, OTHER)));
    await window.ready;
    expect(window.running()).toEqual(['demo', 'outro']);

    window.setFetched(fetchedSet(fetched));

    // `demo` registers the same directive id, so the host refuses it whole; `outro` stands.
    expect(window.running()).toEqual(['baixado', 'outro']);
    expect(window.panels().map(({ plugin: owner }) => owner)).toEqual(['outro']);
    expect(window.brandKits().kits.get('test-brand')).toEqual({ signature: '@baixado' });
  });

  it('replaces an installed plugin of the same name, which is not activated at all', async () => {
    const copy = plugin('demo', ['panel'], (host) =>
      host.registerPanel({ id: 'copia', title: 'Cópia', entry: 'copia.html' }),
    );
    const window = windowPlugins(Promise.resolve(loaded(DEMO)));
    await window.ready;

    window.setFetched(fetchedSet(copy));

    expect(window.panels().map(({ panel }) => panel.id)).toEqual(['copia']);
    expect(window.names()).toEqual([]);
    expect((await window.inForce()).plugins).toEqual([copy]);
    expect(window.fetchedDirectory('demo')).toBe('/cache/demo');
  });

  it('hands an export the fetched plugins first, then the installed ones', async () => {
    const window = windowPlugins(Promise.resolve(loaded(DEMO)));
    window.setFetched(fetchedSet(OTHER));
    expect((await window.inForce()).plugins.map((each) => each.id)).toEqual(['outro', 'demo']);
  });

  it('sends a fetched plugin the settings in force when the set starts again', async () => {
    const read: unknown[] = [];
    const fetched = plugin('conector', ['configuration'], (host) => {
      read.push(host.config(z.object({ baseUrl: z.string() }).optional())?.baseUrl);
      return host.registerConfiguration({
        id: 'baseUrl',
        form: { type: 'string', format: 'uri' },
        default: 'https://default.example',
        description: 'Where the service is.',
      });
    });
    const window = windowPlugins(Promise.resolve(loaded()));
    await window.ready;
    window.configure({ conector: { baseUrl: 'https://acme.example' } });

    window.setFetched(fetchedSet(fetched));

    expect(read).toEqual(['https://acme.example']);
  });
});
