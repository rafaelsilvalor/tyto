import { isErr, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import type { Exporter } from './contributions.js';
import { type Plugin, createPluginHost } from './host.js';

/**
 * `tryActivate` — the loader's door (TYTO-47).
 *
 * The acceptance criterion is *"a plugin whose contribution id collides with an installed
 * one is refused by name, and the run continues without it"*. Three things have to be true
 * for that sentence: nothing is thrown, the refusal names both plugins, and **nothing the
 * loser registered is left behind** — a half-activated plugin is worse than a refused one,
 * because it is running and nobody listed it.
 */

function exporterOf(id: string, kinds: readonly string[] = [id]): Exporter {
  return {
    id,
    mime: `application/${id}`,
    extension: id,
    kinds,
    rasterized: false,
    exportFrame: () => ok(`<${id}/>`),
  };
}

const manifestOf = (name: string, contributes: readonly string[] = ['exporter']): unknown => ({
  name,
  version: '0.1.0',
  engine: '>=0.1',
  contributes,
  permissions: [],
});

function pluginOf(id: string, activate: Plugin['activate']): Plugin {
  return { id, manifest: manifestOf(id), activate };
}

const ownSvg = pluginOf('svg', (host) => host.registerExporter(exporterOf('svg')));

describe('tryActivate', () => {
  it('records an installed plugin as external and hands its contributions back', () => {
    const host = createPluginHost();
    const result = host.tryActivate(pluginOf('pdf', (h) => h.registerExporter(exporterOf('pdf'))));

    expect(result.ok).toBe(true);
    expect(host.registry.plugins().map((plugin) => plugin.origin)).toEqual(['external']);
    expect(host.registry.exporters.forKind('pdf')?.id).toBe('pdf');
  });

  it('refuses a colliding id by name, and withdraws everything the loser had registered', () => {
    const host = createPluginHost();
    host.activate(ownSvg);

    const loser = pluginOf('vetor', (h) => {
      // Registered first, so the collision below lands mid-activation: the half the host
      // must clean up.
      h.registerExporter(exporterOf('vetor-pdf', ['pdf']));
      h.registerExporter(exporterOf('svg'));
    });

    const result = host.tryActivate(loser);

    expect(isErr(result) && result.error.map((item) => item.code)).toEqual(['E_PLUGIN_DUPLICATE']);
    expect(isErr(result) && result.error[0]?.message).toBe(
      "Plugin 'vetor' was refused: extension point 'exporter' already has 'svg', registered by plugin 'svg'.",
    );
    // The winner keeps its id; the loser left nothing behind and is not listed.
    expect(host.registry.exporters.list().map((exporter) => exporter.id)).toEqual(['svg']);
    expect(host.registry.plugins().map((plugin) => plugin.manifest.name)).toEqual(['svg']);
  });

  it('keeps the host usable afterwards: the next plugin still activates', () => {
    const host = createPluginHost();
    host.activate(ownSvg);
    host.tryActivate(pluginOf('vetor', (h) => h.registerExporter(exporterOf('svg'))));

    const next = host.tryActivate(pluginOf('pdf', (h) => h.registerExporter(exporterOf('pdf'))));
    expect(next.ok).toBe(true);
  });

  it('refuses a name already taken without withdrawing the plugin that has it', () => {
    const host = createPluginHost();
    host.activate(ownSvg);

    const impostor = pluginOf('svg', (h) => h.registerExporter(exporterOf('outro')));
    const result = host.tryActivate(impostor);

    expect(isErr(result) && result.error.map((item) => item.code)).toEqual(['E_PLUGIN_NAME_TAKEN']);
    expect(host.registry.exporters.forKind('svg')?.id).toBe('svg');
  });

  it('refuses a manifest that does not validate before running any of its code', () => {
    const host = createPluginHost();
    let ran = false;
    const result = host.tryActivate(
      pluginOf('Frágil', () => {
        ran = true;
      }),
    );

    expect(isErr(result) && result.error[0]?.code).toBe('E_PLUGIN_MANIFEST_SHAPE');
    expect(ran).toBe(false);
  });

  it('turns a throw that is not even an Error into a diagnostic', () => {
    const host = createPluginHost();
    const result = host.tryActivate(
      pluginOf('fragil', () => {
        throw 'not even an Error';
      }),
    );

    expect(isErr(result) && result.error[0]?.message).toBe(
      "Plugin 'fragil' failed to activate: not even an Error.",
    );
  });

  it('turns a throw inside a valid plugin into E_PLUGIN_ACTIVATE and withdraws what it did', () => {
    const host = createPluginHost();
    const result = host.tryActivate(
      pluginOf('fragil', (h) => {
        h.registerExporter(exporterOf('fragil'));
        throw new RangeError('boom');
      }),
    );

    expect(isErr(result) && result.error[0]?.message).toBe(
      "Plugin 'fragil' failed to activate: boom.",
    );
    expect(host.registry.exporters.list()).toEqual([]);
  });

  it('refuses a contribution to an undeclared point as data, not as a throw', () => {
    const host = createPluginHost();
    const liar: Plugin = {
      id: 'liar',
      manifest: manifestOf('liar', ['exporter']),
      activate: (h) => h.registerPanel({ id: 'painel', title: 'Painel' }),
    };

    const result = host.tryActivate(liar);

    expect(isErr(result) && result.error[0]?.code).toBe('E_PLUGIN_ACTIVATE');
    expect(host.registry.panels()).toEqual([]);
  });
});
