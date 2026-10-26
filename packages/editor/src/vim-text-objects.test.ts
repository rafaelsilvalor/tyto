import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { entireSpan, indentBlock } from './vim-text-objects.js';

const doc = (...lines: readonly string[]): Text => Text.of([...lines]);

/** The span as the lines' text, which reads better in a failure than two numbers. */
const linesOf = (text: Text, span: { first: number; last: number } | undefined): string[] =>
  span === undefined
    ? []
    : Array.from(
        { length: span.last - span.first + 1 },
        (_, index) => text.line(span.first + index).text,
      );

const SAMPLE = doc(
  'scene a',
  '  frame b',
  '    text c',
  '    text d',
  '',
  '    text e',
  '',
  '  frame f',
  '    text g',
  'scene h',
);

describe('indentBlock (TYTO-422)', () => {
  it('takes the lines at the cursor indent or deeper, blank lines inside kept', () => {
    expect(linesOf(SAMPLE, indentBlock(SAMPLE, 4, 4, 1, true))).toEqual([
      '    text c',
      '    text d',
      '',
      '    text e',
    ]);
  });

  it('leaves a blank line at the edge of the block out', () => {
    // Line 7 is blank and borders `frame f`, which is shallower: the block ends at `text e`.
    expect(indentBlock(SAMPLE, 4, 6, 1, true)).toEqual({ first: 3, last: 6 });
  });

  it("adds the line that opens the block for 'a'", () => {
    expect(linesOf(SAMPLE, indentBlock(SAMPLE, 4, 4, 1, false))[0]).toBe('  frame b');
  });

  it('climbs one level per count', () => {
    expect(linesOf(SAMPLE, indentBlock(SAMPLE, 4, 4, 2, true))).toEqual([
      '  frame b',
      '    text c',
      '    text d',
      '',
      '    text e',
      '',
      '  frame f',
      '    text g',
    ]);
    expect(indentBlock(SAMPLE, 4, 4, 2, false)).toEqual({ first: 1, last: 9 });
  });

  it('stops climbing at the top level', () => {
    expect(indentBlock(SAMPLE, 4, 4, 9, true)).toEqual({ first: 1, last: 10 });
  });

  it('starts from the next line with text when the cursor is on a blank one', () => {
    expect(indentBlock(SAMPLE, 4, 5, 1, true)).toEqual({ first: 3, last: 6 });
    expect(indentBlock(doc('a', '  b', ''), 4, 3, 1, true)).toEqual({ first: 2, last: 2 });
  });

  it('counts a tab as the columns it reaches', () => {
    // A tab is four columns here, so `\tb` and `    c` are one level.
    expect(indentBlock(doc('a', '\tb', '    c', 'd'), 4, 2, 1, true)).toEqual({
      first: 2,
      last: 3,
    });
  });

  it('has nothing in a document without text', () => {
    expect(indentBlock(doc('', '  '), 4, 1, 1, true)).toBeUndefined();
  });
});

describe('entireSpan (TYTO-422)', () => {
  const padded = doc('', 'a', '', 'b', '  ');

  it("is every line for 'a'", () => {
    expect(entireSpan(padded, false)).toEqual({ first: 1, last: 5 });
  });

  it("leaves blank lines at either end out for 'i'", () => {
    expect(entireSpan(padded, true)).toEqual({ first: 2, last: 4 });
  });

  it("has no 'i' in a document without text", () => {
    expect(entireSpan(doc('', ' '), true)).toBeUndefined();
  });
});
