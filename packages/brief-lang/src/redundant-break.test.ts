import type { Diagnostics, RichText } from '@tyto/core';
import { isOk, sliceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { parseBrief } from './parse-brief.js';

/**
 * A `\` ending a line with another block line after it (TYTO-330, ADR 0109).
 *
 * Every line of an indented block already starts a new line, so a `\` at the end of one used
 * to stack a second break on the first — an empty line in the artwork. One `\` is dropped
 * and `W_REDUNDANT_BREAK` says why; `\\` keeps the one break the author asked for on top of
 * the line's own. Where no block line follows, a `\` is the only thing breaking the line and
 * keeps today's meaning, with nothing to warn about.
 */

function parsed(text: string): { body: RichText; problems: Diagnostics } {
  const result = parseBrief(text);
  if (!isOk(result)) throw new Error(result.error.map((item) => item.message).join('; '));
  const [directive] = result.value.directives;
  if (directive === undefined) throw new Error('no directive parsed');
  return { body: directive.body, problems: result.diagnostics };
}

const kinds = (body: RichText): string[] => body.map((inline) => inline.kind);

const texts = (body: RichText): string[] =>
  body.flatMap((inline) => (inline.kind === 'text' ? [inline.value] : []));

const redundant = (problems: Diagnostics) =>
  problems.filter((problem) => problem.code === 'W_REDUNDANT_BREAK');

const asCrLf = (text: string) => text.replaceAll('\n', '\r\n');

describe.each([
  ['LF', (text: string) => text],
  ['CRLF', asCrLf],
])('a backslash ending a line before another block line (%s)', (_name, ending) => {
  it('breaks once inside a block, and warns on the backslash', () => {
    const source = ending('::t\n  a\\\n  b');
    const { body, problems } = parsed(source);

    expect(kinds(body)).toEqual(['text', 'break', 'text']);
    expect(texts(body)).toEqual(['a', 'b']);
    const warnings = redundant(problems);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe('warning');
    expect(sliceRange(source, warnings[0]!.range!)).toBe('\\');
    expect(warnings[0]!.range!.start).toBe(source.indexOf('\\'));
  });

  it('breaks once after an inline head with a block under it', () => {
    const source = ending('::t a\\\n  b');
    const { body, problems } = parsed(source);

    expect(kinds(body)).toEqual(['text', 'break', 'text']);
    expect(texts(body)).toEqual(['a', 'b']);
    expect(redundant(problems).map((item) => sliceRange(source, item.range!))).toEqual(['\\']);
  });

  it('takes the spaces in front of the dropped backslash with it', () => {
    const { body } = parsed(ending('::t\n  a  \\\n  b'));

    expect(texts(body)).toEqual(['a', 'b']);
  });

  it('keeps one empty line for two backslashes, and warns once', () => {
    const source = ending('::t\n  a\\\\\n  b');
    const { body, problems } = parsed(source);

    expect(kinds(body)).toEqual(['text', 'break', 'break', 'text']);
    const warnings = redundant(problems);
    expect(warnings).toHaveLength(1);
    // The second of the two is the one dropped: it is the one the line ended in.
    expect(warnings[0]!.range!.start).toBe(source.indexOf('\\') + 1);
  });

  it('keeps a backslash on the last line of a block, and says nothing', () => {
    const { body, problems } = parsed(ending('::t\n  a\n  b\\'));

    expect(kinds(body)).toEqual(['text', 'break', 'text', 'break']);
    expect(problems).toEqual([]);
  });

  it('keeps a backslash ending an inline body with no block, and says nothing', () => {
    const { body, problems } = parsed(ending('::t a\\'));

    expect(kinds(body)).toEqual(['text', 'break']);
    expect(problems).toEqual([]);
  });

  it('keeps a backslash in the middle of a line, and says nothing', () => {
    const { body, problems } = parsed(ending('::t\n  a\\b\n  c'));

    expect(kinds(body)).toEqual(['text', 'break', 'text', 'break', 'text']);
    expect(problems).toEqual([]);
  });
});
