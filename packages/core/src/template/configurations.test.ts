import { describe, expect, it } from 'vitest';

import type { BriefAst } from '../brief/ast.js';
import { compile } from '../brief/compile.js';
import { resolve } from '../brief/resolve.js';
import { formatCatalogue } from '../config/formats.js';
import { sourceRange } from '../source/range.js';
import {
  type ConfigurationImageResolver,
  type ConfiguredTemplate,
  type ResolveConfigurationsInput,
  resolveTemplateConfigurations,
} from './configurations.js';
import { type TemplateContext, defineTemplate } from './define.js';
import { type TemplateManifest, parseManifest } from './manifest.js';
import { frame } from './nodes.js';
import type { TemplateRegistry } from './registry.js';

/**
 * Plugin files' configurations and aliases, resolved (TYTO-439, ADR 0151): which name reaches
 * which template with which values, and what is refused, at which range, in which file.
 */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const TABELA = manifestOf(`name: tabela
version: 1.0.0
formats: [feed]
slots: {}
values:
  paper: { type: color, default: '#fbfbfb' }
  gap: { type: length, default: 20, min: 0, max: 120 }
  logo: { type: image }
`);

const BUILT_IN = manifestOf('name: tabela-roxo\nversion: 1.0.0\nformats: [feed]\nslots: {}\n');

function registryOf(...manifests: TemplateManifest[]): TemplateRegistry {
  return {
    list: () => manifests,
    get: (name) => manifests.find((manifest) => manifest.name === name),
    formatsOf: (name) => manifests.find((manifest) => manifest.name === name)?.formats,
    directoryOf: () => undefined,
    failures: [],
  };
}

const LOGO = { id: 'images/logo.png', source: 'file', path: '/w/logo.png', hash: 'h' } as const;

/** Answers `./logo.png` and remembers where each path was asked from. */
function imagesOf(asked: string[] = []): ConfigurationImageResolver {
  return (path, { directory, scope }) => {
    asked.push(`${scope}:${directory}:${path}`);
    return Promise.resolve(
      path === './logo.png' ? { ref: LOGO } : { problem: `names '${path}', which is not there` },
    );
  };
}

const at = (start: number) => sourceRange(start, start + 1);

function entry(overrides: Partial<ConfiguredTemplate> = {}): ConfiguredTemplate {
  return {
    template: 'tabela',
    file: 'tabelas.yaml',
    directory: '/w/.tyto/plugin-files',
    default: 'roxo',
    configurations: [
      {
        name: 'roxo',
        alias: 'tabela-roxa',
        aliasRange: at(10),
        values: { paper: { value: '#4b2a7b', range: at(20) }, gap: { value: '30px' } },
      },
      { name: 'compacta', values: { gap: { value: 8, range: at(30) } } },
    ],
    ...overrides,
  };
}

async function resolved(overrides: Partial<ResolveConfigurationsInput> = {}) {
  return resolveTemplateConfigurations({
    project: [entry()],
    machine: [],
    registry: registryOf(TABELA),
    images: imagesOf(),
    ...overrides,
  });
}

const codes = (result: Awaited<ReturnType<typeof resolved>>) =>
  result.diagnostics.map(({ diagnostic }) => diagnostic.code);

describe('a configuration and its alias', () => {
  it('reaches a configuration by its alias, and the default by the template’s own name', async () => {
    const { configurations, diagnostics } = await resolved();

    expect(diagnostics).toEqual([]);
    expect(configurations.select('tabela-roxa')).toEqual({
      template: 'tabela',
      configuration: 'roxo',
      values: { paper: { value: '#4b2a7b', range: at(20) }, gap: { value: 30 } },
    });
    expect(configurations.select('tabela')?.configuration).toBe('roxo');
  });

  it('names an alias the file left out <template>-<configuration>', async () => {
    const { configurations } = await resolved();

    expect(configurations.select('tabela-compacta')?.configuration).toBe('compacta');
    expect(configurations.aliases().map((alias) => alias.alias)).toEqual([
      'tabela-compacta',
      'tabela-roxa',
    ]);
  });

  it('starts a named configuration from the default and changes what it lists', async () => {
    const { configurations } = await resolved();

    expect(configurations.select('tabela-compacta')?.values).toEqual({
      paper: { value: '#4b2a7b', range: at(20) },
      gap: { value: 8, range: at(30) },
    });
  });

  it('renders the bare name with the template’s own defaults when the entry names no default', async () => {
    const { default: _default, ...withoutDefault } = entry();
    const { configurations } = await resolved({ project: [withoutDefault] });

    expect(configurations.select('tabela')).toEqual({ template: 'tabela', values: {} });
    expect(configurations.select('tabela-compacta')?.values).toEqual({
      gap: { value: 8, range: at(30) },
    });
  });

  it('configures nothing for a template that did not load', async () => {
    const { configurations, diagnostics } = await resolved({ registry: registryOf() });

    expect(configurations.select('tabela-roxa')).toBeUndefined();
    expect(configurations.aliases()).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

describe('values, checked once against what the template declared', () => {
  it('warns at a value the template does not declare, or cannot take, in the file that wrote it', async () => {
    const { configurations, diagnostics } = await resolved({
      project: [
        entry({
          configurations: [
            {
              name: 'roxo',
              values: {
                ink: { value: '#000000', range: at(40) },
                gap: { value: 500, range: at(50) },
                paper: { value: '#111111' },
              },
            },
          ],
        }),
      ],
    });

    expect(
      diagnostics.map(({ file, diagnostic }) => [file, diagnostic.code, diagnostic.range]),
    ).toEqual([
      ['tabelas.yaml', 'W_TEMPLATE_VALUE_UNKNOWN', at(40)],
      ['tabelas.yaml', 'W_TEMPLATE_VALUE_INVALID', at(50)],
    ]);
    expect(configurations.select('tabela')?.values).toEqual({ paper: { value: '#111111' } });
  });

  it('reads an image relative to the file’s folder, through the app’s port', async () => {
    const asked: string[] = [];
    const { configurations, diagnostics } = await resolved({
      images: imagesOf(asked),
      machine: [
        entry({
          template: 'tabela',
          directory: '/home/.tyto/plugin-files',
          configurations: [{ name: 'roxo', values: { logo: { value: './logo.png' } } }],
        }),
      ],
      project: [],
    });

    expect(diagnostics).toEqual([]);
    expect(asked).toEqual(['machine:/home/.tyto/plugin-files:./logo.png']);
    expect(configurations.select('tabela')?.values).toEqual({ logo: { value: LOGO } });
  });

  it('warns at an image the port could not read, and leaves it out', async () => {
    const { configurations, diagnostics } = await resolved({
      project: [
        entry({
          configurations: [
            { name: 'roxo', values: { logo: { value: '../../secret.png', range: at(60) } } },
          ],
        }),
      ],
    });

    expect(diagnostics[0]?.diagnostic.message).toContain("'../../secret.png'");
    expect(diagnostics[0]?.diagnostic.range).toEqual(at(60));
    expect(configurations.select('tabela')?.values).toEqual({});
  });
});

describe('collisions, decided and never by load order (ADR 0151 decision 7)', () => {
  it('refuses an alias that is a template’s name, at the alias, and the template keeps it', async () => {
    const { configurations, diagnostics } = await resolved({
      registry: registryOf(TABELA, BUILT_IN),
      project: [
        entry({
          configurations: [{ name: 'roxo', alias: 'tabela-roxo', aliasRange: at(70), values: {} }],
        }),
      ],
    });

    expect(
      diagnostics.map(({ file, diagnostic }) => [file, diagnostic.code, diagnostic.range]),
    ).toEqual([['tabelas.yaml', 'E_TEMPLATE_ALIAS_TAKEN', at(70)]]);
    expect(configurations.select('tabela-roxo')).toBeUndefined();
  });

  it('supplies an alias two files of one folder give from neither', async () => {
    const { configurations, diagnostics } = await resolved({
      registry: registryOf(
        TABELA,
        manifestOf('name: cartao\nversion: 1.0.0\nformats: [feed]\nslots: {}\n'),
      ),
      project: [
        entry(),
        {
          template: 'cartao',
          file: 'cartoes.yaml',
          directory: '/w/.tyto/plugin-files',
          configurations: [{ name: 'x', alias: 'tabela-roxa', aliasRange: at(80), values: {} }],
        },
      ],
    });

    expect(codes({ configurations, diagnostics })).toEqual(['E_PLUGIN_FILE_DUPLICATE']);
    expect(diagnostics[0]?.file).toBe('cartoes.yaml');
    expect(configurations.select('tabela-roxa')).toBeUndefined();
  });

  it('lets the project’s alias win the machine’s, and says so', async () => {
    const cartao = manifestOf('name: cartao\nversion: 1.0.0\nformats: [feed]\nslots: {}\n');
    const { configurations, diagnostics } = await resolved({
      registry: registryOf(TABELA, cartao),
      machine: [
        {
          template: 'cartao',
          file: 'machine.yaml',
          directory: '/home/.tyto/plugin-files',
          configurations: [{ name: 'x', alias: 'tabela-roxa', values: {} }],
        },
      ],
    });

    expect(codes({ configurations, diagnostics })).toEqual(['W_PLUGIN_FILE_OVERRIDDEN']);
    expect(configurations.select('tabela-roxa')?.template).toBe('tabela');
  });

  it('replaces the machine’s entry for a template whole with the project’s', async () => {
    const { configurations, diagnostics } = await resolved({
      machine: [
        entry({
          file: 'machine.yaml',
          configurations: [{ name: 'vinho', values: { paper: { value: '#550000' } } }],
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(configurations.select('tabela-vinho')).toBeUndefined();
    expect(configurations.select('tabela')?.configuration).toBe('roxo');
  });
});

describe('a brief that names an alias', () => {
  const FORMATS = formatCatalogue({ feed: { w: 100, h: 100 } });

  async function render(name: string, supplied?: Record<string, { value: unknown }>) {
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
    if (!brief.ok) return { brief, contexts: [] };
    const contexts: TemplateContext[] = [];
    const template = defineTemplate(TABELA, (context) => {
      contexts.push(context);
      return frame({ format: context.format, size: context.size, idPrefix: context.idPrefix });
    });
    compile(brief.value, template, {
      formats: FORMATS,
      ...(supplied === undefined ? {} : { values: supplied }),
    });
    return { brief, contexts };
  }

  it('renders the template with that configuration, the brief not knowing it is a variant', async () => {
    const { brief, contexts } = await render('tabela-compacta');

    expect(brief.ok && brief.value.template).toBe('tabela');
    expect(brief.ok && brief.value.configuration).toBe('compacta');
    expect(contexts[0]?.values).toEqual({ paper: '#4b2a7b', gap: 8 });
  });

  it('lays what the caller supplies over the file, value by value', async () => {
    const { contexts } = await render('tabela-compacta', { gap: { value: 12 } });

    expect(contexts[0]?.values).toEqual({ paper: '#4b2a7b', gap: 12 });
  });

  it('lists the aliases beside the templates when a name is unknown', async () => {
    const { brief } = await render('tabela-roxx');

    expect(brief.ok ? '' : brief.error[0]?.message).toContain(
      'tabela, tabela-compacta, tabela-roxa',
    );
    expect(brief.ok ? undefined : brief.error[0]?.hint).toBe("Did you mean 'tabela-roxa'?");
  });
});
