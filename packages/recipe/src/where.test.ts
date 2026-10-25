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
        'f not in (s) AND g is empty AND h IS NOT EMPTY AND i < 1 AND j <= -2 AND k>3.5 AND ' +
        'l >= "4"',
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
      ['i', '<', ['1']],
      ['j', '<=', ['-2']],
      ['k', '>', ['3.5']],
      ['l', '>=', ['4']],
    ]);
    expect(parsed.value.slice(8).map(({ number }) => number)).toEqual([1, -2, 3.5, 4]);
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
    ['a not x', "expected 'in' or 'matches' after 'not'", 'x'],
    ['a is full', "'empty' or 'not empty'", 'full'],
    ['a in x', "expected '(' after 'in'", 'x'],
    ['a in (x y)', "expected ',' or ')'", 'y'],
    ['a = !x', "cannot read the expression from '!x'", '!x'],
    ['a == 1', "expected a value and found '='", '='],
    ['a => 1', "expected a value and found '>'", '>'],
    ['a > x', "'>' compares numbers", 'x'],
    ['a <= 1e3', "'<=' compares numbers", '1e3'],
    ['a < "1 000"', "'<' compares numbers", '"1 000"'],
    ['a >', "a number after '>' is missing", ''],
    ['a ! 1', "cannot read the expression from '! 1'", '! 1'],
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

  it('orders a number cell, or text that is one once trimmed, against the value', () => {
    expect([2, 3, 4].map((points) => keeps('points < 3', points))).toEqual([true, false, false]);
    expect([2, 3, 4].map((points) => keeps('points <= 3', points))).toEqual([true, true, false]);
    expect([2, 3, 4].map((points) => keeps('points > 3', points))).toEqual([false, false, true]);
    expect([2, 3, 4].map((points) => keeps('points >= 3', points))).toEqual([false, true, true]);
    expect(keeps('due>5', ' 12 ')).toBe(true);
    expect(keeps('due > 5', '5.5')).toBe(true);
    expect(keeps('due < 0', '-0.5')).toBe(true);
    expect(keeps('due >= 10', '9')).toBe(false);
  });

  it('drops a cell that is not a number, as JQL drops an empty field', () => {
    for (const cell of [null, '', '  ', 'ten', '1e3', '1,5', true, [5], []] as CellValue[]) {
      expect(keeps('due > -100', cell)).toBe(false);
      expect(keeps('due < 100', cell)).toBe(false);
    }
  });
});

describe('matches', () => {
  it('reads matches and not matches, quoted or bare, and compiles the pattern', () => {
    const parsed = parseWhere(String.raw`a matches "^x\b" AND b NOT MATCHES y+`);
    if (!parsed.ok) throw new Error(parsed.error[0]?.message);
    expect(parsed.value.map(({ operator, values }) => [operator, values])).toEqual([
      ['matches', [String.raw`^x\b`]],
      ['not matches', ['y+']],
    ]);
    expect(parsed.value[0]?.pattern?.expression.flags).toBe('iu');
  });

  it('tests the cell as written, so a pattern names its accents', () => {
    expect(keeps(String.raw`title matches "p[áa]gina\b"`, 'Nova Página de vendas')).toBe(true);
    expect(keeps('title matches "pagina"', 'Nova Página')).toBe(false);
    expect(keeps(String.raw`title matches "\bbanner"`, 'ébanner')).toBe(false);
    expect(keeps('title not matches "^spring"', 'Spring sale')).toBe(false);
    expect(keeps('title not matches "^spring"', null)).toBe(true);
    expect(keeps('team matches "^copy, design$"', ['copy', 'design'])).toBe(true);
  });

  it('places a refused pattern at its construct, inside the quotes, in the recipe', () => {
    const expression = 'title matches "x(a+)+" AND kind = ad';
    const parsed = parseWhere(expression, 100);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.map(({ code }) => code)).toEqual(['E_RECIPE_PATTERN_UNSAFE']);
    const range = parsed.error[0]?.range;
    expect(expression.slice((range?.start ?? 0) - 100, (range?.end ?? 0) - 100)).toBe('(a+)+');
  });

  it.each([
    ['a matches', "a pattern after 'matches' is missing", ''],
    ['a matches AND', 'reserved word', 'AND'],
    ['a matches (x)', "expected a pattern after 'matches'", '('],
    ['a not like x', "expected 'in' or 'matches' after 'not'", 'like'],
  ])('refuses %j and teaches the way out', (expression, message, at) => {
    const parsed = parseWhere(expression);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const [problem] = parsed.error;
    expect(problem?.code).toBe('E_RECIPE_WHERE');
    expect(problem?.message).toContain(message);
    expect(expression.slice(problem?.range?.start, problem?.range?.end)).toBe(at);
  });
});
