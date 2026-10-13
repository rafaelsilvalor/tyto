import { describe, expect, it } from 'vitest';

import { readSnippetsText } from './snippets-file.js';

/** `snippets.json` read as text a person wrote (TYTO-277, ADR 0082). */

const slice = (text: string, range?: { start: number; end: number }): string =>
  range === undefined ? '' : text.slice(range.start, range.end);

describe('readSnippetsText', () => {
  it("reads VS Code's shape with comments, a list body and two prefixes", () => {
    const text = [
      '// mine',
      '{',
      '  "Aula": {',
      '    "prefix": ["aula", "au"],',
      '    "body": ["::aula ${1:titulo}", "::prof ${2:nome}"],',
      '    "description": "Uma aula",',
      '  },',
      '  "Dia": { "prefix": "dia", "body": "::dia $1", "template": "agenda-semana" },',
      '}',
    ].join('\n');

    const read = readSnippetsText(text, ['agenda-semana']);

    expect(read.syntax).toEqual([]);
    expect(read.problems).toEqual([]);
    expect(read.snippets).toEqual([
      {
        name: 'Aula',
        prefixes: ['aula', 'au'],
        template: '::aula ${1:titulo}\n::prof ${2:nome}',
        description: 'Uma aula',
      },
      { name: 'Dia', prefixes: ['dia'], template: '::dia ${1}', forTemplate: 'agenda-semana' },
    ]);
  });

  it('reads an empty or blank file as no snippets and no problem', () => {
    expect(readSnippetsText('')).toEqual({ snippets: [], syntax: [], problems: [] });
    expect(readSnippetsText(' \n')).toEqual({ snippets: [], syntax: [], problems: [] });
  });

  it('says a text that does not parse, or is a list, is a syntax error', () => {
    const broken = readSnippetsText('{ "A": { "prefix": "a" "body": "x" } }');
    expect(broken.syntax.map((problem) => problem.code)).toContain('E_SNIPPETS_SYNTAX');
    expect(broken.syntax[0]?.range?.start).toBeGreaterThan(0);

    const list = readSnippetsText('[]');
    expect(list.syntax.map((problem) => problem.message)).toEqual([
      'The snippets file cannot be read here: it is not a map of snippets by name.',
    ]);
  });

  it('leaves a bad entry out with a warning on it, and keeps the others', () => {
    const text =
      '{\n  "Bad": { "prefix": "x y", "body": "a" },\n  "Ok": { "prefix": "ok", "body": "b" }\n}';

    const read = readSnippetsText(text);

    expect(read.snippets.map((entry) => entry.name)).toEqual(['Ok']);
    expect(read.problems.map((problem) => problem.code)).toEqual(['W_SNIPPET_INVALID']);
    expect(slice(text, read.problems[0]?.range)).toBe('"Bad": { "prefix": "x y", "body": "a" }');
  });

  it('refuses a body Tyto cannot translate, on the whole body value', () => {
    const text = '{ "File": { "prefix": "f", "body": ["::titulo $TM_FILENAME"] } }';

    const read = readSnippetsText(text);

    expect(read.snippets).toEqual([]);
    expect(read.problems.map((problem) => problem.message)).toEqual([
      "Snippet 'File' is left out: its body uses the variable $TM_FILENAME, which Tyto does not support.",
    ]);
    expect(slice(text, read.problems[0]?.range)).toBe('["::titulo $TM_FILENAME"]');
  });

  it('keeps a choice as its first option, and a snippet for a template not installed', () => {
    const text =
      '{ "Tom": { "prefix": "tom", "body": "tom ${1|claro,escuro|}", "template": "nenhum" } }';

    const read = readSnippetsText(text, ['agenda-semana']);

    expect(read.snippets.map((entry) => entry.template)).toEqual(['tom ${1:claro}']);
    expect(read.problems.map((problem) => problem.code)).toEqual([
      'W_SNIPPET_CHOICE_FLATTENED',
      'W_SNIPPET_UNKNOWN_TEMPLATE',
    ]);
    expect(slice(text, read.problems[1]?.range)).toBe('"nenhum"');
  });
});
