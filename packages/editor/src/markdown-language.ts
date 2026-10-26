import {
  Language,
  LanguageSupport,
  defineLanguageFacet,
  languageDataProp,
} from '@codemirror/language';
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
const data = defineLanguageFacet({ commentTokens: { block: { open: '<!--', close: '-->' } } });

/**
 * The facet rides on the tree's top node, which is where CodeMirror looks for a language's data:
 * a bare `Language` attaches nothing itself, and without it `toggleComment` found no comment
 * tokens and did nothing (TYTO-418, measured in the window and in `vim-comment.test.ts`).
 */
export const markdownParser = parser.configure([
  GFM,
  { props: [languageDataProp.add({ Document: data })] },
]);

export const markdownLanguage = new Language(data, markdownParser, [], 'markdown');

export const markdown = (): LanguageSupport => new LanguageSupport(markdownLanguage);
