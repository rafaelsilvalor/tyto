import { describe, expect, it } from 'vitest';

import {
  compareRanges,
  createLineIndex,
  emptyRangeAt,
  isEmptyRange,
  lineColumnAt,
  lineColumnAtIndex,
  lineColumnRange,
  rangeContains,
  rangeContainsRange,
  rangeLength,
  rangesIntersect,
  sliceRange,
  sourceRange,
  unionRanges,
} from './range.js';

describe('sourceRange', () => {
  it('builds a span', () => {
    expect(sourceRange(3, 7)).toEqual({ start: 3, end: 7 });
  });

  it('allows an empty span, which is how a caret diagnostic points at one spot', () => {
    expect(isEmptyRange(emptyRangeAt(5))).toBe(true);
    expect(rangeLength(emptyRangeAt(5))).toBe(0);
  });

  it.each([
    ['negative start', -1, 4],
    ['inverted', 9, 2],
    ['fractional', 1.5, 4],
  ])('rejects an impossible span: %s', (_label, start, end) => {
    expect(() => sourceRange(start, end)).toThrow();
  });
});

describe('range predicates', () => {
  const span = sourceRange(4, 8);

  it('treats the span as half-open', () => {
    expect(rangeContains(span, 4)).toBe(true);
    expect(rangeContains(span, 7)).toBe(true);
    expect(rangeContains(span, 8)).toBe(false);
    expect(rangeContains(span, 3)).toBe(false);
  });

  it('still locates an empty range at its own offset', () => {
    expect(rangeContains(emptyRangeAt(4), 4)).toBe(true);
    expect(rangeContains(emptyRangeAt(4), 5)).toBe(false);
  });

  it('nests and intersects', () => {
    expect(rangeContainsRange(span, sourceRange(5, 7))).toBe(true);
    expect(rangeContainsRange(span, sourceRange(5, 9))).toBe(false);
    expect(rangesIntersect(span, sourceRange(7, 12))).toBe(true);
    expect(rangesIntersect(span, sourceRange(8, 12))).toBe(false);
  });

  it('unions across a gap', () => {
    expect(unionRanges(sourceRange(1, 2), sourceRange(9, 10))).toEqual({ start: 1, end: 10 });
  });

  it('orders by start, then by end', () => {
    const ranges = [sourceRange(5, 6), sourceRange(1, 9), sourceRange(1, 3)];
    expect([...ranges].sort(compareRanges)).toEqual([
      { start: 1, end: 3 },
      { start: 1, end: 9 },
      { start: 5, end: 6 },
    ]);
  });

  it('slices the text it describes', () => {
    expect(sliceRange('::titulo Direito', sourceRange(2, 8))).toBe('titulo');
  });
});

describe('line and column', () => {
  const text = 'one\ntwo\nthree';

  it('is one-based on both axes', () => {
    expect(lineColumnAt(text, 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumnAt(text, 4)).toEqual({ line: 2, column: 1 });
    expect(lineColumnAt(text, 6)).toEqual({ line: 2, column: 3 });
  });

  it('puts the newline itself at the end of the line it terminates', () => {
    expect(lineColumnAt(text, 3)).toEqual({ line: 1, column: 4 });
  });

  it('counts CRLF once', () => {
    expect(lineColumnAt('a\r\nb', 3)).toEqual({ line: 2, column: 1 });
  });

  it('treats a lone CR as a line break', () => {
    expect(lineColumnAt('a\rb', 2)).toEqual({ line: 2, column: 1 });
  });

  it('clamps past the end rather than reporting a position that does not exist', () => {
    expect(lineColumnAt(text, 999)).toEqual({ line: 3, column: 6 });
  });

  it('handles an empty source', () => {
    expect(lineColumnAt('', 0)).toEqual({ line: 1, column: 1 });
  });

  it('converts a whole range', () => {
    expect(lineColumnRange(text, sourceRange(4, 9))).toEqual({
      start: { line: 2, column: 1 },
      end: { line: 3, column: 2 },
    });
  });

  it('gives the same answer through a reused index as through a one-off scan', () => {
    const index = createLineIndex(text);
    for (let offset = 0; offset <= text.length; offset += 1) {
      expect(lineColumnAtIndex(index, offset)).toEqual(lineColumnAt(text, offset));
    }
  });
});
