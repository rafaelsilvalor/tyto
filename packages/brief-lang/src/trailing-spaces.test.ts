import { isOk, sliceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { type Inline } from './index.js';
import { parseBrief } from './parse-brief.js';

/**
 * Spaces and tabs at the end of a line of text say nothing (TYTO-297, ADR 0096).
 *
 * Before: `Profª. Mara Rebeiro  ` reached the Scene as a `TextSpan` with its two spaces, and a
 * centred line was drawn a little left of the centre. Nobody can see them in the editor, so
 * they cannot be what the author meant.
 */

function bodyOf(text: string): readonly Inline[] {
  const result = parseBrief(text);
  if (!isOk(result)) throw new Error(result.error.map((item) => item.message).join('; '));
  expect(result.diagnostics).toEqual([]);
  const [directive] = result.value.directives;
  if (directive === undefined) throw new Error('no directive');
  return directive.body;
}

const values = (body: readonly Inline[]) =>
  body.map((inline) => (inline.kind === 'text' ? inline.value : `<${inline.kind}>`));

describe('trailing spaces at the end of a line of text', () => {
  it('are dropped from an inline body', () => {
    expect(values(bodyOf('::titulo Mara Rebeiro  \n'))).toEqual(['Mara Rebeiro']);
    expect(values(bodyOf('::titulo Mara Rebeiro\t \t'))).toEqual(['Mara Rebeiro']);
  });

  it('are dropped from every line of a block, with CRLF too', () => {
    const text = '::lamina\r\n  ORTOPEDISTA  \r\n  Profª. Mara Rebeiro \t\r\n';
    expect(values(bodyOf(text))).toEqual(['ORTOPEDISTA', '<break>', 'Profª. Mara Rebeiro']);
  });

  it('leave a range that covers only the text that stays', () => {
    const text = '::titulo Mara Rebeiro   \n';
    const [first] = bodyOf(text);
    expect(first?.kind).toBe('text');
    if (first?.kind !== 'text') return;
    expect(sliceRange(text, first.range)).toBe('Mara Rebeiro');
  });

  it('after a hard break are dropped, the break kept', () => {
    expect(values(bodyOf('::subtitulo Primeira\\   \n'))).toEqual(['Primeira', '<break>']);
  });

  it('after a mark or bold are dropped, the markup kept', () => {
    expect(values(bodyOf('::titulo **Um**   \n'))).toEqual(['<bold>']);
    expect(values(bodyOf('::titulo Um {cor:laranja}dois{/}  \n'))).toEqual(['Um ', '<mark>']);
  });

  it('are not touched inside a line: before a break, or between words', () => {
    expect(values(bodyOf('::subtitulo Primeira  \\\n'))).toEqual(['Primeira  ', '<break>']);
    expect(values(bodyOf('::titulo a   b\n'))).toEqual(['a   b']);
  });

  it('inside bold at the end of a line are the bold’s own', () => {
    const [bold] = bodyOf('::titulo **Um  **\n');
    expect(bold?.kind).toBe('bold');
    if (bold?.kind !== 'bold') return;
    expect(values(bold.children)).toEqual(['Um  ']);
  });
});
