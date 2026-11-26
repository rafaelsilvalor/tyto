/**
 * Where a line of the house's text may break: the rules the one-image table (TYTO-218) and the
 * product banner (TYTO-210) share. Strings only — no measuring and no drawing.
 *
 * ## How a break is prevented
 *
 * Tyto's own layout decides every line break before an exporter sees the text, and **a break
 * opportunity is a space (U+0020) and only a space** (`packages/core/src/text/layout.ts`). So
 * a phrase that must never split is made of no such space: its inner spaces become no-break
 * spaces (U+00A0), which draw as a space and measure as one, and break nothing. That is the
 * whole mechanism — no hyphenation, no zero-width tricks, nothing an exporter has to agree to.
 *
 * Every rule here keeps the string's length: a space becomes a no-break space and nothing is
 * inserted or removed, so a caller that styled the text character by character can glue it
 * and still find each character's style at the same offset.
 */

import { breakPieces, endsOnFunctionWord as kitEndsOnFunctionWord } from '@tyto/template-kit';

/** The space that draws and measures as one and is never a line break. */
export const NO_BREAK_SPACE = ' ';

/**
 * A parenthesised group made whole, and joined to what comes before it when that ends in a
 * character `before` matches.
 *
 * `(GO)` and `(AP/PA)` read as one unit with the word they qualify: it never splits, and it
 * never starts a line on its own. The table passes a digit, so `R$ 33.820,39 (bruto)` keeps
 * its qualifier and `Concurso (2026)` still may break before the year's group; the banner
 * passes any letter, digit or closing mark.
 *
 * `maxWords` caps the groups this applies to: a longer one is left as written, free to break
 * between its words. The banner glues every group; the table only short ones (TYTO-775).
 */
export function glueParenthesised(text: string, before: RegExp, maxWords = Infinity): string {
  return text.replace(/ (\([^()]*\))/gu, (whole: string, group: string, offset: number) => {
    // A group of more words than this is a phrase, not a qualifier: gluing it whole would make
    // one piece as wide as a sentence, and the line around it could never be narrower.
    if (group.split(' ').length > maxWords) return whole;
    const previous = text[offset - 1] ?? '';
    const joins = previous !== '' && previous !== ' ' && before.test(previous);
    return `${joins ? NO_BREAK_SPACE : ' '}${group.replaceAll(' ', NO_BREAK_SPACE)}`;
  });
}

/**
 * The pieces a glued text may break between: what a line of it can never be narrower than.
 *
 * Split on the plain space only, as the layout breaks; an empty text has no pieces.
 */
export function pieces(glued: string): string[] {
  return breakPieces(glued);
}

/**
 * The short words a Portuguese line should not end on: articles, prepositions and their
 * contractions, and the conjunctions `e` and `ou`. A line that ends on one leaves the reader
 * holding half a phrase (`Prefeitura Municipal de / São Bento`).
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'a',
  'à',
  'ao',
  'aos',
  'as',
  'às',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'ou',
  'para',
  'por',
  'um',
  'uma',
]);

/**
 * Whether a line ending in this piece ends on a function word. Only the piece's last word
 * counts, and case does not.
 */
export function endsOnFunctionWord(piece: string): boolean {
  return kitEndsOnFunctionWord(piece, FUNCTION_WORDS, 'pt-BR');
}
