/**
 * Rich text for tests, with ranges nobody has to count out by hand. A fixture rather than a
 * helper inside one test file, so a second test file can import it without registering the
 * first file's cases twice.
 */

import type { Inline, RichText } from '@tyto/core';

let cursor = 0;

export function span(value: string): Inline {
  const start = cursor;
  cursor += value.length;
  return { kind: 'text', value, range: { start, end: cursor } };
}

/** Rich text from a string, with `\n` becoming the `Break` the language produces. */
export function rich(source: string): RichText {
  const parts: Inline[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) parts.push({ kind: 'break', range: { start: cursor, end: cursor++ } });
    parts.push(span(line));
  }
  return parts;
}

export function bold(value: string): Inline {
  const children = [span(value)];
  return { kind: 'bold', children, range: children[0]!.range };
}
