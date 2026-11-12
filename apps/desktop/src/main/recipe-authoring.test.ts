import { GENERIC_VERB_FORMS, recipeSkeleton, vocabularySkeleton } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import { parseIpc } from '../../shared/ipc.js';
import {
  seedOf,
  verbCatalog,
  vocabularyComplete,
  vocabularyHover,
  vocabularyLint,
  vocabularyPointers,
} from './recipe-authoring.js';

/**
 * TYTO-402, ADR 0176: what New recipe and New vocabulary write, and the vocabulary tab's lint,
 * completion and hover, as main answers them.
 */

const vocabulary = (value: unknown): string => JSON.stringify(value, null, 2);

/** Each problem's code and the characters of the file its range covers. */
function marked(text: string): (readonly [string, string])[] {
  return vocabularyLint(text).diagnostics.map(
    (item) => [item.code, text.slice(item.range?.start ?? 0, item.range?.end ?? 0)] as const,
  );
}

describe('a seeded new file', () => {
  it("writes a recipe's skeleton under the name typed, adding .recipe", () => {
    const skeleton = recipeSkeleton('semanal');
    expect(skeleton.ok).toBe(true);
    expect(seedOf('semanal', 'recipe')).toEqual({
      ok: true,
      name: 'semanal.recipe',
      text: skeleton.ok ? skeleton.value : '',
    });
    expect(seedOf('Semanal.RECIPE', 'recipe')).toMatchObject({ ok: true, name: 'Semanal.RECIPE' });
  });

  it('refuses a recipe name a run line could not name', () => {
    expect(seedOf('my recipe', 'recipe')).toEqual({ ok: false, reason: 'recipe-name' });
    expect(seedOf('-x.recipe', 'recipe')).toEqual({ ok: false, reason: 'recipe-name' });
  });

  it("writes a vocabulary's skeleton, adding .vocab.json, and it lints clean", () => {
    expect(seedOf('empresa', 'vocabulary')).toEqual({
      ok: true,
      name: 'empresa.vocab.json',
      text: vocabularySkeleton(),
    });
    expect(seedOf('empresa.vocab.json', 'vocabulary')).toMatchObject({
      name: 'empresa.vocab.json',
    });
    expect(vocabularyLint(vocabularySkeleton())).toEqual({ diagnostics: [] });
  });
});

describe('the vocabulary lint', () => {
  it("marks a rule's filter error at the file's characters, past an escaped backslash", () => {
    // The file reads `\\w+`: two characters there, one in the filter, so an offset not mapped
    // through the escape would mark the blank before `=`.
    const text = vocabulary({
      rules: { kinds: [{ when: 'title matches \\w+ AND = 1', set: {} }] },
    });
    expect(marked(text)).toEqual([['E_RECIPE_WHERE', '=']]);
  });

  it('answers within the wire contract, every problem with its range', () => {
    const text = vocabulary({ rules: { kinds: [{ when: '' }] }, lookups: { status: { a: 1 } } });
    const answer = vocabularyLint(text);
    expect(() => parseIpc('vocabulary:lint', 'response', answer)).not.toThrow();
    expect(answer.diagnostics.map((item) => item.code)).toEqual([
      'E_VOCABULARY_SHAPE',
      'E_VOCABULARY_SHAPE',
    ]);
  });
});

describe('the vocabulary completion', () => {
  it('offers the sections not yet written at the top level, inside a key being typed', () => {
    const text = '{\n  "rules": {},\n  ""\n}';
    const position = text.lastIndexOf('""') + 1;
    const { answer } = vocabularyComplete(text, position, false);
    expect(answer?.from).toBe(position);
    expect(answer?.quoted).toBe(true);
    expect(answer?.options.map((option) => option.label)).toEqual(['rewrites', 'lookups']);
    expect(answer?.options[0]).toMatchObject({ insert: '"rewrites": {}', select: [13, 13] });
  });

  it("offers a rule's missing field inside one of a table's entries, the caret in its value", () => {
    const text = '{ "rules": { "kinds": [ { "when": "", "" } ] } }';
    const position = text.lastIndexOf('""') + 1;
    const { answer } = vocabularyComplete(text, position, false);
    expect(answer?.options).toEqual([
      { label: 'set', insert: '"set": {}', select: [8, 8], kind: 'property' },
    ]);
  });

  it("offers a rewrite step's fields, and nothing inside a lookup or a value", () => {
    const steps = '{ "rewrites": { "noise": [ { "" } ] } }';
    expect(
      vocabularyComplete(steps, steps.indexOf('""') + 1, false).answer?.options.map(
        (option) => option.label,
      ),
    ).toEqual(['pattern', 'replace']);
    const lookup = '{ "lookups": { "status": { "" } } }';
    expect(vocabularyComplete(lookup, lookup.indexOf('""') + 1, false).answer).toBeNull();
    const value = '{ "rules": "" }';
    expect(vocabularyComplete(value, value.lastIndexOf('"'), false).answer).toBeNull();
  });
});

describe('the vocabulary hover', () => {
  const text = vocabularySkeleton();

  it('names a section over its key, and a table over its name with how many entries it holds', () => {
    expect(vocabularyHover(text, text.indexOf('"rules"') + 2).answer).toEqual({
      from: text.indexOf('"rules"'),
      to: text.indexOf('"rules"') + '"rules"'.length,
      section: 'rules',
    });
    expect(vocabularyHover(text, text.indexOf('"kinds"') + 2).answer).toEqual({
      from: text.indexOf('"kinds"'),
      to: text.indexOf('"kinds"') + '"kinds"'.length,
      section: 'rules',
      name: 'kinds',
      entries: 2,
    });
  });

  it("says nothing over a value, a rule's own field, or a key of the team's own", () => {
    expect(vocabularyHover(text, text.indexOf('poster') + 1).answer).toBeNull();
    expect(vocabularyHover(text, text.indexOf('"when"') + 2).answer).toBeNull();
    const own = vocabulary({ stopwords: ['a'] });
    expect(vocabularyHover(own, own.indexOf('stopwords')).answer).toBeNull();
  });
});

describe("the step picker's catalog (TYTO-402)", () => {
  const acme = { kind: 'source' as const, arguments: [{ name: 'board', type: 'text' as const }] };

  it('lists generic verbs by their form and plugin verbs by their declared schema', () => {
    const catalog = verbCatalog(['acme.pull', 'param', 'select', 'where'], (name) =>
      name === 'acme.pull' ? acme : undefined,
    );

    expect(catalog.map((entry) => [entry.name, entry.kind])).toEqual([
      ['acme.pull', 'source'],
      ['select', 'transform'],
      ['where', 'transform'],
    ]);
    expect(catalog[0]?.fields).toEqual([
      { name: 'board', kind: 'text', placement: 'named', required: false, help: '' },
    ]);
    expect(catalog[1]?.fields.map((field) => [field.name, field.kind])).toEqual([
      ['columns', 'columns'],
      ['without', 'columns'],
    ]);
    // Every generic verb's form fits the wire.
    const generic = verbCatalog(Object.keys(GENERIC_VERB_FORMS), () => undefined);
    expect(generic).toHaveLength(Object.keys(GENERIC_VERB_FORMS).length);
    expect(() =>
      parseIpc('recipe:verbs', 'response', { verbs: [], catalog: generic }),
    ).not.toThrow();
  });
});

describe('the pointers a recipe may read from a vocabulary (TYTO-402)', () => {
  it("names each section's tables and the team's own keys", () => {
    const text = vocabulary({
      rules: { kinds: [], 'a/b': [] },
      lookups: { status: {} },
      stopwords: ['a'],
    });

    expect(vocabularyPointers(text)).toEqual([
      '/rules/kinds',
      '/rules/a~1b',
      '/lookups/status',
      '/stopwords',
    ]);
  });

  it('still names them in a file with a problem elsewhere', () => {
    expect(vocabularyPointers('{ "rules": { "kinds": [ ] }, "lookups": { "status": ')).toEqual([
      '/rules/kinds',
      '/lookups/status',
    ]);
    expect(vocabularyPointers('not json')).toEqual([]);
  });
});
