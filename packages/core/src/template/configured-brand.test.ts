import { describe, expect, it } from 'vitest';

import type { BriefAst } from '../brief/ast.js';
import { compile } from '../brief/compile.js';
import { resolve } from '../brief/resolve.js';
import { formatCatalogue } from '../config/formats.js';
import { sourceRange } from '../source/range.js';
import { type BrandKit, noBrandKit } from './brand.js';
import {
  type ConfiguredTemplate,
  type ResolveConfigurationsInput,
  resolveTemplateConfigurations,
} from './configurations.js';
import { type TemplateContext, defineTemplate } from './define.js';
import { type TemplateManifest, parseManifest } from './manifest.js';
import { frame } from './nodes.js';
import type { TemplateRegistry } from './registry.js';

/**
 * A configuration picks its brand, and `compile` hands the template that brand's kit
 * (ADR 0155): the configuration's own, else its `default`'s, else the manifest's.
 */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const TABELA = manifestOf(
  'name: tabela\nversion: 1.0.0\nbrand: roxo\nformats: [feed]\nslots: {}\n',
);

function registryOf(...manifests: TemplateManifest[]): TemplateRegistry {
  return {
    list: () => manifests,
    get: (name) => manifests.find((manifest) => manifest.name === name),
    formatsOf: (name) => manifests.find((manifest) => manifest.name === name)?.formats,
    directoryOf: () => undefined,
    failures: [],
  };
}

const at = (start: number) => sourceRange(start, start + 1);

const ROXO_KIT: BrandKit = { signature: '@roxo', colors: { accent: '#5900a6' } };
const AZUL_KIT: BrandKit = { signature: '@azul', colors: { accent: '#009fe3' } };
const KITS = new Map([
  ['roxo', ROXO_KIT],
  ['azul', AZUL_KIT],
]);

function entry(overrides: Partial<ConfiguredTemplate> = {}): ConfiguredTemplate {
  return {
    template: 'tabela',
    file: 'tabelas.yaml',
    directory: '/w/.tyto/plugin-files',
    default: 'roxo',
    configurations: [
      { name: 'roxo', values: {}, brand: { value: 'roxo', range: at(10) } },
      { name: 'azul', values: {}, brand: { value: 'azul', range: at(20) } },
      { name: 'compacta', values: {} },
      { name: 'torta', values: {}, brand: { value: 'Azul!', range: at(30) } },
    ],
    ...overrides,
  };
}

async function resolved(overrides: Partial<ResolveConfigurationsInput> = {}) {
  return resolveTemplateConfigurations({
    project: [entry()],
    machine: [],
    registry: registryOf(TABELA),
    images: () => Promise.resolve({ problem: 'no images here' }),
    ...overrides,
  });
}

describe('a configuration’s brand', () => {
  it('is its own, else its default’s, and a misspelt one is a warning at its key', async () => {
    const { configurations, diagnostics } = await resolved();

    expect(configurations.select('tabela-azul')?.brand).toBe('azul');
    expect(configurations.select('tabela')?.brand).toBe('roxo');
    expect(configurations.select('tabela-compacta')?.brand).toBe('roxo');
    expect(configurations.select('tabela-torta')?.brand).toBe('roxo');
    expect(
      diagnostics.map(({ file, diagnostic }) => [file, diagnostic.code, diagnostic.range]),
    ).toEqual([['tabelas.yaml', 'W_CONFIGURATION_BRAND_INVALID', at(30)]]);
  });

  it('is absent when neither the configuration nor its default names one', async () => {
    const { default: _, ...withoutDefault } = entry({
      configurations: [{ name: 'compacta', values: {} }],
    });
    const { configurations } = await resolved({ project: [withoutDefault] });

    expect(configurations.select('tabela-compacta')).not.toHaveProperty('brand');
  });

  it('warns once at its key when no installed kit offers it, and never for the manifest’s', async () => {
    const { diagnostics } = await resolved({
      project: [entry({ configurations: entry().configurations.slice(0, 3) })],
      kitBrands: new Set(['roxo']),
    });

    expect(diagnostics.map(({ diagnostic }) => [diagnostic.code, diagnostic.range])).toEqual([
      ['W_BRAND_KIT_MISSING', at(20)],
    ]);
    expect(diagnostics[0]?.diagnostic.message).toContain("'tabela-azul'");
  });

  it('says nothing about kits when the app does not tell which are installed', async () => {
    const { diagnostics } = await resolved({
      project: [entry({ configurations: entry().configurations.slice(0, 3) })],
    });

    expect(diagnostics).toEqual([]);
  });
});

describe('a brief that reaches a configuration with a brand', () => {
  const FORMATS = formatCatalogue({ feed: { w: 100, h: 100 } });

  async function kitDrawnFor(name: string, kits: ReadonlyMap<string, BrandKit> = KITS) {
    const { configurations } = await resolved();
    const ast: BriefAst = {
      frontmatter: { data: { template: name }, ranges: {}, range: sourceRange(0, 20) },
      directives: [],
      range: sourceRange(0, 20),
    };
    const brief = await resolve(ast, {
      registry: registryOf(TABELA),
      assets: { base: '', resolve: () => Promise.resolve(undefined) },
      configurations,
    });
    if (!brief.ok) throw new Error(brief.error.map((item) => item.message).join('; '));
    const contexts: TemplateContext[] = [];
    const template = defineTemplate(TABELA, (context) => {
      contexts.push(context);
      return frame({ format: context.format, size: context.size, idPrefix: context.idPrefix });
    });
    compile(brief.value, template, { formats: FORMATS, brandKits: kits });
    return contexts[0]?.brand;
  }

  it('is handed that brand’s kit, logo, signature and colours at once', async () => {
    expect(await kitDrawnFor('tabela-azul')).toBe(AZUL_KIT);
    expect(await kitDrawnFor('tabela')).toBe(ROXO_KIT);
  });

  it('is handed the empty kit when nobody installed that brand’s, never another brand’s', async () => {
    expect(await kitDrawnFor('tabela-azul', new Map([['roxo', ROXO_KIT]]))).toBe(noBrandKit);
  });
});
