import { ok } from '@tyto/core';
import type { LoadedPlugins, Plugin } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

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

  it('is ready, with nothing, when the plugins could not be started', async () => {
    const window = windowPlugins(Promise.reject(new Error('disk')));
    await window.ready;
    expect(window.panels()).toEqual([]);
  });
});
