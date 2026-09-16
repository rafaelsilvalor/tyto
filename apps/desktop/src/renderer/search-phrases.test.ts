import { SEARCH_PHRASE_KEYS } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import { searchPhrasesFor } from './search-phrases.js';

/**
 * The seam between two tables nobody in this repository owns both halves of.
 *
 * `@codemirror/search` renders its words through `phrase("Find")`, so the English string is
 * the key and a missing entry **falls back to itself** — the panel would come up half in
 * Portuguese and half in English, with a green suite and nothing in the console. That is the
 * failure this file exists to make loud.
 *
 * It is also the coverage `e2e/window.desktop.test.ts` cannot give. That test counts
 * `[data-i18n]` elements against `CATALOGUE_KEYS`, and every key here goes on its
 * `NOT_ELEMENT_TEXT` list — the panel is CodeMirror's DOM, and it is not in the document
 * until somebody presses `Ctrl+F`.
 */
describe('the search phrases', () => {
  it('answer every key CodeMirror asks for, in both locales', () => {
    for (const locale of ['en', 'pt-BR'] as const) {
      const phrases = searchPhrasesFor(locale);

      for (const key of SEARCH_PHRASE_KEYS) {
        // Present *and* not the key itself. A mapping that pointed at a catalogue entry
        // holding the English would pass a presence check and show English.
        expect(phrases[key], `${locale} ${key}`).toBeTypeOf('string');
        expect(phrases[key], `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('say something different in the two languages, for every key', () => {
    // Every one of the seventeen, because a key left pointing at an English string is the
    // shape this mistake takes and it is invisible in the app: the panel simply reads a
    // little oddly to somebody working in Portuguese.
    const english = searchPhrasesFor('en');
    const portuguese = searchPhrasesFor('pt-BR');

    const identical = SEARCH_PHRASE_KEYS.filter((key) => english[key] === portuguese[key]);

    expect(identical).toEqual([]);
  });

  it('keep the $ CodeMirror substitutes, in both languages', () => {
    // `phrase("replaced $ matches", 3)` puts the count where the `$` is. A translation that
    // dropped it would announce "ocorrências substituídas" with no number, which is a worse
    // answer than the English it replaced.
    for (const locale of ['en', 'pt-BR'] as const) {
      const phrases = searchPhrasesFor(locale);

      expect(phrases['replaced $ matches'], locale).toContain('$');
      expect(phrases['replaced match on line $'], locale).toContain('$');
    }
  });
});
