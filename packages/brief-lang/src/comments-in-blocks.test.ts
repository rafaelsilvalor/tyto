import type { Diagnostics, RichText } from '@tyto/core';
import { isOk } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { parser } from './brief.parser.js';
import { parseBrief } from './parse-brief.js';

/**
 * A comment line inside an indented block is skipped, not the block's end (TYTO-680,
 * ADR 0204).
 *
 * The four rows are the card's measurement: a `::lamina` with one body line, a comment, and
 * two more body lines. Before this change the comment at column 0 closed the block and the
 * two lines after it became errors, and an indented comment was not a comment at all.
 */

/** The body as a person reads it: each line break a ` | `. */
function bodyText(body: RichText): string {
  return body
    .map((inline) => {
      if (inline.kind === 'text') return inline.value;
      if (inline.kind === 'break') return ' | ';
      return `<${inline.kind}>`;
    })
    .join('');
}

function parsed(text: string): { bodies: string[]; problems: Diagnostics } {
  const result = parseBrief(text);
  if (!isOk(result)) return { bodies: [], problems: result.error };
  return {
    bodies: result.value.directives.map((directive) => bodyText(directive.body)),
    problems: result.diagnostics,
  };
}

const FIRST = '::lamina {resposta}\n  O período é o dobro.\n';
const COMMENT = '//::imagem {sem-quadro} formula.png';
const WHOLE = 'O período é o dobro. | T = 40 ms | f = 25 Hz';

describe('a comment line between two body lines of the same block', () => {
  it.each([
    ['at column 0, the lines after it indented two spaces', `${COMMENT}\n`, '  '],
    ['at column 0, the lines after it indented one space', `${COMMENT}\n`, ' '],
    ['indented two spaces, the lines after it too', `  ${COMMENT}\n`, '  '],
    ['absent (control)', '', '  '],
  ])('is skipped and the block goes on: %s', (_, comment, indent) => {
    const text = `${FIRST}${comment}${indent}T = 40 ms\n${indent}f = 25 Hz\n`;

    expect(parsed(text)).toEqual({ bodies: [WHOLE], problems: [] });
  });

  it('is skipped between the head and the first body line', () => {
    expect(parsed('::lamina\n// a note\n  Linha um\n')).toEqual({
      bodies: ['Linha um'],
      problems: [],
    });
  });

  it('is skipped with blank lines and other comments around it', () => {
    const text = '::lamina\n  Um\n\n// a\n    // b\n\n  Dois\n';

    expect(parsed(text)).toEqual({ bodies: ['Um | Dois'], problems: [] });
  });

  it('keeps every line ending a person writes', () => {
    const text = '::lamina\r\n  Um\r\n// a\r\n  Dois\r\n';

    expect(parsed(text)).toEqual({ bodies: ['Um | Dois'], problems: [] });
  });
});

describe('a comment line that ends a block', () => {
  it('stays a comment at the top level when column 0 and a directive follows', () => {
    const text = '::lamina\n  Um\n// a\n::lamina\n  Dois\n';

    expect(parsed(text)).toEqual({ bodies: ['Um', 'Dois'], problems: [] });
    const top = parser.parse(text).topNode;
    expect(top.getChildren('Comment')).toHaveLength(1);
    expect(top.getChildren('Directive')[0]?.getChildren('Comment')).toEqual([]);
  });

  it('is a comment of the block when indented, even as its last line', () => {
    const text = '::lamina\n  Um\n  // a\n::lamina\n  Dois\n';

    expect(parsed(text)).toEqual({ bodies: ['Um', 'Dois'], problems: [] });
  });

  it('stays a comment at column 0 at the end of the file', () => {
    expect(parsed('::lamina\n  Um\n// a')).toEqual({ bodies: ['Um'], problems: [] });
  });

  it('does not turn a column-0 directive after a comment into body text', () => {
    const text = '::lamina\n  Um\n// a\n::titulo Dois\n';

    expect(parsed(text)).toEqual({ bodies: ['Um', 'Dois'], problems: [] });
  });
});

describe('the comment node', () => {
  it('covers only the `//` and what follows it, never the indent or the line break', () => {
    const text = '::lamina\n  Um\n    // a note\n  Dois\n';
    const comment = parser.parse(text).topNode.getChild('Directive')?.getChild('Comment');

    expect(comment === null || comment === undefined).toBe(false);
    expect(text.slice(comment?.from, comment?.to)).toBe('// a note');
  });
});

describe('a body line that really starts with `//`', () => {
  it('is written `\\//` and keeps its text', () => {
    const text = '::lamina\n  Um\n  \\// not a comment\n';

    expect(parsed(text)).toEqual({ bodies: ['Um | // not a comment'], problems: [] });
  });

  it('keeps `\\//` literal in an inline body too', () => {
    expect(parsed('::titulo a \\// b\n')).toEqual({ bodies: ['a // b'], problems: [] });
  });
});
