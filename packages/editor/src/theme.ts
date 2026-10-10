import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * The two themes the editor ships with.
 *
 * A theme here is two halves that always travel together: the chrome (background, gutter,
 * cursor, selection) and the syntax colours. They are exported as one `Extension` each
 * because a host that swapped one without the other would get dark text on a dark
 * background, and nothing in the type would have warned it.
 *
 * The tags are the ones `briefHighlighting` and `templateHighlighting` assign, in
 * `@tyto/brief-lang` and `@tyto/template-lang` — those two lists are the contract between
 * the grammars and this file. A tag styled here that neither grammar assigns renders
 * nothing; a node a grammar tags and this file ignores falls back to the editor's
 * foreground colour, which is legible but flat.
 *
 * **One palette serves both languages**, and four tags are shared outright —
 * `attributeName`, `attributeValue`, `definitionKeyword`, `punctuation`. That is the tag
 * vocabulary doing its job: neither grammar was written to match the other, and an
 * attribute name still looks like an attribute name in both.
 *
 * **The colours are the host's** (TYTO-96, ADR 0075). Every field below is a CSS custom
 * property the host defines — the desktop's `tokens.css`, for light and for dark — so the
 * window and the buffer are painted from one source and change together when the system
 * does, with no reconfiguration here.
 */

/** Named so each part of the buffer reads as the role it plays. */
interface Palette {
  readonly background: string;
  readonly foreground: string;
  readonly caret: string;
  readonly selection: string;
  /**
   * Translucent on purpose (TYTO-246). `drawSelection` paints the selection on a layer behind
   * the text, and the active line's background sits on the line element above that layer, so
   * an opaque colour here hides any selection on the cursor's line. The host's token is chosen
   * so that, over `background`, it composites to `activeLineGutter`.
   */
  readonly activeLine: string;
  /** The gutter has no selection under it, so it keeps the opaque colour. */
  readonly activeLineGutter: string;
  readonly gutterBackground: string;
  readonly gutterForeground: string;
  readonly frontmatter: string;
  readonly comment: string;
  readonly directiveName: string;
  readonly namespace: string;
  readonly punctuation: string;
  readonly attributeName: string;
  readonly attributeValue: string;
  readonly escape: string;
  // The template language's half (E8.4). A tag, a selector, a property and a bare word in
  // a value are all the same characters, and the grammar already decided which is which —
  // these are what make that decision visible.
  readonly tagName: string;
  readonly propertyName: string;
  readonly selectorClass: string;
  readonly selectorId: string;
  readonly keyword: string;
  readonly functionName: string;
  readonly literal: string;
  readonly string: string;
  readonly bracket: string;
}

/**
 * The custom property a role reads. A host that defines none of them gets an uncoloured
 * editor, which is visible, rather than a second palette that silently disagrees with its
 * window.
 */
const token = (role: string): string => `var(--tyto-${role})`;

/**
 * One palette for both themes, because the colours are no longer here.
 *
 * Twenty-five fields over fifteen roles: the fields that always had one colour in the dark
 * palette share a role, so a theme sets eight syntax colours rather than seventeen.
 */
export const palette: Palette = {
  background: token('surface'),
  foreground: token('text'),
  caret: token('accent'),
  selection: token('selection'),
  activeLine: token('active-line'),
  activeLineGutter: token('active-line-gutter'),
  gutterBackground: token('surface'),
  gutterForeground: token('text-disabled'),
  frontmatter: token('syntax-keyword'),
  comment: token('syntax-comment'),
  directiveName: token('syntax-function'),
  namespace: token('syntax-constant'),
  punctuation: token('syntax-punctuation'),
  attributeName: token('syntax-attribute'),
  attributeValue: token('syntax-string'),
  escape: token('syntax-tag'),
  tagName: token('syntax-tag'),
  propertyName: token('syntax-function'),
  selectorClass: token('syntax-attribute'),
  selectorId: token('syntax-keyword'),
  keyword: token('syntax-keyword'),
  functionName: token('syntax-function'),
  literal: token('syntax-constant'),
  string: token('syntax-string'),
  bracket: token('syntax-punctuation'),
};

const monoFont = token('font-mono');

/**
 * Every custom property the editor reads, for a host to define. The desktop's
 * `e2e/renderer-tokens.test.ts` holds its token file to this list, because a name nobody
 * defines drops the colour without a word — jsdom resolves no `var()`, so no test of the
 * editor alone could notice.
 */
export const themeTokens: readonly string[] = [
  ...new Set(
    [...Object.values(palette), monoFont].map((value) =>
      value.replace(/^var\((--[a-z0-9-]+)\)$/, '$1'),
    ),
  ),
];

const chrome = (colours: Palette, isDark: boolean): Extension =>
  EditorView.theme(
    {
      '&': {
        color: colours.foreground,
        backgroundColor: colours.background,
      },
      '.cm-content': {
        caretColor: colours.caret,
        fontFamily: monoFont,
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: colours.caret },
      // The first selector repeats CodeMirror's own base rule, chain and all, because with
      // anything shorter that rule wins on specificity whenever the editor is focused: a
      // person saw CodeMirror's lilac in light, and in dark a selection 4/18/12 per channel
      // above the background (TYTO-96, comment 1291677). At equal specificity a theme's rule
      // is mounted after the base theme's, and wins.
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        {
          backgroundColor: colours.selection,
        },
      '.cm-activeLine': { backgroundColor: colours.activeLine },
      '.cm-activeLineGutter': {
        backgroundColor: colours.activeLineGutter,
        color: colours.foreground,
      },
      '.cm-gutters': {
        backgroundColor: colours.gutterBackground,
        color: colours.gutterForeground,
        border: 'none',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: 'transparent',
        border: 'none',
        color: colours.gutterForeground,
      },
    },
    { dark: isDark },
  );

const syntax = (colours: Palette): HighlightStyle =>
  HighlightStyle.define([
    { tag: tags.meta, color: colours.frontmatter },
    // `tags.comment` and not `tags.lineComment`: the brief's `//` and the template's
    // `<!-- -->` are both comments, and one rule covering the parent tag styles both.
    { tag: tags.comment, color: colours.comment, fontStyle: 'italic' },

    { tag: tags.definitionKeyword, color: colours.directiveName, fontWeight: 'bold' },
    { tag: tags.namespace, color: colours.namespace },
    { tag: tags.punctuation, color: colours.punctuation },

    { tag: tags.attributeName, color: colours.attributeName },
    { tag: tags.attributeValue, color: colours.attributeValue },

    // Bold and italic are the one place the editor shows what the render will do rather
    // than what the source says, so they carry weight and slant and no colour of their own.
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },

    { tag: tags.escape, color: colours.escape },
    { tag: tags.processingInstruction, color: colours.punctuation },
    { tag: tags.separator, color: colours.punctuation },

    // The template language. `attributeName`, `attributeValue`, `definitionKeyword` and
    // `punctuation` above are shared with the brief — the two languages agreed on those
    // four without being made to, which is what the tag vocabulary is for.
    { tag: tags.tagName, color: colours.tagName },
    { tag: tags.propertyName, color: colours.propertyName },
    { tag: tags.className, color: colours.selectorClass },
    { tag: tags.labelName, color: colours.selectorId },
    { tag: tags.keyword, color: colours.keyword },
    { tag: tags.function(tags.variableName), color: colours.functionName },
    { tag: [tags.atom, tags.number, tags.color], color: colours.literal },
    { tag: tags.string, color: colours.string },
    { tag: [tags.angleBracket, tags.brace, tags.derefOperator], color: colours.bracket },
  ]);

/**
 * Light and dark differ only in CodeMirror's `dark` flag, which picks the base theme for the
 * parts this file does not style (the search panel, tooltips). The host flips it with
 * `setTheme` when the system does; the colours above follow the host's properties on their own.
 */
export const briefLightTheme: Extension = [
  chrome(palette, false),
  syntaxHighlighting(syntax(palette)),
];

export const briefDarkTheme: Extension = [
  chrome(palette, true),
  syntaxHighlighting(syntax(palette)),
];

/** The two names `createEditor` accepts, and what `setTheme` switches between. */
export type ThemeName = 'light' | 'dark';

export const themes: Readonly<Record<ThemeName, Extension>> = {
  light: briefLightTheme,
  dark: briefDarkTheme,
};
