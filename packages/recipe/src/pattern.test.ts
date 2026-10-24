import { describe, expect, it } from 'vitest';

import { PATTERN_LIMITS, boundedInput, compilePattern } from './pattern.js';

const compiled = (pattern: string) => {
  const result = compilePattern(pattern);
  if (!result.ok) throw new Error(result.error.map(({ message }) => message).join('\n'));
  return result.value;
};

const finds = (pattern: string, text: string) => compiled(pattern).test(text);

/** Each refusal as the code and the text its range covers in the pattern. */
const refusals = (pattern: string) => {
  const result = compilePattern(pattern);
  if (result.ok) return [];
  return result.error.map(({ code, range }) => [code, pattern.slice(range?.start, range?.end)]);
};

describe('the Unicode rewrite', () => {
  it('reads \\b as a boundary between Unicode word characters', () => {
    expect(finds(String.raw`\bbanner`, 'o banner')).toBe(true);
    expect(finds(String.raw`\bbanner`, 'ébanner')).toBe(false);
    expect(finds(String.raw`p\b`, 'pá')).toBe(false);
    expect(finds(String.raw`p\b`, 'p.')).toBe(true);
  });

  it('reads \\B as its opposite', () => {
    expect(finds(String.raw`p\B`, 'pá')).toBe(true);
    expect(finds(String.raw`p\B`, 'p.')).toBe(false);
  });

  it('reads \\w and \\W as every letter, digit and underscore, inside a class too', () => {
    expect(finds(String.raw`^\w+$`, 'página')).toBe(true);
    expect(finds(String.raw`^[\w-]+$`, 'ação-rápida')).toBe(true);
    expect(finds(String.raw`\W`, 'ação')).toBe(false);
    expect(finds(String.raw`\W`, 'a b')).toBe(true);
  });

  it('reads \\d and \\D as every decimal digit', () => {
    expect(finds(String.raw`^\d+$`, '٣٤')).toBe(true);
    expect(finds(String.raw`^[\d]$`, '٣')).toBe(true);
    expect(finds(String.raw`\D`, '٣٤')).toBe(false);
  });

  it('keeps \\b inside a class a backspace, as in both languages', () => {
    expect(finds(String.raw`[\b]`, '\b')).toBe(true);
    expect(finds(String.raw`[\b]`, 'b')).toBe(false);
  });

  it('ignores case, accented letters included, and never accents', () => {
    expect(finds('pagespeed', 'Verificar no PageSpeed')).toBe(true);
    expect(finds('ANÚNCIO', 'anúncio')).toBe(true);
    expect(finds('anuncio', 'anúncio')).toBe(false);
  });

  it('leaves the rest of JavaScript syntax as written', () => {
    expect(finds(String.raw`(?<day>\d{2})/(?:\d{2})`, 'em 24/10')).toBe(true);
    expect(finds(String.raw`\p{Lu}{2}`, 'eÉÁ')).toBe(true);
    expect(finds(String.raw`\u{1F600}`, '😀')).toBe(true);
    expect(finds(String.raw`\(lp\)`, 'Site (LP)')).toBe(true);
  });
});

describe('the guard', () => {
  it.each([
    [String.raw`(a)\1`, String.raw`\1`],
    [String.raw`(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\10`, String.raw`\10`],
    [String.raw`(?<x>a)\k<x>`, String.raw`\k<x>`],
  ])('refuses the backreference in %s at its range', (pattern, at) => {
    expect(refusals(pattern)).toEqual([['E_RECIPE_PATTERN_UNSAFE', at]]);
  });

  it.each([
    ['a(?=b)', '(?='],
    ['a(?!b)', '(?!'],
    ['(?<=a)b', '(?<='],
    ['(?<!a)b', '(?<!'],
  ])('refuses the lookaround in %s at its range', (pattern, at) => {
    expect(refusals(pattern)).toEqual([['E_RECIPE_PATTERN_UNSAFE', at]]);
  });

  it.each([
    ['x(a+)+', '(a+)+'],
    ['(a*)*', '(a*)*'],
    ['(?:ab*c)+?', '(?:ab*c)+?'],
    ['(a{1,3}){2,}', '(a{1,3}){2,}'],
    ['((ab)+c)*', '((ab)+c)*'],
    ['(a|(b+))+', '(a|(b+))+'],
  ])('refuses the nested quantifier in %s over the whole group', (pattern, at) => {
    expect(refusals(pattern)).toEqual([['E_RECIPE_PATTERN_UNSAFE', at]]);
  });

  it.each([
    String.raw`\d{2}/\d{2}.*\b(spring|sale)\b`,
    '(ab)+',
    '(a{3})+',
    '(a?)+',
    '(?:a|b)+c*',
    '(a+)?',
    '[(+)]+',
    String.raw`\(a+\)+`,
    String.raw`landing\s*page|p[áa]gina\s+de\s+vendas`,
  ])('accepts %s, whose star height is at most one', (pattern) => {
    expect(refusals(pattern)).toEqual([]);
  });

  it('refuses a quantified anchor or boundary, which the rewrite would make repeatable', () => {
    expect(refusals(String.raw`a\b+`)).toEqual([['E_RECIPE_PATTERN_UNSAFE', String.raw`\b+`]]);
    expect(refusals('^*a')).toEqual([['E_RECIPE_PATTERN_UNSAFE', '^*']]);
  });

  it('refuses \\W inside a class, where it cannot be made Unicode', () => {
    expect(refusals(String.raw`[\W_]`)).toEqual([['E_RECIPE_PATTERN_UNSAFE', String.raw`\W`]]);
  });

  it('answers every refused construct, not only the first', () => {
    expect(refusals(String.raw`(a+)+(?=b)\1`)).toEqual([
      ['E_RECIPE_PATTERN_UNSAFE', '(a+)+'],
      ['E_RECIPE_PATTERN_UNSAFE', '(?='],
      ['E_RECIPE_PATTERN_UNSAFE', String.raw`\1`],
    ]);
  });

  it('places each refusal in the recipe through the offset', () => {
    const result = compilePattern('(a+)+', 30);
    expect(result.ok ? undefined : result.error[0]?.range).toEqual({ start: 30, end: 35 });
    expect(result.ok ? undefined : result.error[0]?.message).toContain('nested quantifier');
  });

  it('refuses a pattern over 512 characters before reading it, and accepts 512', () => {
    expect(refusals('a'.repeat(PATTERN_LIMITS.patternLength))).toEqual([]);
    const long = 'a'.repeat(PATTERN_LIMITS.patternLength + 1);
    const result = compilePattern(long);
    expect(result.ok ? undefined : result.error[0]?.code).toBe('E_RECIPE_PATTERN');
    expect(result.ok ? undefined : result.error[0]?.message).toContain('513 characters');
  });

  it('refuses an empty pattern and one JavaScript cannot compile', () => {
    expect(refusals('')).toEqual([['E_RECIPE_PATTERN', '']]);
    const result = compilePattern('(a');
    expect(result.ok ? undefined : result.error[0]?.code).toBe('E_RECIPE_PATTERN');
    expect(result.ok ? undefined : result.error[0]?.message).toContain('not a valid regular');
    expect(result.ok ? undefined : result.error[0]?.message).not.toContain('p{L}');
  });
});

describe('the bounded input', () => {
  it('reads the first 4,096 characters of a cell and never the rest', () => {
    const filler = 'x'.repeat(PATTERN_LIMITS.inputLength - 6);
    expect(finds('needle', `${filler}needle`)).toBe(true);
    expect(finds('needle', `${filler}xneedle`)).toBe(false);
  });

  it('cuts at a code point, never inside a surrogate pair', () => {
    const text = `${'x'.repeat(PATTERN_LIMITS.inputLength - 1)}😀`;
    expect(boundedInput(text)).toBe('x'.repeat(PATTERN_LIMITS.inputLength - 1));
    expect(boundedInput('short')).toBe('short');
  });
});
