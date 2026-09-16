import { SEARCH_PHRASE_KEYS, type SearchPhraseKey, type SearchPhrases } from '@tyto/editor';

import { type CatalogueKey } from '../../shared/i18n/catalogue.js';
import { type Locale, translate } from '../../shared/i18n/index.js';

/**
 * The catalogue key behind every word `@codemirror/search` puts on screen.
 *
 * Two tables meet here and neither is this app's to rename. The left-hand side is
 * CodeMirror's: `phrase("match case")` looks up the literal `"match case"`, so the strings
 * *are* the keys and a typo shows English on a Portuguese screen rather than failing. The
 * right-hand side is the catalogue's, which spells keys `search.matchCase` because that is
 * how every other key in this app is spelled.
 *
 * Written out rather than derived, because deriving would mean inventing a rule that turns
 * `"replaced match on line $"` into `search.replacedOnLine` — and a rule that has to handle
 * that has more ways to be wrong than seventeen lines do.
 *
 * `search-phrases.test.ts` holds this to `SEARCH_PHRASE_KEYS`, which is the list
 * `@tyto/editor` exports after reading them out of the installed package. A key CodeMirror
 * adds in a later version fails that test rather than appearing in English.
 */
const CATALOGUE_FOR: Readonly<Record<SearchPhraseKey, CatalogueKey>> = {
  Find: 'search.find',
  Replace: 'search.replace',
  next: 'search.next',
  previous: 'search.previous',
  all: 'search.all',
  'match case': 'search.matchCase',
  regexp: 'search.regexp',
  'by word': 'search.byWord',
  replace: 'search.replaceOne',
  'replace all': 'search.replaceAll',
  close: 'search.close',
  'Go to line': 'search.gotoLine',
  go: 'search.go',
  'current match': 'search.currentMatch',
  'on line': 'search.onLine',
  'replaced match on line $': 'search.replacedOnLine',
  'replaced $ matches': 'search.replacedCount',
};

/**
 * What the search panel says, in one locale.
 *
 * Built fresh on every locale change rather than held: it is seventeen string lookups, and
 * a cached copy would be one more thing that can disagree with the catalogue.
 */
export const searchPhrasesFor = (locale: Locale): SearchPhrases =>
  Object.fromEntries(
    SEARCH_PHRASE_KEYS.map((key) => [key, translate(locale, CATALOGUE_FOR[key])]),
  ) as SearchPhrases;
