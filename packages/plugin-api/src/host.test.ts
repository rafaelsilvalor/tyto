import { ok } from '@tyto/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Exporter } from './contributions.js';
import { type Disposable, type Logger, createPluginHost } from './host.js';

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
