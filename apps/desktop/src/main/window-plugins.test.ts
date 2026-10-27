import { ok } from '@tyto/core';
import type { LoadedPlugins, Plugin } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { windowPlugins } from './window-plugins.js';

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
