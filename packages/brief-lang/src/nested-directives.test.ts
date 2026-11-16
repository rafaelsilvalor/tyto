import type { RichText } from '@tyto/core';
import { isOk } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { parser } from './brief.parser.js';
import { parseBrief } from './parse-brief.js';

/**
 * An indented `::` line is a directive like one at column 0 (TYTO-709, ADR 0207).
 *
 * Until this card it was literal body text: `::lamina` / `  Linha um` / `  ::imagem ./a.png`
 * was one lamina whose body ended in `::imagem ./a.png` (ADR 0202's measurement). The parse
 * stays a flat list of directives; which one sits inside which is `resolve`'s, from the
 * manifest. These cases pin that the indent changes nothing in that list.
 */

function bodyText(body: RichText): string {
  return body
    .map((inline) => {
      if (inline.kind === 'text') return inline.value;
      if (inline.kind === 'break') return inline.paragraph === true ? ' ¶ ' : ' | ';
      return `<${inline.kind}>`;
    })
    .join('');
}

interface Parsed {
  readonly directives: readonly string[];
  readonly codes: readonly string[];
}

function parsed(text: string): Parsed {
  const result = parseBrief(text);
  if (!isOk(result)) return { directives: [], codes: result.error.map((item) => item.code) };
  return {
    directives: result.value.directives.map(
      (directive) => `${directive.name}: ${bodyText(directive.body)}`,
    ),
    codes: result.diagnostics.map((item) => item.code),
  };
}

/** Every leading space and tab removed, from every line. */
function unindented(text: string): string {
  return text.replaceAll(/^[ \t]+/gmu, '');
}

describe('an indented :: line', () => {
  it('is a directive: the card’s lamina with an indented ::imagem', () => {
    expect(parsed('::lamina\n  Linha um\n  ::imagem ./a.png\n')).toEqual({
      directives: ['lamina: Linha um', 'imagem: ./a.png'],
      codes: [],
    });
  });

  it.each([
    ['three levels, each indented one more', '::lamina\n  ::bloco\n    ::paragrafo Texto\n'],
    [
      'body lines between levels',
      '::lamina\n  Abertura\n  ::bloco Um\n    ::paragrafo\n      Dois\n',
    ],
    ['a blank line before the indented ::', '::lamina\n  Abertura\n\n  ::bloco Um\n'],
    ['a tab indent', '::lamina\n\t::bloco Um\n\t\t::paragrafo Dois\n'],
    ['the first line of the file indented', '  ::lamina Um\n  ::bloco Dois\n'],
    ['after the frontmatter', '---\ntemplate: t\n---\n  ::lamina Um\n'],
    ['after a top-level comment', '// nota\n  ::lamina Um\n'],
    ['a brief-wide slot under a lamina', '::lamina\n  Corpo\n  ::titulo Título\n'],
    ['CRLF line ends', '::lamina\r\n  Corpo\r\n  ::bloco Um\r\n'],
  ])('%s parses as the same brief with every indent removed', (_name, text) => {
    const nested = parsed(text);
    expect(nested.codes).toEqual([]);
    expect(nested).toEqual(parsed(unindented(text)));
  });

  it('leaves an escaped \\:: as text, at any indent', () => {
    expect(parsed('::lamina\n  \\::imagem é texto\n')).toEqual({
      directives: ['lamina: ::imagem é texto'],
      codes: [],
    });
  });

  it('leaves an indented // a comment of the block it is in (ADR 0204)', () => {
    expect(parsed('::lamina\n  Um\n  // ::bloco nada\n  Dois\n  ::bloco Três\n')).toEqual({
      directives: ['lamina: Um | Dois', 'bloco: Três'],
      codes: [],
    });
  });

  it('ends the block for a column-0 comment the block would otherwise keep', () => {
    // A column-0 `//` belongs to the block only when the block goes on after it; an indented
    // `::` next does not go on, so the comment is a top-level one and the lamina ends at `Um`.
    const tree = parser.parse('::lamina\n  Um\n// nota\n  ::bloco Dois\n');
    const top: string[] = [];
    const cursor = tree.topNode.cursor();
    if (cursor.firstChild()) {
      do if (cursor.name !== 'BlankLine') top.push(cursor.name);
      while (cursor.nextSibling());
    }
    expect(top).toEqual(['Directive', 'Comment', 'Directive']);
  });

  it('still reports text before the first directive at an indent', () => {
    expect(parsed('  texto solto\n::lamina Um\n').codes).toContain('E_SYNTAX');
  });
});
