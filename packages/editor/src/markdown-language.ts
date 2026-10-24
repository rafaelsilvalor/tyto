import { Language, LanguageSupport, defineLanguageFacet } from '@codemirror/language';
import { GFM, parser } from '@lezer/markdown';

/**
 * Markdown, coloured — the language of a `.md` tab in the desktop (TYTO-247, ADR 0132).
 *
 * `@lezer/markdown` directly, wrapped in a `Language` of a few lines, and not
 * `@codemirror/lang-markdown`: that package also brings `lang-html`, `lang-css` and
 * `lang-javascript` to colour code blocks and raw HTML, three grammars for what a note in a
 * campaign folder rarely holds. The parser already carries its highlight tags (`heading1`…,
 * `emphasis`, `strong`, `link`, `url`, `monospace`, `quote`), which `theme.ts` styles.
 *
 * GitHub's extensions are on — tables, strikethrough, task lists and bare links — by Rafael's
 * decision of 2026-10-24. The preview's {@link markdownToHtml} reads the tree of this same
 * parser, so what is coloured as a table is what is drawn as one.
 */
export const markdownParser = parser.configure(GFM);

const data = defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } });

export const markdownLanguage = new Language(data, markdownParser, [], 'markdown');

export const markdown = (): LanguageSupport => new LanguageSupport(markdownLanguage);
