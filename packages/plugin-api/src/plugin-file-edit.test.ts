import { describe, expect, it } from 'vitest';

import { addTemplateEntries, moveEntryRef, newPluginFileText } from './plugin-file-edit.js';
import { parsePluginFile } from './plugin-files.js';

/**
 * A file as a person keeps it, with every habit `yaml`'s own `toString` rewrites (measured):
 * extra spaces, two blank lines, a list at its key's indentation, a comment aligned by hand.
 */
const FILE = `# My templates — kept by hand.
version: 1

templates:
  # The pilot.
  tabela:
    source:
      git: 'https://git.example.com/tyto-template-tabela.git' # single quotes, on purpose
      ref: v1.0.0
    default: roxo
    configurations:
      roxo: {alias: tabela-roxo,  values: { background: '#4b2a7b' }}


  agenda:
    source:
      git:   https://git.example.com/tyto-template-agenda.git
      ref: v2.0.0      # pinned, comment aligned by hand
    configurations:
      story:
        brief:
          formats:
          - story
`;

const SOURCE = { git: 'https://git.example.com/tyto-template-concursos.git', ref: 'v1.1.0' };

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('addTemplateEntries', () => {
  it('appends after the last entry and leaves every byte before it as it was', () => {
    const next = value(addTemplateEntries(FILE, 'templates.yaml', ['concursos-abertos'], SOURCE));
    expect(next).toBe(
      `${FILE}  concursos-abertos:
    source:
      git: https://git.example.com/tyto-template-concursos.git
      ref: v1.1.0
`,
    );
    const read = parsePluginFile(next, 'templates.yaml');
    expect(read.diagnostics).toEqual([]);
    expect(read.value?.templates.map((entry) => entry.name)).toEqual([
      'tabela',
      'agenda',
      'concursos-abertos',
    ]);
  });

  it('follows the indentation the file already uses', () => {
    const four =
      'version: 1\ntemplates:\n    agenda:\n        source:\n            git: g\n            ref: v1\n';
    const next = value(addTemplateEntries(four, 'f.yaml', ['tabela'], { git: 'h', ref: 'v2' }));
    expect(next).toBe(
      `${four}    tabela:\n        source:\n            git: h\n            ref: v2\n`,
    );
  });

  it('makes the file when there is none', () => {
    expect(
      value(addTemplateEntries(undefined, 'gallery.yaml', ['a'], { git: 'g', ref: 'v1' })),
    ).toBe('version: 1\ntemplates:\n  a:\n    source:\n      git: g\n      ref: v1\n');
  });

  it('quotes what YAML would otherwise read as something else', () => {
    const next = value(addTemplateEntries(undefined, 'f', ['a'], { git: 'g #1', ref: '1.0' }));
    expect(next).toContain('git: "g #1"\n');
    expect(next).toContain('ref: "1.0"\n');
  });

  it('refuses a name the file already has, an inline mapping and a plugin file', () => {
    expect(addTemplateEntries(FILE, 'f', ['agenda'], SOURCE)).toEqual({
      ok: false,
      error: 'it already has an entry named agenda',
    });
    expect(
      addTemplateEntries(
        'version: 1\ntemplates: { a: { source: { git: g, ref: r } } }\n',
        'f',
        ['b'],
        SOURCE,
      ).ok,
    ).toBe(false);
    expect(addTemplateEntries(newPluginFileText(SOURCE), 'f', ['b'], SOURCE)).toEqual({
      ok: false,
      error: 'it holds a plugin, not templates',
    });
  });
});

describe('moveEntryRef', () => {
  it('replaces the ref and nothing else, comment beside it included', () => {
    const next = value(moveEntryRef(FILE, 'templates.yaml', 'agenda', 'v2.1.0'));
    expect(next).toBe(FILE.replace('ref: v2.0.0      # pinned', 'ref: v2.1.0      # pinned'));
  });

  it('moves the ref of a file that holds a plugin', () => {
    const next = value(moveEntryRef(newPluginFileText(SOURCE), 'p.yaml', undefined, 'v2.0.0'));
    expect(next).toBe(newPluginFileText({ ...SOURCE, ref: 'v2.0.0' }));
  });

  it('refuses an entry the file does not have', () => {
    expect(moveEntryRef(FILE, 'f', 'missing', 'v1').ok).toBe(false);
  });
});
