import type { Diagnostics } from '@tyto/core';
import { isOk, sliceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import withBlankLine from './__fixtures__/block-with-blank-line.brief?raw';
import withoutBlankLines from './__fixtures__/block-without-blank-lines.brief?raw';
import { parseBrief } from './parse-brief.js';

/**
 * A blank line does not end an indented block (TYTO-294, ADR 0087), and between two lines of
 * text it makes a paragraph (TYTO-557, ADR 0205).
 *
 * The maintainer's rules: blank lines — one or several in a row — inside an indented block
 * never end it; a block still ends only at the next line that is not blank and starts back at
 * column 0. Between two lines of text they are one paragraph boundary; at the start or the end
 * of a block they mean nothing.
 *
 * Every comparison here strips the ranges first. A blank line moves every offset after it,
 * so the two ASTs cannot be equal byte for byte; what has to be equal is what they say. The
 * Scene carries no ranges at all, and `tools/contract-test` asserts the compiled Scenes are
 * deep-equal outright.
 */

/** The AST as a value, with every source offset removed. */
function meaningOf(text: string): unknown {
  const result = parseBrief(text);
  if (!isOk(result)) {
    throw new Error(result.error.map((item) => item.message).join('; '));
  }
  expect(result.diagnostics, 'a blank line is not a mistake').toEqual([]);
  return JSON.parse(
    JSON.stringify(result.value, (key, value: unknown) =>
      key === 'range' || key === 'nameRange' || key === 'ranges' ? undefined : value,
    ),
  );
}

function problemsOf(text: string): Diagnostics {
  const result = parseBrief(text);
  return isOk(result) ? result.diagnostics : result.error;
}

/** The control with `count` blank lines between its two groups, each line holding `fill`. */
function withBlankLines(count: number, fill = ''): string {
  const lines = withoutBlankLines.split('\n');
  // The second ORTOPEDISTA is line 4: the head, three lines of the first group, then it.
  return [
    ...lines.slice(0, 4),
    ...Array.from({ length: count }, () => fill),
    ...lines.slice(4),
  ].join('\n');
}

/**
 * The control with the break in front of its second group marked as a paragraph: what a blank
 * line there means since ADR 0205. The control has no other blank line, so that is the only
 * difference a run of blank lines may make.
 */
function controlWithParagraph(text: string = withoutBlankLines): unknown {
  const meaning = meaningOf(text) as {
    directives: { body: { kind: string; paragraph?: true }[] }[];
  };
  const breaks = meaning.directives[0]!.body.filter((item) => item.kind === 'break');
  // The head, three lines of the first group, then the second: its break is the third.
  breaks[2]!.paragraph = true;
  return meaning;
}

describe('a blank line inside an indented block makes a paragraph (ADR 0205)', () => {
  it('leaves the committed fixture meaning the control with one paragraph boundary', () => {
    expect(meaningOf(withBlankLine)).toEqual(controlWithParagraph());
  });

  it.each([1, 2, 3, 7])('makes one paragraph of %i blank lines in a row', (count) => {
    expect(meaningOf(withBlankLines(count))).toEqual(controlWithParagraph());
  });

  it.each([1, 3])('makes one paragraph of %i lines holding only spaces and tabs', (count) => {
    expect(meaningOf(withBlankLines(count, ' \t  '))).toEqual(controlWithParagraph());
  });

  it('reads the same blank lines the same way in a file saved with CRLF', () => {
    const crlf = (text: string): string => text.replaceAll('\n', '\r\n');
    expect(meaningOf(crlf(withBlankLines(3)))).toEqual(
      controlWithParagraph(crlf(withoutBlankLines)),
    );
  });

  it('ignores blank lines between the directive and its first body line', () => {
    const spaced = withoutBlankLines.replace('::lamina\n', '::lamina\n\n\n');
    expect(meaningOf(spaced)).toEqual(meaningOf(withoutBlankLines));
  });

  it('ignores blank lines at the end of the block, before the next directive', () => {
    const control = `${withoutBlankLines}::titulo Fim\n`;
    const spaced = `${withoutBlankLines}\n  \n\n::titulo Fim\n`;
    expect(meaningOf(spaced)).toEqual(meaningOf(control));
  });

  it('gives one directive and five lines, with no directive made up from the text', () => {
    const result = parseBrief(withBlankLines(3));
    if (!isOk(result)) throw new Error('should parse');
    expect(result.value.directives.map((item) => item.name)).toEqual(['lamina']);
    expect(result.value.directives[0]?.body.filter((item) => item.kind === 'break')).toHaveLength(
      4,
    );
  });

  it('makes a paragraph between a head with text of its own and the first body line', () => {
    const body = meaningOf('::lamina Um\n\n  Dois\n') as { directives: { body: unknown[] }[] };
    expect(body.directives[0]!.body).toEqual([
      { kind: 'text', value: 'Um' },
      { kind: 'break', paragraph: true },
      { kind: 'text', value: 'Dois' },
    ]);
  });

  it('makes none where a comment stands between two lines, and one where a blank line does too', () => {
    const kinds = (text: string): unknown =>
      (meaningOf(text) as { directives: { body: unknown[] }[] }).directives[0]!.body;
    const plain = [
      { kind: 'text', value: 'Um' },
      { kind: 'break' },
      { kind: 'text', value: 'Dois' },
    ];
    const paragraph = [
      { kind: 'text', value: 'Um' },
      { kind: 'break', paragraph: true },
      { kind: 'text', value: 'Dois' },
    ];
    expect(kinds('::lamina\n  Um\n  // nota\n  Dois\n')).toEqual(plain);
    expect(kinds('::lamina\n  Um\n// nota\n  Dois\n')).toEqual(plain);
    expect(kinds('::lamina\n  Um\n\n  // nota\n  Dois\n')).toEqual(paragraph);
    expect(kinds('::lamina\n  Um\n  // nota\n\n  Dois\n')).toEqual(paragraph);
    expect(kinds('::lamina\n  Um\n// nota\n\n  Dois\n')).toEqual(paragraph);
  });
});

describe('where a block still ends', () => {
  it('ends at the next line back at column 0, however many blank lines come first', () => {
    const result = parseBrief('::a\n  um\n\n\n\n::b dois\n');
    if (!isOk(result)) throw new Error('should parse');
    expect(result.diagnostics).toEqual([]);
    expect(result.value.directives.map((item) => item.name)).toEqual(['a', 'b']);
    expect(result.value.directives[0]?.body).toEqual([
      { kind: 'text', value: 'um', range: { start: 6, end: 8 } },
    ]);
  });

  it.each([
    ['right after a comment', '// nota\n  sem diretiva\n'],
    ['after a comment and blank lines', '// nota\n\n \n\n  sem diretiva\n'],
  ])('still refuses an indented line with no directive above it, %s', (_label, text) => {
    const problems = problemsOf(text);
    expect(problems.length).toBeGreaterThan(0);
    for (const item of problems) expect(item.code).toBe('E_SYNTAX');
    // The first complaint is the indent itself, not the blank lines in front of it.
    expect(sliceRange(text, problems[0]!.range!)).toBe('  ');
  });
});

describe('a line holding only spaces at the top level', () => {
  it.each([
    ['at the start of the file', '   \n::a um\n'],
    ['between two directives', '::a um\n \t \n::b dois\n'],
    ['after a comment', '// nota\n    \n::a um\n'],
    ['at the end of a file with no final break', '::a um\n\n   '],
  ])('is accepted and ignored %s', (_label, text) => {
    expect(problemsOf(text)).toEqual([]);
  });
});

describe('ranges never point at blank padding', () => {
  it('ends a directive at its last character, not at the blank lines after it', () => {
    const text = '::a\n  um\n  dois\n\n \t\n\n::b tres\n';
    const result = parseBrief(text);
    if (!isOk(result)) throw new Error('should parse');
    expect(sliceRange(text, result.value.directives[0]!.range)).toBe('::a\n  um\n  dois');
  });

  it('ends a directive whose block runs to the end of the file at its last character', () => {
    const text = '::a\n  um\n\n   ';
    const result = parseBrief(text);
    if (!isOk(result)) throw new Error('should parse');
    expect(sliceRange(text, result.value.directives[0]!.range)).toBe('::a\n  um');
  });

  it('puts one break between two lines, on the line break the first one ends with', () => {
    const text = '::a\n  um\n\n\n  dois\n';
    const result = parseBrief(text);
    if (!isOk(result)) throw new Error('should parse');
    const body = result.value.directives[0]!.body;
    expect(body.map((item) => item.kind)).toEqual(['text', 'break', 'text']);
    expect(sliceRange(text, body[1]!.range)).toBe('\n');
    expect(body[1]!.range.start).toBe(text.indexOf('um') + 2);
  });
});
