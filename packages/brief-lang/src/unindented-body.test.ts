import type { Diagnostics, RichText } from '@tyto/core';
import { isOk } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { formatBrief } from './format-brief.js';
import { parser } from './brief.parser.js';
import { parseBrief } from './parse-brief.js';

/**
 * A text line at column 0 is a body line of the directive above (TYTO-708, ADR 0202).
 *
 * Indentation never changes what a brief compiles to. Before this change `::lamina` /
 * `Linha um` / `Linha dois` gave an empty lamina, an invented directive `::Linha` with the body
 * `um`, and three `E_SYNTAX`. The Scene-level contract — the unindented brief draws what its
 * indented twin draws — is in `template-kit`'s `unindented-body.test.ts`; this file pins the
 * parse, case by case.
 */

/** The body as a person reads it: a line break ` | `, a paragraph ` ¶ `. */
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

/** The same brief with every line under a directive indented two spaces. */
function indented(text: string): string {
  return text.replaceAll(/^(?!::|$)/gmu, '  ');
}

describe('a text line at column 0 under a directive', () => {
  it.each([
    ['the card’s three-line lamina', '::lamina\nLinha um\nLinha dois\n'],
    [
      'a blank line between two lines: one lamina, two paragraphs',
      '::lamina\nLinha um\n\nLinha dois\n',
    ],
    ['a head with text of its own', '::titulo Direito\nConstitucional\n'],
    ['a formula opening the line', '::lamina\n$x^2$ é o quadrado\n'],
    ['an escaped directive opening the line', '::lamina\n\\::lamina é texto\n'],
    ['an escaped comment opening the line', '::lamina\n\\// também\n'],
    ['bold and a mark opening lines', '::lamina\n**Um**\n{cor:azul}dois{/}\n'],
    ['two directives in a row', '::lamina\nUm\n::lamina\nDois\n'],
  ])('parses as its indented twin: %s', (_, text) => {
    expect(parsed(text)).toEqual(parsed(indented(text)));
    expect(parsed(text).codes).toEqual([]);
  });

  it('is the body of the directive above, line by line', () => {
    expect(parsed('::lamina\nLinha um\nLinha dois\n')).toEqual({
      directives: ['lamina: Linha um | Linha dois'],
      codes: [],
    });
  });

  it('after a blank line is a paragraph of the same block (ADR 0205)', () => {
    expect(parsed('::lamina\nLinha um\n\nLinha dois\n').directives).toEqual([
      'lamina: Linha um ¶ Linha dois',
    ]);
  });

  it('continues the inline text of the head on a new line', () => {
    expect(parsed('::titulo Direito\nConstitucional\n').directives).toEqual([
      'titulo: Direito | Constitucional',
    ]);
  });

  it('mixes with indented lines in one block', () => {
    expect(parsed('::lamina\nUm\n  Dois\nTrês\n').directives).toEqual(['lamina: Um | Dois | Três']);
  });

  it('keeps every line ending a person writes, and a last line with none', () => {
    expect(parsed('::lamina\r\nUm\rDois\r\nTrês').directives).toEqual(['lamina: Um | Dois | Três']);
  });

  it('is a BodyLine of the directive in the tree', () => {
    const top = parser.parse('::lamina\nUm\n').topNode;
    expect(top.getChildren('Directive')[0]?.getChildren('BodyLine')).toHaveLength(1);
  });
});

describe('what stays as it was', () => {
  it('text before the first directive is still an error', () => {
    expect(parsed('Antes\n::lamina\nUm\n').codes).toContain('E_SYNTAX');
  });

  it('a `::` at column 0 still starts a directive', () => {
    expect(parsed('::lamina\nUm\n::titulo Dois\n').directives).toEqual([
      'lamina: Um',
      'titulo: Dois',
    ]);
  });

  it('a column-0 comment above a directive still belongs to no block', () => {
    const text = '::lamina\nUm\n// a\n::lamina\nDois\n';
    expect(parsed(text).directives).toEqual(['lamina: Um', 'lamina: Dois']);
    const top = parser.parse(text).topNode;
    expect(top.getChildren('Comment')).toHaveLength(1);
  });
});

describe('a column-0 comment followed by column-0 text (ADR 0204, note of 2026-11-16)', () => {
  it('is skipped, and the block goes on', () => {
    expect(parsed('::lamina\n// x\nTexto\n')).toEqual({ directives: ['lamina: Texto'], codes: [] });
  });

  it('is skipped between two column-0 lines, with no paragraph', () => {
    expect(parsed('::lamina\nUm\n// x\nDois\n').directives).toEqual(['lamina: Um | Dois']);
  });

  it('belongs to the directive in the tree', () => {
    const top = parser.parse('::lamina\n// x\nTexto\n').topNode;
    expect(top.getChildren('Comment')).toEqual([]);
    expect(top.getChildren('Directive')[0]?.getChildren('Comment')).toHaveLength(1);
  });
});

describe('W_LIKELY_DIRECTIVE', () => {
  it('warns about a column-0 line that starts with a single `:` and a name, and keeps it as text', () => {
    const result = parseBrief('::lamina\nUm\n:titulo Dois\n');
    if (!isOk(result)) throw new Error('expected the brief to parse');
    expect(result.value.directives.map((item) => bodyText(item.body))).toEqual([
      'Um | :titulo Dois',
    ]);
    const warnings: Diagnostics = result.diagnostics.filter(
      (item) => item.code === 'W_LIKELY_DIRECTIVE',
    );
    expect(warnings.map((item) => [item.message, item.range])).toEqual([
      ["':titulo Dois' is read as text; a directive starts with ::.", { start: 12, end: 24 }],
    ]);
  });

  it.each([
    ['an indented one', '::lamina\n  :titulo X\n'],
    ['a colon and a space', '::lamina\n: nota\n'],
    ['a colon and a sign', '::lamina\n:)\n'],
    ['a colon in the middle of a line', '::lamina\nHora: 20h\n'],
    ['the inline text of a head', '::lamina :titulo X\n'],
  ])('stays silent for %s', (_, text) => {
    expect(parsed(text).codes).toEqual([]);
  });
});

describe('Format Brief', () => {
  it('indents a column-0 body line like any other, and the meaning stays', () => {
    const text = '::lamina\nUm\n\nDois\n// x\nTrês\n';
    const result = formatBrief(text, { indentUnit: 2 });
    if (!result.ok) throw new Error('expected the brief to format');
    expect(result.value).toBe('::lamina\n  Um\n\n  Dois\n  // x\n  Três\n');
    expect(parsed(result.value)).toEqual(parsed(text));
  });
});
