import { describe, expect, it } from 'vitest';

import type { BriefAst } from '../brief/ast.js';
import { resolve } from '../brief/resolve.js';
import { sourceRange } from '../source/range.js';
import {
  type ConfiguredTemplate,
  type ResolveConfigurationsInput,
  type TemplateConfigurations,
  resolveTemplateConfigurations,
} from './configurations.js';
import { type TemplateManifest, parseManifest } from './manifest.js';
import type { TemplateRegistry } from './registry.js';

/**
 * A configuration may restrict its formats, which a brief cannot widen (ADR 0155 decision 6):
 * its own list, else its `default`'s, else the manifest's; a brief or a run asking past it is
 * `E_UNKNOWN_FORMAT` under the name the brief wrote.
 */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const SIMULADOS = manifestOf(
  'name: simulados\nversion: 1.0.0\nformats: [grid, story]\nslots: {}\n',
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

function entry(overrides: Partial<ConfiguredTemplate> = {}): ConfiguredTemplate {
  return {
    template: 'simulados',
    file: 'simulados.yaml',
    directory: '/w/.tyto/plugin-files',
    configurations: [
      { name: 'roxo', values: {}, formats: { value: ['story'], range: at(10) } },
      { name: 'ocre', values: {} },
    ],
    ...overrides,
  };
}

async function resolved(overrides: Partial<ResolveConfigurationsInput> = {}) {
  return resolveTemplateConfigurations({
    project: [entry()],
    machine: [],
    registry: registryOf(SIMULADOS),
    images: () => Promise.resolve({ problem: 'no images here' }),
    ...overrides,
  });
}

function problems(diagnostics: Awaited<ReturnType<typeof resolved>>['diagnostics']) {
  return diagnostics.map(({ diagnostic }) => [diagnostic.code, diagnostic.range]);
}

describe('a configuration’s formats', () => {
  it('are its own restriction, and absent when it writes none', async () => {
    const { configurations, diagnostics } = await resolved();

    expect(configurations.select('simulados-roxo')?.formats).toEqual(['story']);
    expect(configurations.select('simulados-ocre')).not.toHaveProperty('formats');
    expect(configurations.select('simulados')).not.toHaveProperty('formats');
    expect(diagnostics).toEqual([]);
  });

  it('are inherited from the entry’s default, as the brand is', async () => {
    const { configurations } = await resolved({ project: [entry({ default: 'roxo' })] });

    expect(configurations.select('simulados')?.formats).toEqual(['story']);
    expect(configurations.select('simulados-ocre')?.formats).toEqual(['story']);
  });

  it('leave out an item the template does not render, with a warning at that item', async () => {
    const { configurations, diagnostics } = await resolved({
      project: [
        entry({
          configurations: [
            {
              name: 'roxo',
              values: {},
              formats: {
                value: ['story', 'reel'],
                range: at(10),
                entries: [
                  { value: 'story', range: at(11) },
                  { value: 'reel', range: at(12) },
                ],
              },
            },
          ],
        }),
      ],
    });

    expect(configurations.select('simulados-roxo')?.formats).toEqual(['story']);
    expect(problems(diagnostics)).toEqual([['W_CONFIGURATION_FORMATS_INVALID', at(12)]]);
    expect(diagnostics[0]?.diagnostic.message).toContain("'reel'");
  });

  it('restrict nothing when nothing is left, or when they are not a list', async () => {
    const { configurations, diagnostics } = await resolved({
      project: [
        entry({
          configurations: [
            { name: 'roxo', values: {}, formats: { value: ['reel'], range: at(10) } },
            { name: 'ocre', values: {}, formats: { value: { a: 1 }, range: at(20) } },
          ],
        }),
      ],
    });

    expect(configurations.select('simulados-roxo')).not.toHaveProperty('formats');
    expect(configurations.select('simulados-ocre')).not.toHaveProperty('formats');
    expect(problems(diagnostics)).toEqual([
      ['W_CONFIGURATION_FORMATS_INVALID', at(10)],
      ['W_CONFIGURATION_FORMATS_INVALID', at(10)],
      ['W_CONFIGURATION_FORMATS_INVALID', at(20)],
    ]);
  });

  it('bound the brief’s default formats, which may only suggest inside them', async () => {
    const { configurations, diagnostics } = await resolved({
      project: [
        entry({
          configurations: [
            {
              name: 'roxo',
              values: {},
              formats: { value: ['story'], range: at(10) },
              brief: { formats: { value: ['grid', 'story'], range: at(30) } },
            },
          ],
        }),
      ],
    });

    expect(configurations.select('simulados-roxo')?.brief?.formats).toEqual(['story']);
    expect(problems(diagnostics)).toEqual([['W_CONFIGURATION_FORMATS_INVALID', at(30)]]);
  });
});

describe('a brief that reaches a restricted configuration', () => {
  async function formatsFor(
    name: string,
    configurations: TemplateConfigurations,
    options: { written?: readonly string[]; requested?: readonly string[] } = {},
  ) {
    const ast: BriefAst = {
      frontmatter: {
        data: {
          template: name,
          ...(options.written === undefined ? {} : { formats: [...options.written] }),
        },
        ranges: options.written === undefined ? {} : { formats: at(5) },
        range: sourceRange(0, 20),
      },
      directives: [],
      range: sourceRange(0, 20),
    };
    const brief = await resolve(ast, {
      registry: registryOf(SIMULADOS),
      assets: { base: '', resolve: () => Promise.resolve(undefined) },
      configurations,
      ...(options.requested === undefined ? {} : { formats: options.requested }),
    });
    return brief.ok
      ? { formats: brief.value.formats, diagnostics: brief.diagnostics }
      : { formats: [], diagnostics: brief.error };
  }

  it('renders story, and is refused grid under the alias it wrote', async () => {
    const { configurations } = await resolved();

    const story = await formatsFor('simulados-roxo', configurations, { written: ['story'] });
    expect(story.formats).toEqual(['story']);
    expect(story.diagnostics).toEqual([]);

    const grid = await formatsFor('simulados-roxo', configurations, { written: ['grid'] });
    expect(grid.formats).toEqual([]);
    expect(grid.diagnostics.map((item) => [item.code, item.message, item.hint])).toEqual([
      [
        'E_UNKNOWN_FORMAT',
        "Format 'grid' is not rendered by template 'simulados-roxo'. It renders: story.",
        "Configuration 'roxo' of template 'simulados' restricts its formats to story.",
      ],
    ]);
  });

  it('meets the same check on a run’s formats, and renders the restriction when none is asked', async () => {
    const { configurations } = await resolved();

    const run = await formatsFor('simulados-roxo', configurations, { requested: ['grid'] });
    expect(run.diagnostics.map((item) => item.code)).toEqual(['E_UNKNOWN_FORMAT']);

    expect((await formatsFor('simulados-roxo', configurations)).formats).toEqual(['story']);
  });

  it('leaves the bare template name and an unrestricted alias rendering grid', async () => {
    const { configurations } = await resolved();

    expect((await formatsFor('simulados', configurations, { written: ['grid'] })).formats).toEqual([
      'grid',
    ]);
    expect((await formatsFor('simulados-ocre', configurations)).formats).toEqual(['grid', 'story']);
  });
});
