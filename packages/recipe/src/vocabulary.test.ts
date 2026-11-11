import { describe, expect, it } from 'vitest';

import { lintVocabulary, vocabularySkeleton } from './vocabulary.js';

/** The problems of a text, each with the code and the characters of the file it points at. */
function problemsOf(text: string): readonly (readonly [string, string])[] {
  const linted = lintVocabulary(text);
  if (linted.ok) return [];
  return linted.error.map(
    (problem) =>
      [problem.code, text.slice(problem.range?.start ?? 0, problem.range?.end ?? 0)] as const,
  );
}

const vocabulary = (value: unknown) => JSON.stringify(value, null, 2);

describe('lintVocabulary', () => {
  it('reads the skeleton clean and outlines its sections', () => {
    const linted = lintVocabulary(vocabularySkeleton());
    expect(linted.ok).toBe(true);
    if (!linted.ok) return;
    expect(linted.value.rules.map((entry) => entry.name)).toEqual(['kinds']);
    expect(linted.value.rewrites).toEqual([]);
    expect(linted.value.lookups).toEqual([]);
  });

  it('outlines a key of the team its own', () => {
    const linted = lintVocabulary(vocabulary({ stopwords: ['a', 'the'] }));
    expect(linted.ok && linted.value.other.map((entry) => entry.name)).toEqual(['stopwords']);
  });

  it('reports a syntax error where it is', () => {
    const text = '{ "rules": { "kinds": [ } }';
    expect(problemsOf(text).map(([code]) => code)).toContain('E_VOCABULARY_SYNTAX');
  });

  it('refuses a file that is not an object of sections', () => {
    expect(problemsOf('[1, 2]')).toEqual([['E_VOCABULARY_SYNTAX', '[1, 2]']]);
    expect(problemsOf('   ')).toEqual([['E_VOCABULARY_SYNTAX', '   ']]);
  });

  it("checks a section's entry by the verb's own schema, at the entry", () => {
    const text = vocabulary({ rules: { kinds: [{ when: '' }] }, lookups: { status: { a: 1 } } });
    const linted = lintVocabulary(text);
    expect(linted.ok).toBe(false);
    if (linted.ok) return;
    expect(linted.error.map((problem) => problem.message)).toEqual([
      expect.stringContaining("'/rules/kinds/0/set'"),
      expect.stringContaining("'/lookups/status/a'"),
    ]);
    expect(problemsOf(text).map(([code]) => code)).toEqual([
      'E_VOCABULARY_SHAPE',
      'E_VOCABULARY_SHAPE',
    ]);
    expect(problemsOf(text)[1]?.[1]).toBe('1');
  });

  it("points a rule's filter error into the file, past an escaped backslash", () => {
    // In the file the value reads `title matches \\w+ AND = 1`: the escape is two characters
    // there and one in the expression, so an offset not mapped through it lands one early.
    const text = vocabulary({
      rules: { kinds: [{ when: 'title matches \\w+ AND = 1', set: {} }] },
    });
    expect(problemsOf(text)).toEqual([['E_RECIPE_WHERE', '=']]);
  });

  it('points a refused pattern at its construct, past escapes of both kinds', () => {
    const text = vocabulary({
      rewrites: { noise: [{ pattern: '\\d+\t(?=x)', replace: '' }] },
    }).replace('\\t', '\\u0009');
    expect(problemsOf(text)).toEqual([['E_RECIPE_PATTERN_UNSAFE', '(?=']]);
  });

  it('checks a replacement against the groups of its pattern', () => {
    const text = vocabulary({ rewrites: { noise: [{ pattern: '^(?<a>x)', replace: '$1' }] } });
    expect(problemsOf(text)).toEqual([['E_RECIPE_REWRITE', '"$1"']]);
  });

  it("checks a rule's templates", () => {
    const text = vocabulary({ rules: { kinds: [{ when: '', set: { label: '{title' } }] } });
    expect(problemsOf(text)).toEqual([['E_RECIPE_TEMPLATE', '"{title"']]);
  });

  it('runs only the pattern guard over a key of the team, at any depth', () => {
    const text = vocabulary({
      hosts: ['x'],
      extra: { deep: [{ pattern: '(a+)+', note: '(b+)+' }] },
    });
    expect(problemsOf(text).map(([code]) => code)).toEqual(['E_RECIPE_PATTERN_UNSAFE']);
  });

  it('keeps offsets those of the file when it starts with a byte order mark', () => {
    const text = `\uFEFF${vocabulary({ rules: { kinds: [{ when: 'a = 1 AND', set: {} }] } })}`;
    const [problem] = problemsOf(text);
    expect(problem?.[0]).toBe('E_RECIPE_WHERE');
  });
});
