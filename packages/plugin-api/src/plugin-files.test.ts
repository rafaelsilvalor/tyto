import { describe, expect, it } from 'vitest';

import {
  type PluginFilesCopy,
  chooseCopies,
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
    expect(tabela?.configurations.roxo).toEqual({
      alias: 'tabela-roxo',
      values: { background: '#4b2a7b', logo: './images/logo-light.png' },
      brief: {},
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

  it('warns on an unknown key and loads the entry anyway', () => {
    const read = parsePluginFile(
      'version: 1\ntemplates:\n  a:\n    source: { git: ./a, ref: v1 }\n    colour: red\n',
      'a.yaml',
    );

    expect(codes(read)).toEqual(['W_PLUGIN_FILE_KEY_UNKNOWN']);
    expect(read.value?.templates).toHaveLength(1);
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
