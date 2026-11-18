import { isOk } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { type Inline } from './index.js';
import { parseBrief } from './parse-brief.js';

/**
 * A lone `*` that nothing on its line closes is a literal asterisk (TYTO-775, ADR 0213).
 *
 * Before: `R$ 4.143,06*` in a table cell and a footnote line `*Valores de referência` were each
 * `E_SYNTAX`, "an italic run is missing its closing *", and the brief rendered nothing.
 */

function bodyOf(text: string): readonly Inline[] {
  const result = parseBrief(text);
  if (!isOk(result)) throw new Error(result.error.map((item) => item.message).join('; '));
  expect(result.diagnostics).toEqual([]);
  const [directive] = result.value.directives;
  if (directive === undefined) throw new Error('no directive');
  return directive.body;
}

/** The body as text, emphasis written `<italic>…</italic>`, a break as `/`. */
function shown(body: readonly Inline[]): string {
  return body
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
          return inline.value;
        case 'break':
          return '/';
        case 'formula':
          return '$formula$';
        default:
          return `<${inline.kind}>${shown(inline.children)}</${inline.kind}>`;
      }
    })
    .join('');
}

describe('a lone * nothing on its line closes', () => {
  it('is the character at the end of a value', () => {
    expect(shown(bodyOf('::titulo R$ 4.143,06*\n'))).toBe('R$ 4.143,06*');
  });

  it('is the character at the start of a block line, as a footnote is written', () => {
    const text = '::tabela\n  A | B\n  x | y*\n  *Valores de referência. CR = cadastro.\n';
    expect(shown(bodyOf(text))).toBe('A | B/x | y*/*Valores de referência. CR = cadastro.');
  });

  it('is the character on its own, with spaces round it', () => {
    expect(shown(bodyOf('::titulo 5 * 3\n'))).toBe('5 * 3');
  });

  it('is the character inside bold', () => {
    expect(shown(bodyOf('::titulo **R$ 10* ao mês** e mais\n'))).toBe(
      '<bold>R$ 10* ao mês</bold> e mais',
    );
  });
});

describe('a * a later one on its line closes', () => {
  it('is still italic, which is the control', () => {
    expect(shown(bodyOf('::titulo Direito *Administrativo*\n'))).toBe(
      'Direito <italic>Administrativo</italic>',
    );
  });

  it('is italic, and a third lone star after the pair is the character', () => {
    expect(shown(bodyOf('::titulo *nota* importante*\n'))).toBe(
      '<italic>nota</italic> importante*',
    );
  });

  it('never pairs with a star on the next line: an italic run stays on its line', () => {
    const text = '::tabela\n  x | y*\n  *Nota.\n';
    expect(shown(bodyOf(text))).toBe('x | y*/*Nota.');
  });
});
