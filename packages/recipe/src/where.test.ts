import { describe, expect, it } from 'vitest';

import type { CellValue } from './table.js';
import { parseWhere, satisfies } from './where.js';

const keeps = (expression: string, cell: CellValue) => {
  const parsed = parseWhere(expression);
  if (!parsed.ok) throw new Error(parsed.error[0]?.message);
  return parsed.value.every((predicate) => satisfies(predicate, cell));
};

describe('parseWhere', () => {
  it('reads every operator of the grammar, joined by AND in any case', () => {
    const parsed = parseWhere(
      'a = 1 and b != "two words" AND c ~ x AND d !~ y AND e in (p, "q r") AND ' +
        'f not in (s) AND g is empty AND h IS NOT EMPTY',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.map(({ column, operator, values }) => [column, operator, values])).toEqual([
      ['a', '=', ['1']],
      ['b', '!=', ['two words']],
      ['c', '~', ['x']],
      ['d', '!~', ['y']],
      ['e', 'in', ['p', 'q r']],
      ['f', 'not in', ['s']],
      ['g', 'is empty', []],
      ['h', 'is not empty', []],
    ]);
  });

  it('places a column range in the recipe, not in the expression', () => {
    const parsed = parseWhere('kind = ad', 40);
    if (!parsed.ok) throw new Error('expected the filter to parse');
    expect(parsed.value[0]?.columnRange).toEqual({ start: 40, end: 44 });
  });

  it.each([
    ['a = 1 OR b = 2', "'OR' does not exist", 'OR'],
    ['(a = 1)', 'grouping parentheses', '('],
    ['a = AND', 'reserved word', 'AND'],
    ['a = 1 AND', "ends in 'AND'", 'AND'],
    ['a = 1 b = 2', "expected 'AND'", 'b'],
    ['a not x', "expected 'in' after 'not'", 'x'],
    ['a is full', "'empty' or 'not empty'", 'full'],
    ['a in x', "expected '(' after 'in'", 'x'],
    ['a in (x y)', "expected ',' or ')'", 'y'],
    ['a = !x', "cannot read the expression from '!x'", '!x'],
    ['a > 1', "unknown operator '>'", '>'],
    ['a like b', "unknown operator 'like'", 'like'],
    ['', 'the expression is empty', ''],
  ])('refuses %j and teaches the way out', (expression, message, at) => {
    const parsed = parseWhere(expression);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const [problem] = parsed.error;
    expect(problem?.code).toBe('E_RECIPE_WHERE');
    expect(problem?.message).toContain(message);
    expect(expression.slice(problem?.range?.start, problem?.range?.end)).toBe(at);
  });

  it('says what is missing when the expression stops early', () => {
    const parsed = parseWhere('a in (x,');
    expect(parsed.ok ? undefined : parsed.error[0]?.message).toContain('a value is missing');
  });
});

describe('satisfies', () => {
  it('compares without case or accents, both ways', () => {
    expect(keeps('kind = anuncio', 'Anúncio')).toBe(true);
    expect(keeps('kind = ANÚNCIO', ' anuncio ')).toBe(true);
    expect(keeps('kind in (video, anuncio)', 'Vídeo')).toBe(true);
    expect(keeps('title ~ "sale ban"', 'Spring SALE banner')).toBe(true);
    expect(keeps('title !~ sale', 'Spring SALE banner')).toBe(false);
  });

  it('keeps an empty cell for != and reads null and an empty list as empty', () => {
    expect(keeps('team != design', null)).toBe(true);
    expect(keeps('team is empty', null)).toBe(true);
    expect(keeps('team is empty', [])).toBe(true);
    expect(keeps('team is not empty', ['copy'])).toBe(true);
    expect(keeps('team not in (copy)', 'design')).toBe(true);
  });

  it('compares a number as its text', () => {
    expect(keeps('points = 3', 3)).toBe(true);
  });
});
