import {
  type Diagnostic,
  type Result,
  type SourceRange,
  diagnostic,
  err,
  ok,
  sourceRange,
} from '@tyto/core';

import { type CompiledPattern, compilePattern } from './pattern.js';
import { type CellValue, cellText, comparable } from './table.js';

/**
 * `where`'s filter: a subset of JQL, ported from Buraqueira's `flow.py` (ADR 0128).
 *
 * The rule that keeps it small: **every expression accepted here means what it would mean in
 * JQL.** So it has `=`, `!=`, `~`, `!~`, `in (…)`, `not in (…)`, `is empty`, `is not empty`,
 * joined by `AND` — and no `OR` and no parentheses. Without `OR` there is no precedence to get
 * right, and a flat list of predicates is the whole tree. Two deliberate departures, both
 * towards keeping more rows: `~` is a substring match, and `!=` keeps empty cells.
 *
 * One addition JQL lacks (ADR 0136): `matches "<pattern>"` and `not matches "<pattern>"` test
 * the cell's text against a `tyto-pattern/1` pattern, compiled once while the expression is
 * read, so a refused pattern is a diagnostic at its range before any row is read. A pattern is
 * quoted when it holds a blank, a parenthesis, a comma, a quote, `=`, `~` or `!`. It ignores
 * case but not accents, so `p[áa]gina` is how a pattern takes both; `not matches`, like `!=`,
 * keeps empty cells that the pattern does not match.
 *
 * And one more (ADR 0136): `<`, `<=`, `>` and `>=` compare numbers, as in `points >= 3`. The
 * value must be a number, written `-12` or `3.5`. A cell compares when it is a number, or text
 * that is one once trimmed; any other cell — empty, a list, a boolean, words — fails, so the row
 * is dropped, as JQL drops an empty field from a comparison.
 */
export type Operator =
  | '='
  | '!='
  | '~'
  | '!~'
  | 'in'
  | 'not in'
  | 'is empty'
  | 'is not empty'
  | 'matches'
  | 'not matches'
  | '<'
  | '<='
  | '>'
  | '>=';

export interface Predicate {
  readonly column: string;
  readonly columnRange: SourceRange;
  readonly operator: Operator;
  readonly values: readonly string[];
  /** The compiled pattern of `matches` and `not matches`; absent for every other operator. */
  readonly pattern?: CompiledPattern;
  /** The number `<`, `<=`, `>` and `>=` compare with, read once; absent for the others. */
  readonly number?: number;
}

interface Found {
  readonly operator: Operator;
  readonly values: readonly string[];
  readonly pattern?: CompiledPattern;
  readonly number?: number;
}

type TokenKind = 'word' | 'quoted' | 'operator' | 'symbol';

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly range: SourceRange;
}

const RESERVED = new Set(['and', 'or', 'in', 'is', 'not', 'empty']);
const COMPARISONS = new Set(['=', '!=', '~', '!~']);
const ORDERINGS = new Set(['<', '<=', '>', '>=']);
/** A number as a value or a cell writes it: no exponent, no thousands separator, no `+`. */
const NUMBER = /^-?\d+(?:\.\d+)?$/u;

// `<` and `>` are no word characters, so `due>5` is three tokens, as `due=5` is.
const TOKEN =
  /(?<quoted>"[^"]*"|'[^']*')|(?<operator>!=|!~|<=|>=|<|>|=|~)|(?<symbol>[(),])|(?<word>[^\s(),"'=~!<>]+)/uy;

class WhereError {
  constructor(
    readonly problem: string,
    readonly range: SourceRange,
    /** A refused pattern's own diagnostics, which stand in for the filter's. */
    readonly diagnostics?: readonly Diagnostic[],
  ) {}
}

/**
 * Parses an expression into predicates that all must hold. `offset` is where the expression
 * starts in the recipe, so a diagnostic points into the line and not into the expression.
 */
export function parseWhere(
  expression: string,
  offset = 0,
): Result<readonly Predicate[], readonly Diagnostic[]> {
  const whole = sourceRange(offset, offset + expression.length);
  const fail = (problem: string, range: SourceRange = whole, diagnostics?: readonly Diagnostic[]) =>
    err(diagnostics ?? [diagnostic('E_RECIPE_WHERE', { problem }, { range })]);

  const tokens = tokenize(expression, offset);
  if (tokens instanceof WhereError) return fail(tokens.problem, tokens.range);
  if (tokens.length === 0) return fail('the expression is empty');

  const reader = new Reader(tokens, whole);
  const predicates: Predicate[] = [];
  for (;;) {
    const predicate = reader.predicate();
    if (predicate instanceof WhereError) {
      return fail(predicate.problem, predicate.range, predicate.diagnostics);
    }
    predicates.push(predicate);
    const next = reader.next();
    if (next === undefined) return ok(predicates);
    const lowered = next.kind === 'word' ? next.text.toLowerCase() : next.text;
    if (lowered === 'and') {
      if (reader.atEnd()) return fail("the expression ends in 'AND'", next.range);
      continue;
    }
    if (lowered === 'or') {
      return fail(
        "'OR' does not exist in this grammar: for alternatives in one column use 'in', as " +
          "in 'kind in (ad, video)'; for different columns, bring the use case, which is " +
          'what would justify the grammar growing',
        next.range,
      );
    }
    return fail(`expected 'AND' between predicates and found '${next.text}'`, next.range);
  }
}

function tokenize(expression: string, offset: number): readonly Token[] | WhereError {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    if (/\s/u.test(expression[index] ?? '')) {
      index += 1;
      continue;
    }
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(expression);
    const groups = match?.groups;
    if (match === null || groups === undefined) {
      return new WhereError(
        `cannot read the expression from '${expression.slice(index, index + 24)}'`,
        sourceRange(offset + index, offset + expression.length),
      );
    }
    const range = sourceRange(offset + index, offset + index + match[0].length);
    if (groups['quoted'] !== undefined) {
      tokens.push({ kind: 'quoted', text: groups['quoted'].slice(1, -1), range });
    } else if (groups['operator'] !== undefined) {
      tokens.push({ kind: 'operator', text: groups['operator'], range });
    } else if (groups['symbol'] !== undefined) {
      tokens.push({ kind: 'symbol', text: groups['symbol'], range });
    } else {
      tokens.push({ kind: 'word', text: match[0], range });
    }
    index += match[0].length;
  }
  return tokens;
}

/** Each method answers its value or the `WhereError` that stopped it; nothing throws. */
class Reader {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly whole: SourceRange,
  ) {}

  atEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  next(): Token | undefined {
    const token = this.tokens[this.index];
    if (token !== undefined) this.index += 1;
    return token;
  }

  private take(expected: string): Token | WhereError {
    const token = this.next();
    if (token !== undefined) return token;
    const end = sourceRange(this.whole.end, this.whole.end);
    return new WhereError(`the expression ends early: ${expected} is missing`, end);
  }

  predicate(): Predicate | WhereError {
    const column = this.take('a column name');
    if (column instanceof WhereError) return column;
    if (column.kind === 'symbol' && column.text === '(') {
      return new WhereError(
        "grouping parentheses do not exist in this grammar: chain 'where' lines instead, " +
          'since each one is an AND',
        column.range,
      );
    }
    if (column.kind !== 'word') {
      return new WhereError(`expected a column name and found '${column.text}'`, column.range);
    }
    if (RESERVED.has(column.text.toLowerCase())) {
      return new WhereError(`'${column.text}' is a reserved word, not a column name`, column.range);
    }
    const operator = this.take(`an operator after '${column.text}'`);
    if (operator instanceof WhereError) return operator;
    const found = this.operatorAndValues(column.text, operator);
    if (found instanceof WhereError) return found;
    return { column: column.text, columnRange: column.range, ...found };
  }

  private operatorAndValues(column: string, operator: Token): Found | WhereError {
    if (operator.kind === 'operator' && COMPARISONS.has(operator.text)) {
      const value = this.value();
      if (value instanceof WhereError) return value;
      return { operator: operator.text as Operator, values: [value] };
    }
    if (operator.kind === 'operator' && ORDERINGS.has(operator.text)) {
      return this.number(operator.text as Operator);
    }
    const keyword = wordOf(operator);
    if (keyword === 'in') return this.list(column, 'in');
    if (keyword === 'matches') return this.pattern('matches');
    if (keyword === 'not') {
      const after = this.take("'in' or 'matches' after 'not'");
      if (after instanceof WhereError) return after;
      if (wordOf(after) === 'in') return this.list(column, 'not in');
      if (wordOf(after) === 'matches') return this.pattern('not matches');
      return new WhereError(
        `expected 'in' or 'matches' after 'not' and found '${after.text}'`,
        after.range,
      );
    }
    if (keyword === 'is') {
      const after = this.take("'empty' after 'is'");
      if (after instanceof WhereError) return after;
      if (wordOf(after) === 'empty') return { operator: 'is empty', values: [] };
      if (wordOf(after) !== 'not') {
        return new WhereError(
          `expected 'empty' or 'not empty' after 'is' and found '${after.text}'`,
          after.range,
        );
      }
      const last = this.take("'empty' after 'is not'");
      if (last instanceof WhereError) return last;
      if (wordOf(last) === 'empty') return { operator: 'is not empty', values: [] };
      return new WhereError(`expected 'empty' after 'is not' and found '${last.text}'`, last.range);
    }
    return new WhereError(
      `unknown operator '${operator.text}' after '${column}'. Available: ` +
        '=, !=, ~, !~, <, <=, >, >=, in (…), not in (…), is empty, is not empty, matches, ' +
        'not matches',
      operator.range,
    );
  }

  /** A quoted string, or a bare word that is not reserved: `status = AND x = y` is a mistake. */
  private value(): string | WhereError {
    const token = this.take('a value');
    if (token instanceof WhereError) return token;
    if (token.kind === 'quoted') return token.text;
    if (token.kind !== 'word') {
      return new WhereError(`expected a value and found '${token.text}'`, token.range);
    }
    if (RESERVED.has(token.text.toLowerCase())) {
      return new WhereError(
        `'${token.text}' is a reserved word; to use it as a value, quote it: "${token.text}"`,
        token.range,
      );
    }
    return token.text;
  }

  /** The number after `<`, `<=`, `>` or `>=`, read here so a word is refused at its range. */
  private number(operator: Operator): Found | WhereError {
    const token = this.take(`a number after '${operator}'`);
    if (token instanceof WhereError) return token;
    if ((token.kind === 'word' || token.kind === 'quoted') && NUMBER.test(token.text)) {
      return { operator, values: [token.text], number: Number(token.text) };
    }
    return new WhereError(
      `'${operator}' compares numbers, written as 3, -2 or 1.5, and '${token.text}' is not one`,
      token.range,
    );
  }

  /** The pattern after `matches`, compiled here so a refusal points into it. */
  private pattern(operator: 'matches' | 'not matches'): Found | WhereError {
    const token = this.take(`a pattern after '${operator}'`);
    if (token instanceof WhereError) return token;
    if (token.kind !== 'quoted' && token.kind !== 'word') {
      return new WhereError(
        `expected a pattern after '${operator}' and found '${token.text}'; quote a pattern ` +
          'that holds a blank, a parenthesis or a comma',
        token.range,
      );
    }
    if (token.kind === 'word' && RESERVED.has(token.text.toLowerCase())) {
      return new WhereError(
        `'${token.text}' is a reserved word; to use it as a pattern, quote it: "${token.text}"`,
        token.range,
      );
    }
    const start = token.range.start + (token.kind === 'quoted' ? 1 : 0);
    const compiled = compilePattern(token.text, start);
    if (!compiled.ok) return new WhereError('', token.range, compiled.error);
    return { operator, values: [token.text], pattern: compiled.value };
  }

  private list(column: string, operator: 'in' | 'not in'): Found | WhereError {
    const open = this.take("'(' after 'in'");
    if (open instanceof WhereError) return open;
    if (open.kind !== 'symbol' || open.text !== '(') {
      return new WhereError(
        `expected '(' after 'in' and found '${open.text}': the form is ${column} in (a, b)`,
        open.range,
      );
    }
    const values: string[] = [];
    for (;;) {
      const value = this.value();
      if (value instanceof WhereError) return value;
      values.push(value);
      const separator = this.take("',' or ')' in the 'in' list");
      if (separator instanceof WhereError) return separator;
      if (separator.kind === 'symbol' && separator.text === ')') return { operator, values };
      if (separator.kind !== 'symbol' || separator.text !== ',') {
        return new WhereError(
          `expected ',' or ')' in the 'in' list and found '${separator.text}'`,
          separator.range,
        );
      }
    }
  }
}

function wordOf(token: Token): string | undefined {
  return token.kind === 'word' ? token.text.toLowerCase() : undefined;
}

/** Whether one cell satisfies one predicate. Case and accents never matter. */
export function satisfies(predicate: Predicate, cell: CellValue | undefined): boolean {
  const value = comparable(cell);
  const targets = predicate.values.map((target) => comparable(target));
  const first = targets[0] ?? '';
  switch (predicate.operator) {
    case 'is empty':
      return value === '';
    case 'is not empty':
      return value !== '';
    case '=':
      return value === first;
    case '!=':
      return value !== first;
    case '~':
      return value.includes(first);
    case '!~':
      return !value.includes(first);
    case 'in':
      return targets.includes(value);
    case 'not in':
      return !targets.includes(value);
    // The pattern reads the cell as written: `comparable` would strip the accents it names.
    case 'matches':
      return predicate.pattern?.test(cellText(cell)) ?? false;
    case 'not matches':
      return !(predicate.pattern?.test(cellText(cell)) ?? false);
    case '<':
    case '<=':
    case '>':
    case '>=':
      return compares(predicate.operator, numberOf(cell), predicate.number);
  }
}

/** A cell as a number: a number as itself, text when it is one once trimmed, else none. */
function numberOf(cell: CellValue | undefined): number | undefined {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
  if (typeof cell !== 'string') return undefined;
  const text = cell.trim();
  return NUMBER.test(text) ? Number(text) : undefined;
}

function compares(operator: Operator, value: number | undefined, target: number | undefined) {
  if (value === undefined || target === undefined) return false;
  if (operator === '<') return value < target;
  if (operator === '<=') return value <= target;
  if (operator === '>') return value > target;
  return value >= target;
}
