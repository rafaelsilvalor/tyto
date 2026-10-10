import { ok } from '@tyto/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { BrandKitContribution, Exporter } from './contributions.js';
import { type Disposable, type Logger, type Plugin, createPluginHost } from './host.js';
import { CONTRIBUTION_POINTS } from './manifest.js';

/**
 * The host's whole job is identity and withdrawal: which contribution answers to which id,
 * and what is left after somebody leaves. Both acceptance criteria of TYTO-34 are about
 * exactly that, so the tests are too.
 */

function exporterOf(id: string, kinds: readonly string[] = [id]): Exporter {
  return {
    id,
    mime: `image/${id}`,
    extension: id,
    kinds,
    rasterized: false,
    exportFrame: () => ok(`<${id}/>`),
  };
}

describe('registering', () => {
  it('hands a contribution back through the registry', () => {
    const host = createPluginHost();
    host.hostFor('built-in').registerExporter(exporterOf('svg'));

    expect(host.registry.exporters.forKind('svg')?.id).toBe('svg');
    expect(host.registry.exporters.list().map((item) => item.id)).toEqual(['svg']);
  });

  it('refuses a second exporter with the same id, naming the plugin that has it', () => {
    // The acceptance criterion. Two `svg` exporters is a question with no right answer, so
    // the host refuses rather than picking one and leaving nobody able to tell which.
    const host = createPluginHost();
    host.hostFor('built-in').registerExporter(exporterOf('svg'));

    expect(() => host.hostFor('terceiro').registerExporter(exporterOf('svg'))).toThrow(
      /already has 'svg', registered by plugin 'built-in'/u,
    );
  });

  it('lets two exporters coexist when their ids differ', () => {
    const host = createPluginHost();
    host.hostFor('built-in').registerExporter(exporterOf('svg'));
    host.hostFor('built-in').registerExporter(exporterOf('html', ['png', 'jpeg', 'webp']));

    expect(host.registry.exporters.forKind('png')?.id).toBe('html');
    expect(host.registry.exporters.forKind('svg')?.id).toBe('svg');
  });

  it('answers nothing for a kind no exporter claims', () => {
    const host = createPluginHost();
    host.hostFor('built-in').registerExporter(exporterOf('svg'));

    expect(host.registry.exporters.forKind('pdf')).toBeUndefined();
  });

  it('keeps registration order, which a picker and a --help listing both rely on', () => {
    const host = createPluginHost();
    const plugin = host.hostFor('built-in');
    plugin.registerExporter(exporterOf('html', ['png']));
    plugin.registerExporter(exporterOf('svg'));

    expect(host.registry.exporters.list().map((item) => item.id)).toEqual(['html', 'svg']);
  });
});

describe('disposing', () => {
  it('removes one contribution and leaves the others', () => {
    const host = createPluginHost();
    const plugin = host.hostFor('built-in');
    const svg = plugin.registerExporter(exporterOf('svg'));
    plugin.registerExporter(exporterOf('html', ['png']));

    svg.dispose();

    expect(host.registry.exporters.list().map((item) => item.id)).toEqual(['html']);
  });

  it('removes every registration a plugin made, in one call', () => {
    // The second acceptance criterion. A plugin is unloaded as a unit, so nothing it left
    // behind may answer a lookup afterwards.
    const host = createPluginHost();
    const plugin = host.hostFor('promo');
    plugin.registerExporter(exporterOf('pdf'));
    plugin.registerSource({ id: 'http-inbox', value: { pull: () => [] } });
    plugin.registerTemplatePack({ id: 'juridico', templates: [] });

    host.disposePlugin('promo');

    expect(host.registry.exporters.list()).toEqual([]);
    expect(host.registry.sources()).toEqual([]);
    expect(host.registry.templatePacks()).toEqual([]);
  });

  it('leaves another plugin alone', () => {
    const host = createPluginHost();
    host.hostFor('built-in').registerExporter(exporterOf('svg'));
    host.hostFor('promo').registerExporter(exporterOf('pdf'));

    host.disposePlugin('promo');

    expect(host.registry.exporters.list().map((item) => item.id)).toEqual(['svg']);
  });

  it('is idempotent, and frees the id for somebody else', () => {
    const host = createPluginHost();
    const first = host.hostFor('built-in').registerExporter(exporterOf('svg'));

    first.dispose();
    first.dispose();
    host.hostFor('terceiro').registerExporter(exporterOf('svg'));

    expect(host.registry.exporters.forKind('svg')).toBeDefined();
  });

  it('a stale disposable does not remove the contribution that replaced it', () => {
    // Held past a re-registration. Deleting by id alone would take somebody else's
    // exporter out, and the plugin that lost it would have no idea why.
    const host = createPluginHost();
    const stale = host.hostFor('built-in').registerExporter(exporterOf('svg'));
    stale.dispose();
    const replacement = exporterOf('svg');
    host.hostFor('terceiro').registerExporter(replacement);

    stale.dispose();

    expect(host.registry.exporters.forKind('svg')).toBe(replacement);
  });
});

describe('the generic extension points', () => {
  it('hand back the value with the type the caller put in', () => {
    // `Rasterizer`, `BriefSource` and `OutputSink` live in Node packages this pure one may
    // not import, so the host stores the value and only ever reads its id.
    interface FakeRasterizer {
      raster(): string;
    }
    const host = createPluginHost();
    host.hostFor('built-in').registerRasterizer<FakeRasterizer>({
      id: 'chromium',
      value: { raster: () => 'bytes' },
    });

    const [registered] = host.registry.rasterizers<FakeRasterizer>();
    expect(registered?.value.raster()).toBe('bytes');
  });
});

describe('config', () => {
  it('validates the plugin its own slice, and nobody else s', () => {
    const host = createPluginHost({
      config: { promo: { retries: 3 }, outro: { retries: 'muitas' } },
    });

    expect(host.hostFor('promo').config(z.object({ retries: z.number() }))).toEqual({
      retries: 3,
    });
  });

  it('throws rather than letting a plugin half-work on configuration it cannot use', () => {
    const host = createPluginHost({ config: { promo: { retries: 'muitas' } } });

    expect(() => host.hostFor('promo').config(z.object({ retries: z.number() }))).toThrow(
      /does not match the schema/u,
    );
  });
});

describe('events and logging', () => {
  it('announces a registration and a disposal, with the point that changed', () => {
    const host = createPluginHost();
    const plugin = host.hostFor('built-in');
    const seen: string[] = [];
    plugin.events.on('registered', (payload) => seen.push(`+${payload.point}:${payload.id}`));
    plugin.events.on('disposed', (payload) => seen.push(`-${payload.point}:${payload.id}`));

    plugin.registerExporter(exporterOf('svg')).dispose();

    expect(seen).toEqual(['+exporter:svg', '-exporter:svg']);
  });

  it('survives a listener that throws', () => {
    // A progress bar with a bug is not a reason for a plugin to fail to load. `pipeline`'s
    // job listener makes the same promise, for the same reason.
    const host = createPluginHost();
    const plugin = host.hostFor('built-in');
    plugin.events.on('registered', () => {
      throw new Error('a listener with a bug');
    });

    expect(() => plugin.registerExporter(exporterOf('svg'))).not.toThrow();
    expect(host.registry.exporters.forKind('svg')).toBeDefined();
  });

  it('stops calling a listener that was disposed', () => {
    const host = createPluginHost();
    const plugin = host.hostFor('built-in');
    const listener = vi.fn();
    const subscription: Disposable = plugin.events.on('registered', listener);

    subscription.dispose();
    plugin.registerExporter(exporterOf('svg'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('hands every plugin the logger the composition root supplied', () => {
    const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const host = createPluginHost({ log });

    host.hostFor('promo').log.warn('algo');

    expect(log.warn).toHaveBeenCalledWith('algo');
  });
});

describe('activating a plugin', () => {
  const manifestOf = (overrides: Record<string, unknown> = {}) => ({
    name: 'promo',
    version: '0.1.0',
    engine: '>=0.1',
    contributes: ['exporter'],
    permissions: [],
    ...overrides,
  });

  const pluginOf = (overrides: Partial<Plugin> = {}): Plugin => ({
    id: 'promo',
    manifest: manifestOf(),
    activate: (host) => host.registerExporter(exporterOf('promo')),
    ...overrides,
  });

  it('validates the manifest, records it, and lists it as built-in', () => {
    const host = createPluginHost();
    host.activate(pluginOf());

    expect(host.registry.plugins()).toEqual([{ manifest: manifestOf(), origin: 'built-in' }]);
    expect(host.registry.exporters.forKind('promo')?.id).toBe('promo');
  });

  it('records the origin the caller gives it, because a manifest cannot know its own', () => {
    const host = createPluginHost();
    host.activate(pluginOf(), 'external');

    expect(host.registry.plugins().map((plugin) => plugin.origin)).toEqual(['external']);
  });

  it('refuses a manifest that does not validate, saying which field', () => {
    const host = createPluginHost();

    expect(() => host.activate(pluginOf({ manifest: manifestOf({ version: '0.1' }) }))).toThrow(
      /tyto-plugin\.json the host cannot read.*'version'/s,
    );
    expect(host.registry.plugins()).toEqual([]);
  });

  it('refuses a manifest whose name disagrees with the plugin id', () => {
    // One identity, not two. The id keys every extension point and would name a folder on
    // disk; a listing printing one name while an error prints another is the bug this
    // forecloses.
    const host = createPluginHost();

    expect(() => host.activate(pluginOf({ id: 'outro' }))).toThrow(/naming 'promo'/);
  });

  it('refuses a plugin that registers into a point its manifest does not declare', () => {
    // `contributes` is a promise about which points a plugin touches, made in a file read
    // before any of its code runs. Nothing verified it until here, which is exactly how a
    // listing could have shown contributes nobody had checked (TYTO-35).
    const host = createPluginHost();
    const liar = pluginOf({
      manifest: manifestOf({ contributes: ['exporter'] }),
      activate: (plugin) => {
        plugin.registerExporter(exporterOf('promo'));
        plugin.registerPanel({ id: 'promo-panel', title: 'Promo', entry: 'panel.html' });
      },
    });

    expect(() => host.activate(liar)).toThrow(/registered into 'panel'/);
  });

  it('allows a declared point the plugin did not register into', () => {
    // `templatePackPlugin` contributes an empty pack today and a conditional contribution
    // is a shape this API has not ruled out, so only the undeclared direction throws.
    const host = createPluginHost();
    host.activate(pluginOf({ manifest: manifestOf({ contributes: ['exporter', 'directive'] }) }));

    expect(host.registry.plugins()).toHaveLength(1);
    expect(host.registry.directives()).toEqual([]);
  });

  it('forgets the plugin when it is disposed, not just its contributions', () => {
    const host = createPluginHost();
    host.activate(pluginOf());
    host.disposePlugin('promo');

    expect(host.registry.plugins()).toEqual([]);
    expect(host.registry.exporters.list()).toEqual([]);
  });

  it('knows the same twelve points the manifest vocabulary names', () => {
    // Two declarations of one vocabulary: `CONTRIBUTION_POINTS` is what a JSON file may
    // say, and the host's points are what code may register into. This activates one
    // plugin into all twelve and compares what was recorded against the list.
    const host = createPluginHost();
    host.activate(
      pluginOf({
        manifest: manifestOf({ contributes: [...CONTRIBUTION_POINTS] }),
        activate: (plugin) => {
          plugin.registerSource({ id: 'a', value: 1 });
          plugin.registerSink({ id: 'b', value: 1 });
          plugin.registerExporter(exporterOf('promo'));
          plugin.registerRasterizer({ id: 'c', value: 1 });
          plugin.registerTemplatePack({ id: 'd', templates: [] });
          plugin.registerBrandKit({ id: 'i', brands: {} });
          plugin.registerDirective({ id: 'e', names: [], transform: () => ok([]) });
          plugin.registerCommand({ id: 'f', title: 'Do' });
          plugin.registerKeymap({ id: 'g', bindings: {} });
          plugin.registerPanel({ id: 'h', title: 'Promo', entry: 'panel.html' });
          plugin.registerConfiguration({
            id: 'j',
            schema: z.boolean(),
            default: false,
            description: 'A switch.',
          });
          plugin.registerTheme({ id: 'k', label: 'Dusk', kind: 'dark', path: 'dusk.json' });
        },
      }),
    );

    // The real assertion is that this did not throw: a point the host knows and
    // `CONTRIBUTION_POINTS` does not would have been registered without being declared,
    // which `activate` refuses. The counts below say the twelve arrived rather than that
    // nothing was attempted.
    expect(CONTRIBUTION_POINTS).toHaveLength(12);
    expect(
      [
        host.registry.sources(),
        host.registry.sinks(),
        host.registry.exporters.list(),
        host.registry.rasterizers(),
        host.registry.templatePacks(),
        host.registry.brandKits(),
        host.registry.directives(),
        host.registry.commands(),
        host.registry.keymaps(),
        host.registry.panels(),
        host.registry.configurations(),
        host.registry.themes(),
      ].map((point) => point.length),
    ).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('brand kits merge by brand (ADR 0063)', () => {
  // Invented: two brands nobody has, and a triangle and a square.
  const TRIANGLE = {
    box: { w: 10, h: 10 },
    d: 'M0 10 L5 0 L10 10 Z',
    fillRule: 'nonzero',
  } as const;
  const SQUARE = { box: { w: 10, h: 10 }, d: 'M0 0 H10 V10 H0 Z', fillRule: 'evenodd' } as const;

  const kitPlugin = (name: string, brands: BrandKitContribution['brands']): Plugin => ({
    id: name,
    manifest: {
      name,
      version: '0.1.0',
      engine: '>=0.1',
      contributes: ['brand-kit'],
      permissions: [],
    },
    activate: (host) => host.registerBrandKit({ id: `${name}-kit`, brands }),
  });

  it('keeps every brand any plugin offers, each from the plugin that offered it', () => {
    const host = createPluginHost();
    host.activate(kitPlugin('first', { 'test-brand': { logo: TRIANGLE } }));
    expect(
      host.tryActivate(kitPlugin('second', { 'other-brand': { signature: '@other' } })).ok,
    ).toBe(true);

    const merged = host.registry.brandKitsByBrand();

    expect(Object.fromEntries(merged.kits)).toEqual({
      'test-brand': { logo: TRIANGLE },
      'other-brand': { signature: '@other' },
    });
    expect(merged.diagnostics).toEqual([]);
  });

  it('does not withdraw a plugin for offering a brand another already has', () => {
    const host = createPluginHost();
    host.activate(kitPlugin('first', { 'test-brand': { logo: TRIANGLE } }));

    // Unlike two template packs with one id: the brand is inside the kit, not its id.
    expect(host.tryActivate(kitPlugin('second', { 'test-brand': { logo: SQUARE } })).ok).toBe(true);
    expect(host.registry.brandKits().map((kit) => kit.id)).toEqual(['first-kit', 'second-kit']);
  });

  it('lets the plugin registered first keep a brand, and names the one it hid', () => {
    const host = createPluginHost();
    host.activate(kitPlugin('first', { 'test-brand': { logo: TRIANGLE, signature: '@first' } }));
    host.hostFor('second').registerBrandKit({
      id: 'second-kit',
      brands: { 'test-brand': { logo: SQUARE }, 'other-brand': { signature: '@other' } },
    });

    const merged = host.registry.brandKitsByBrand();

    expect(merged.kits.get('test-brand')).toEqual({ logo: TRIANGLE, signature: '@first' });
    expect(merged.kits.get('other-brand')).toEqual({ signature: '@other' });
    expect(merged.diagnostics.map((item) => [item.code, item.severity, item.message])).toEqual([
      [
        'W_BRAND_KIT_SHADOWED',
        'warning',
        "The brand kit for 'test-brand' from plugin 'second' is shadowed by the one from 'first', which was registered first.",
      ],
    ]);
  });

  it('merges to nothing, and says nothing, when no plugin offers a kit', () => {
    const merged = createPluginHost().registry.brandKitsByBrand();

    expect([...merged.kits]).toEqual([]);
    expect(merged.diagnostics).toEqual([]);
  });
});
