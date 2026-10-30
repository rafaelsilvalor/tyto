import { describe, expect, it } from 'vitest';

import {
  type PluginFilesCopy,
  chooseCopies,
  configuredTemplates,
  folderSources,
  parsePluginFile,
  parsePluginFilesLock,
  planPluginSync,
  serializePluginFilesLock,
} from './plugin-files.js';

/**
 * Plugin files, read from strings (ADR 0151 decision 2, TYTO-432). The disk and `git` are
 * `@tyto/io`'s and the CLI's tests'; what is here is what a file, a lock and two folders mean.
 */

const ADR_EXAMPLE = `version: 1
templates:
  tabela:
    source:
      git: https://github.com/rafaelsilvalor/tyto-template-tabela.git
      ref: v1.0.0
    default: roxo
    configurations:
      roxo:
        alias: tabela-roxo
        values:
          background: '#4b2a7b'
          logo: ./images/logo-light.png
  simulados-semana:
    source:
      git: https://git.example.com/templates/tyto-template-simulados-semana.git
      ref: 9c1e5f0a7d3b2c4e6f8a0b1c2d3e4f5a6b7c8d9e
    configurations:
      compacta:
        alias: simulados-compacto
        values:
          title-face: { family: Source Sans 3, weight: 700 }
        brief:
          formats: [story]
`;

const codes = (read: { diagnostics: readonly { code: string }[] }): string[] =>
  read.diagnostics.map((item) => item.code);

describe('a plugin file', () => {
  it("reads the ADR's example whole, configurations kept as written", () => {
    const read = parsePluginFile(ADR_EXAMPLE, 'tabelas.yaml');

    expect(read.diagnostics).toEqual([]);
    expect(read.value?.templates.map((template) => template.name)).toEqual([
      'tabela',
      'simulados-semana',
    ]);
    const [tabela] = read.value?.templates ?? [];
    expect(tabela?.source).toEqual({
      git: 'https://github.com/rafaelsilvalor/tyto-template-tabela.git',
      ref: 'v1.0.0',
    });
    expect(tabela?.default).toBe('roxo');
    const roxo = tabela?.configurations.roxo;
    const at = (range: { start: number; end: number } | undefined): string | undefined =>
      range === undefined ? undefined : ADR_EXAMPLE.slice(range.start, range.end);
    expect(roxo?.alias).toBe('tabela-roxo');
    expect(at(roxo?.aliasRange)).toBe('tabela-roxo');
    expect(at(roxo?.range)).toBe('roxo');
    // The entry's own name, where a warning about the whole entry points (TYTO-462).
    expect(at(tabela?.range)).toBe('tabela');
    expect(roxo?.brief).toEqual({});
    // Each value keeps where it was written, so a refused one is a warning at it.
    expect(roxo?.values.background?.value).toBe('#4b2a7b');
    expect(at(roxo?.values.background?.range)).toBe("'#4b2a7b'");
    expect(roxo?.values.logo?.value).toBe('./images/logo-light.png');
    const [, simulados] = read.value?.templates ?? [];
    expect(simulados?.configurations.compacta?.values['title-face']?.value).toEqual({
      family: 'Source Sans 3',
      weight: 700,
    });
  });

  it('hands a folder its configured templates, leaving out a template two files name', () => {
    const one = parsePluginFile(ADR_EXAMPLE, 'one.yaml').value;
    const other = parsePluginFile(
      'version: 1\ntemplates:\n  tabela:\n    source: { git: ./t, ref: v2 }\n',
      'other.yaml',
    ).value;
    if (one === undefined || other === undefined) throw new Error('unread');

    const configured = configuredTemplates([one, other], '/work/.tyto/plugin-files');

    expect(configured.map((entry) => entry.template)).toEqual(['simulados-semana']);
    expect(configured[0]).toMatchObject({
      file: 'one.yaml',
      directory: '/work/.tyto/plugin-files',
      configurations: [{ name: 'compacta', alias: 'simulados-compacto' }],
    });
    expect(configuredTemplates([one], '/w')[0]).toMatchObject({
      template: 'tabela',
      default: 'roxo',
      range: one.templates[0]?.range,
    });
  });

  it('reads a file that holds one plugin', () => {
    const read = parsePluginFile(
      'version: 1\nplugin:\n  source: { git: ./tyto-plugin-x, ref: main }\n',
      'x.yaml',
    );

    expect(read.diagnostics).toEqual([]);
    expect(read.value?.plugin).toEqual({ source: { git: './tyto-plugin-x', ref: 'main' } });
  });

  it('refuses one entry at its range and keeps the others', () => {
    const source =
      'version: 1\ntemplates:\n  a:\n    source: { git: ./a }\n  b:\n    source: { git: ./b, ref: v1 }\n';
    const read = parsePluginFile(source, 'two.yaml');

    expect(codes(read)).toEqual(['E_PLUGIN_FILE_ENTRY']);
    expect(read.diagnostics[0]?.message).toContain("'templates.a.source.ref'");
    expect(read.diagnostics[0]?.range).toBeDefined();
    expect(read.value?.templates.map((template) => template.name)).toEqual(['b']);
  });

  it('refuses an entry that configures a template without fetching it', () => {
    // So every configuration names the plugin it was written for, and binds to its template
    // rather than to a built-in or a folder template of the same name (TYTO-462).
    const read = parsePluginFile(
      'version: 1\ntemplates:\n  tabela-nova:\n    configurations: { escura: { values: {} } }\n',
      'built-in.yaml',
    );

    expect(codes(read)).toEqual(['E_PLUGIN_FILE_ENTRY']);
    expect(read.diagnostics[0]?.message).toContain("'templates.tabela-nova.source'");
    expect(read.value?.templates).toEqual([]);
  });

  it('warns on an unknown key and loads the entry anyway', () => {
    const read = parsePluginFile(
      'version: 1\ntemplates:\n  a:\n    source: { git: ./a, ref: v1 }\n    colour: red\n',
      'a.yaml',
    );

    expect(codes(read)).toEqual(['W_PLUGIN_FILE_KEY_UNKNOWN']);
    expect(read.value?.templates).toHaveLength(1);
  });

  it('keeps a configuration’s brand as written, where it was written, for core to check', () => {
    const source = `version: 1
templates:
  tabela:
    source: { git: ./t, ref: v1 }
    configurations:
      azul:
        brand: azul
      torta:
        brand: [x]
`;
    const read = parsePluginFile(source, 'tabelas.yaml');

    expect(read.diagnostics).toEqual([]);
    const azul = read.value?.templates[0]?.configurations.azul?.brand;
    expect(azul?.value).toBe('azul');
    expect(source.slice(azul?.range?.start, azul?.range?.end)).toBe('azul');
    expect(read.value?.templates[0]?.configurations.torta?.brand?.value).toEqual(['x']);
    expect(
      configuredTemplates(read.value ? [read.value] : [], '/w')[0]?.configurations[0]?.brand?.value,
    ).toBe('azul');
  });

  it('keeps a configuration’s formats item by item, where each was written (ADR 0155)', () => {
    const source = `version: 1
templates:
  simulados:
    source: { git: ./s, ref: v1 }
    configurations:
      roxo:
        formats: [story, reel]
      ocre:
        formats: story
`;
    const read = parsePluginFile(source, 'simulados.yaml');

    expect(read.diagnostics).toEqual([]);
    const roxo = read.value?.templates[0]?.configurations.roxo?.formats;
    expect(roxo?.value).toEqual(['story', 'reel']);
    expect(roxo?.entries?.map((item) => source.slice(item.range?.start, item.range?.end))).toEqual([
      'story',
      'reel',
    ]);
    const ocre = read.value?.templates[0]?.configurations.ocre?.formats;
    expect(ocre).not.toHaveProperty('entries');
    expect(ocre?.value).toBe('story');
    expect(
      configuredTemplates(read.value ? [read.value] : [], '/w')[0]?.configurations[0]?.formats
        ?.value,
    ).toEqual(['story', 'reel']);
  });

  it('keeps the brief block’s four parts, each where it was written, and warns on a fifth', () => {
    const source = `version: 1
templates:
  semana:
    source: { git: ./semana, ref: v1 }
    configurations:
      roxo:
        brief:
          slots:
            rodape: Inscrições abertas
            selo: ./images/selo.png
          formats: [story, feed]
          skeleton: |
            ---
            template: semana-roxo
            ---
          editor:
            titulo: { max: 40, min: 2 }
            linha: { max: 3 }
          colors: nope
`;
    const read = parsePluginFile(source, 'semana.yaml');
    const at = (range: { start: number; end: number } | undefined): string | undefined =>
      range === undefined ? undefined : source.slice(range.start, range.end);

    expect(codes(read)).toEqual(['W_PLUGIN_FILE_KEY_UNKNOWN', 'W_PLUGIN_FILE_KEY_UNKNOWN']);
    expect(read.diagnostics.map((item) => item.message).join('\n')).toContain(
      'templates.semana.configurations.roxo.brief.editor.titulo.min',
    );
    const brief = read.value?.templates[0]?.configurations.roxo?.brief;
    expect(brief?.slots?.rodape?.value).toBe('Inscrições abertas');
    expect(at(brief?.slots?.selo?.range)).toBe('./images/selo.png');
    expect(brief?.formats?.value).toEqual(['story', 'feed']);
    expect(at(brief?.formats?.range)).toBe('[story, feed]');
    expect(brief?.skeleton?.value).toBe('---\ntemplate: semana-roxo\n---\n');
    expect(brief?.editor?.titulo?.max?.value).toBe(40);
    expect(at(brief?.editor?.titulo?.max?.range)).toBe('40');
    expect(brief?.editor?.linha?.max?.value).toBe(3);
    // Handed on whole to what `@tyto/core` resolves.
    expect(
      configuredTemplates(read.value ? [read.value] : [], '/w')[0]?.configurations[0]?.brief,
    ).toBe(brief);
  });

  it('refuses a configuration whose brief block is not a mapping', () => {
    const read = parsePluginFile(
      'version: 1\ntemplates:\n  a:\n    source: { git: ./a, ref: v1 }\n    configurations:\n      x:\n        brief: [slots]\n',
      'a.yaml',
    );

    expect(codes(read)).toEqual(['E_PLUGIN_FILE_ENTRY']);
    expect(read.value?.templates).toEqual([]);
  });

  it('refuses a git or a ref that git would read as an option', () => {
    const read = parsePluginFile(
      'version: 1\ntemplates:\n  a:\n    source: { git: --upload-pack=evil, ref: v1 }\n  b:\n    source: { git: ./b, ref: -v }\n',
      'a.yaml',
    );

    expect(codes(read)).toEqual(['E_PLUGIN_FILE_ENTRY', 'E_PLUGIN_FILE_ENTRY']);
    expect(read.value?.templates).toEqual([]);
  });

  it('refuses a default that names no configuration of the entry', () => {
    const read = parsePluginFile(
      'version: 1\ntemplates:\n  a:\n    source: { git: ./a, ref: v1 }\n    default: roxo\n',
      'a.yaml',
    );

    expect(codes(read)).toEqual(['E_PLUGIN_FILE_ENTRY']);
  });

  it.each([
    ['not YAML', 'version: 1\ntemplates: [\n'],
    ['another version', 'version: 2\ntemplates: {}\n'],
    ['both kinds', 'version: 1\ntemplates: {}\nplugin: { source: { git: ./a, ref: v1 } }\n'],
    ['neither kind', 'version: 1\n'],
  ])('loads nothing from a file that is %s, and names it', (_, source) => {
    const read = parsePluginFile(source, 'bad.yaml');

    expect(read.value).toBeUndefined();
    expect(codes(read)).toEqual(['E_PLUGIN_FILE_SYNTAX']);
    expect(read.diagnostics[0]?.message).toContain("'bad.yaml'");
  });
});

describe('the lock', () => {
  const commit = 'a'.repeat(40);

  it('round-trips, sorted so the same pins are the same bytes', () => {
    const lock = {
      sources: [
        { git: 'b', ref: 'v1', commit, plugin: 'b' },
        { git: 'a', ref: 'main', commit, plugin: 'a' },
      ],
    };
    const text = serializePluginFilesLock(lock);
    const read = parsePluginFilesLock(text, 'plugin-files.lock.json');

    expect(read.ok && read.value.sources.map((entry) => entry.git)).toEqual(['a', 'b']);
    expect(serializePluginFilesLock(read.ok ? read.value : lock)).toBe(text);
  });

  it('refuses a commit that is not a full hash', () => {
    const read = parsePluginFilesLock(
      JSON.stringify({
        version: 1,
        sources: [{ git: 'a', ref: 'v1', commit: 'abc', plugin: 'a' }],
      }),
      'plugin-files.lock.json',
    );

    expect(read.ok).toBe(false);
  });
});

describe("one folder's sources", () => {
  const file = (name: string, body: string) => {
    const read = parsePluginFile(`version: 1\n${body}`, name);
    if (read.value === undefined) throw new Error('fixture does not parse');
    return read.value;
  };

  it('shares one fetch between templates of one source', () => {
    const named = folderSources([
      file(
        'a.yaml',
        'templates:\n  x:\n    source: { git: ./pack, ref: v1 }\n  y:\n    source: { git: ./pack, ref: v1 }\n',
      ),
    ]);

    expect(named.sources).toEqual([
      { git: './pack', ref: 'v1', file: 'a.yaml', templates: ['x', 'y'], wholePlugin: false },
    ]);
  });

  it('supplies a template two files name from neither', () => {
    const named = folderSources([
      file('a.yaml', 'templates:\n  x:\n    source: { git: ./a, ref: v1 }\n'),
      file('b.yaml', 'templates:\n  x:\n    source: { git: ./b, ref: v1 }\n'),
    ]);

    expect(codes(named)).toEqual(['E_PLUGIN_FILE_DUPLICATE']);
    expect(named.sources).toEqual([]);
  });

  it('resolves only what the lock lacks, and everything on the update', () => {
    const named = folderSources([
      file(
        'a.yaml',
        'templates:\n  x:\n    source: { git: ./a, ref: main }\n  y:\n    source: { git: ./b, ref: main }\n',
      ),
    ]);
    const lock = { sources: [{ git: './a', ref: 'main', commit: 'a'.repeat(40), plugin: 'a' }] };

    expect(planPluginSync(named.sources, lock, false).map((step) => step.resolve)).toEqual([
      false,
      true,
    ]);
    expect(planPluginSync(named.sources, lock, true).map((step) => step.resolve)).toEqual([
      true,
      true,
    ]);
  });

  it('resolves again a source whose ref changed in the file', () => {
    const named = folderSources([
      file('a.yaml', 'templates:\n  x:\n    source: { git: ./a, ref: v2 }\n'),
    ]);
    const lock = { sources: [{ git: './a', ref: 'v1', commit: 'a'.repeat(40), plugin: 'a' }] };

    expect(planPluginSync(named.sources, lock, false)).toEqual([
      expect.objectContaining({ resolve: true }),
    ]);
  });
});

describe('the project and the machine', () => {
  const copy = (fields: Partial<PluginFilesCopy>): PluginFilesCopy => ({
    plugin: 'p',
    file: 'f.yaml',
    git: './p',
    ref: 'v1',
    commit: 'a'.repeat(40),
    templates: [],
    wholePlugin: false,
    ...fields,
  });

  it("lets the project's plugin win, and says which files", () => {
    const chosen = chooseCopies(
      [copy({ file: 'project.yaml', commit: 'b'.repeat(40), templates: ['x'] })],
      [copy({ file: 'machine.yaml', templates: ['x'] })],
    );

    expect(chosen.copies.map((item) => item.file)).toEqual(['project.yaml']);
    expect(codes(chosen)).toEqual(['W_PLUGIN_FILE_OVERRIDDEN']);
    expect(chosen.diagnostics[0]?.message).toContain("'project.yaml'");
    expect(chosen.diagnostics[0]?.message).toContain("'machine.yaml'");
  });

  it('drops a template the project names from a machine copy, and the copy when nothing is left', () => {
    const chosen = chooseCopies(
      [copy({ plugin: 'q', git: './q', file: 'project.yaml', templates: ['x'] })],
      [copy({ file: 'machine.yaml', templates: ['x'] })],
    );

    expect(chosen.copies.map((item) => item.plugin)).toEqual(['q']);
    expect(codes(chosen)).toEqual(['W_PLUGIN_FILE_OVERRIDDEN']);
  });

  it('supplies a plugin two sources of one folder turn out to be from neither', () => {
    const chosen = chooseCopies(
      [],
      [copy({ git: './a', file: 'a.yaml' }), copy({ git: './b', file: 'b.yaml' })],
    );

    expect(chosen.copies).toEqual([]);
    expect(codes(chosen)).toEqual(['E_PLUGIN_FILE_DUPLICATE']);
  });
});
