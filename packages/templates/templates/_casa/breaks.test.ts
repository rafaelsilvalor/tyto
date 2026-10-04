import { describe, expect, it } from 'vitest';

import { NO_BREAK_SPACE, endsOnFunctionWord, glueParenthesised, pieces } from './breaks.js';

/** The glued text with its no-break spaces written as `~`, so a case reads at a glance. */
const shown = (text: string): string => text.replaceAll(NO_BREAK_SPACE, '~');

const ANY_WORD = /[\p{L}\p{N})]/u;

describe('a parenthesised group', () => {
  it('joins the word before it, so `(GO)` never starts a line alone', () => {
    const glued = glueParenthesised('São Bento do Vale Alto (VA)', ANY_WORD);

    expect(shown(glued)).toBe('São Bento do Vale Alto~(VA)');
    expect(pieces(glued).at(-1)).toBe(`Alto${NO_BREAK_SPACE}(VA)`);
  });

  it('never splits inside, however many words it holds', () => {
    expect(shown(glueParenthesised('Tribunal (Região Norte e Sul)', ANY_WORD))).toBe(
      'Tribunal~(Região~Norte~e~Sul)',
    );
  });

  it('joins only what `before` admits, and is whole either way', () => {
    expect(shown(glueParenthesised('R$ 10 (bruto)', /\d/u))).toBe('R$ 10~(bruto)');
    expect(shown(glueParenthesised('Concurso (a definir)', /\d/u))).toBe('Concurso (a~definir)');
  });

  it('keeps the text’s length, so a style per character still lines up', () => {
    const text = 'Prefeitura (GO) e Câmara (SP)';
    expect(glueParenthesised(text, ANY_WORD)).toHaveLength(text.length);
  });
});

describe('a function word', () => {
  it('is a line’s last word when it is the piece’s last word, in any case', () => {
    expect(endsOnFunctionWord('de')).toBe(true);
    expect(endsOnFunctionWord('Do')).toBe(true);
    expect(endsOnFunctionWord(`Municipal${NO_BREAK_SPACE}de`)).toBe(true);
    expect(endsOnFunctionWord('Municipal')).toBe(false);
    expect(endsOnFunctionWord(`de${NO_BREAK_SPACE}São`)).toBe(false);
  });
});
