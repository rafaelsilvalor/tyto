import type { Diagnostics, Formula, Inline, MathItem, RichText } from '@tyto/core';
import { isOk } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { parseBrief } from './parse-brief.js';

/**
 * A formula written in a brief, `$…$` (TYTO-734, ADR 0206 decisions 1 to 5 and 15).
 *
 * Read through `parseBrief`, as an author's brief is: the tokenizer decides where a formula
 * starts and ends, `parseFormula` reads what is inside, and the AST carries a `Formula` or,
 * for one with an error, the text the author wrote.
 */

function parsed(line: string): { body: RichText; problems: Diagnostics; source: string } {
  const source = `::t ${line}\n`;
  const result = parseBrief(source);
  if (!isOk(result)) throw new Error(result.error.map((item) => item.message).join('; '));
  const [directive] = result.value.directives;
  if (directive === undefined) throw new Error('no directive parsed');
  return { body: directive.body, problems: result.diagnostics, source };
}

function formulasIn(body: RichText): Formula[] {
  return body.flatMap((inline: Inline): Formula[] => {
    if (inline.kind === 'formula') return [inline];
    return inline.kind === 'text' || inline.kind === 'break' ? [] : formulasIn(inline.children);
  });
}

const text = (value: string): MathItem => ({ kind: 'text', text: value });

describe('money stays text (Pandoc’s rule, decision 2)', () => {
  it.each([
    'R$ 50',
    'de R$ 50 a R$ 60',
    'R$50 a R$60',
    'US$ 5 e R$ 10,50',
    'só um $ solto',
    'termina em $',
  ])('%s holds no formula and reads as written', (line) => {
    const { body, problems } = parsed(line);
    expect(body).toEqual([{ kind: 'text', value: line, range: expect.anything() as unknown }]);
    expect(problems).toEqual([]);
  });
});

describe('where the rule reads money as a formula', () => {
  it('pairs two prices spaced differently, as Pandoc does: R$50 e R$ 60', () => {
    // The first `$` has a digit after it and the second a letter before it and a space after,
    // so the two make a formula. Written as the rest of the language writes money, `R$ 50`,
    // nothing opens. Pinned so the docs' warning stays true (docs/brief-language.md).
    const { body, problems } = parsed('R$50 e R$ 60');
    expect(problems).toEqual([]);
    expect(formulasIn(body).map((formula) => formula.source)).toEqual(['$50 e R$']);
  });
});

describe('a formula', () => {
  it('reads the reference answer as a stacked fraction, spaces kept, `\\ ` a space', () => {
    const { body, problems, source } = parsed('$F = \\frac{1}{40·10^{-3}} = 25\\ Hz$');
    expect(problems).toEqual([]);
    const [formula] = formulasIn(body);
    expect(formula?.math).toEqual([
      text('F = '),
      {
        kind: 'fraction',
        numerator: [text('1')],
        denominator: [text('40·10'), { kind: 'scripts', superscript: [text('-3')] }],
      },
      text(' = 25 Hz'),
    ]);
    expect(formula?.source).toBe('$F = \\frac{1}{40·10^{-3}} = 25\\ Hz$');
    expect(source.slice(formula?.range.start, formula?.range.end)).toBe(formula?.source);
    // Decision 15: a traversal through `children` reads the linear reading.
    expect(formula?.children).toEqual([
      { kind: 'text', value: 'F = 1/(40·10^(-3)) = 25 Hz', range: formula?.range },
    ]);
  });

  it('takes one character after ^ or _ without braces, and both scripts on one base', () => {
    const [formula] = formulasIn(parsed('$v_0^2$').body);
    expect(formula?.math).toEqual([
      text('v'),
      { kind: 'scripts', subscript: [text('0')], superscript: [text('2')] },
    ]);
  });

  it('nests: a group may hold a fraction or scripts again', () => {
    const [formula] = formulasIn(parsed('$\\frac{1}{10^{3}}$').body);
    expect(formula?.math).toEqual([
      {
        kind: 'fraction',
        numerator: [text('1')],
        denominator: [text('10'), { kind: 'scripts', superscript: [text('3')] }],
      },
    ]);
  });

  it('has its own escapes, and \\$ never closes it', () => {
    const [formula] = formulasIn(parsed('$a \\$ b \\{c\\}$').body);
    expect(formula?.math).toEqual([text('a $ b {c}')]);
  });

  it('owns its backslashes: no line break, no \\:: escape inside it, and the line goes on', () => {
    const { body } = parsed('$x^2$ e $\\frac{a}{b}$ fim\\');
    expect(body.map((inline) => inline.kind)).toEqual([
      'formula',
      'text',
      'formula',
      'text',
      'break',
    ]);
  });

  it('sits inside bold, italic and a mark', () => {
    const { body } = parsed('**$x^2$** *$y_1$* {cor:roxo}$z$ e mais{/}');
    expect(formulasIn(body).map((formula) => formula.source)).toEqual(['$x^2$', '$y_1$', '$z$']);
  });

  it('opens after a word and closes before punctuation', () => {
    const { body } = parsed('Logo,$x^2$, como visto.');
    expect(body.map((inline) => inline.kind)).toEqual(['text', 'formula', 'text']);
  });
});

describe('an error inside a formula (decision 5)', () => {
  it.each([
    ['$\\sqrt{2}$', 'E_FORMULA_COMMAND', '\\sqrt'],
    ['$a \\, b$', 'E_FORMULA_COMMAND', '\\,'],
    ['$\\frac{1}$', 'E_FORMULA_GROUP', '\\frac'],
    ['$\\frac{1}{2$', 'E_FORMULA_GROUP', '{'],
    ['$x^{2$', 'E_FORMULA_GROUP', '{'],
    ['$a}b$', 'E_FORMULA_GROUP', '}'],
    ['${a}$', 'E_FORMULA_GROUP', '{'],
    ['$x^ 2$', 'E_FORMULA_GROUP', '^'],
    ['$$ x', 'E_FORMULA_EMPTY', '$$'],
    ['$\\frac{}{2}$', 'E_FORMULA_EMPTY', '{}'],
  ])('%s is %s at %s, and is drawn as its source', (line, code, fault) => {
    const { body, problems, source } = parsed(line);
    expect(problems.map((problem) => problem.code)).toEqual([code]);
    const range = problems[0]?.range;
    expect(range === undefined ? undefined : source.slice(range.start, range.end)).toBe(fault);
    expect(formulasIn(body)).toEqual([]);
    expect(body).toEqual([{ kind: 'text', value: line, range: expect.anything() as unknown }]);
  });

  it('costs only its own formula: the next one on the line still reads', () => {
    const { body, problems } = parsed('$\\sqrt{2}$ e $x^2$');
    expect(problems.map((problem) => problem.code)).toEqual(['E_FORMULA_COMMAND']);
    expect(formulasIn(body).map((formula) => formula.source)).toEqual(['$x^2$']);
  });
});
