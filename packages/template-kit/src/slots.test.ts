import { describe, expect, it } from 'vitest';

import { plain } from './rows.js';
import { richTextOf, slideRichLines, slotRichLines, slotText, trimmed } from './slots.js';

import type { RichText, TemplateContext } from '@tyto/core';

/**
 * The slot readers (TYTO-793): what the template repositories' copies did, now one function
 * each. A context carries only the slots these read.
 */

const range = { start: 0, end: 1 };
const textOf = (value: string): RichText => [{ kind: 'text', value, range }];
const brk = { kind: 'break', range } as const;
const linesOf = (values: readonly string[]): RichText =>
  values.flatMap((value, index) => [...(index === 0 ? [] : [brk]), ...textOf(value)]);

function contextOf(slots: Record<string, RichText | { kind: 'image' }>): TemplateContext {
  return {
    slots: Object.fromEntries(
      Object.entries(slots).map(([name, value]) => [
        name,
        {
          name,
          value: Array.isArray(value) ? { kind: 'rich-text', text: value } : value,
          adjustments: [],
        },
      ]),
    ),
  } as unknown as TemplateContext;
}

describe('the slot readers', () => {
  it('read a rich-text slot as written, and nothing for one unset or of another kind', () => {
    const context = contextOf({ titulo: textOf('Olá'), fundo: { kind: 'image' } });

    expect(richTextOf(context, 'titulo')).toEqual(textOf('Olá'));
    expect(richTextOf(context, 'chamada')).toBeUndefined();
    expect(richTextOf(context, 'fundo')).toBeUndefined();
  });

  it('give a slot’s words trimmed, and the fallback when they are unset or empty', () => {
    const context = contextOf({ titulo: textOf('  Olá  '), vazio: textOf('   ') });

    expect(slotText(context, 'titulo', 'x')).toBe('Olá');
    expect(slotText(context, 'vazio', 'x')).toBe('x');
    expect(slotText(context, 'nada', 'x')).toBe('x');
  });

  it('give a slide’s lines without the empty ones, from another slot when named', () => {
    const context = contextOf({
      lamina: linesOf(['Um', '  ', 'Dois']),
      outra: linesOf(['Três']),
    });

    expect(slideRichLines(context).map(plain)).toEqual(['Um', 'Dois']);
    expect(slideRichLines(context, 'outra').map(plain)).toEqual(['Três']);
    expect(slideRichLines(contextOf({}))).toEqual([]);
  });

  it('give a slot’s lines trimmed, bold read in flat text, and the fallback’s line when empty', () => {
    const context = contextOf({ chamada: linesOf(['  Comente **VAGAS**  ', ' ']) });
    const [line] = slotRichLines(context, 'chamada', 'x');

    expect(plain(line!)).toBe('Comente VAGAS');
    expect(line!.some((inline) => inline.kind !== 'text' && inline.kind !== 'break')).toBe(true);
    expect(slotRichLines(contextOf({}), 'chamada', 'Salve').map(plain)).toEqual(['Salve']);
    expect(slotRichLines(contextOf({}), 'chamada', '')).toEqual([]);
  });

  it('trim a line at both ends, dropping a text the trim empties', () => {
    expect(
      trimmed([...textOf(' '), ...textOf(' a '), ...textOf(' ')]).map((each) => each.kind),
    ).toEqual(['text']);
    expect(plain(trimmed(textOf('  a b  ')))).toBe('a b');
  });
});
