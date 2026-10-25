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
   * so that, over `background`, it composites to `activeLineGutter`. Since TYTO-414 the line is
   * shaded only while nothing is selected, so no selection is under it any more; the token is
   * kept as it is, since it still composites to the gutter's colour.
   */
  readonly activeLine: string;
  /** The gutter has no selection under it, so it keeps the opaque colour. */
  readonly activeLineGutter: string;
  readonly gutterBackground: string;
  readonly gutterForeground: string;
  /** A guide per indent level, and the one of the block holding the cursor (TYTO-293). */
  readonly indentGuide: string;
  readonly indentGuideActive: string;
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
  // Markdown's half (TYTO-247): a heading, a link's label and its address, code, a quote.
  readonly heading: string;
  readonly link: string;
  readonly url: string;
  readonly code: string;
  readonly quote: string;
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
 * Thirty fields over fifteen roles: the fields that always had one colour in the dark
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
  indentGuide: token('indent-guide'),
  indentGuideActive: token('indent-guide-active'),
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
  heading: token('syntax-function'),
  link: token('syntax-keyword'),
  url: token('syntax-string'),
  code: token('syntax-constant'),
  quote: token('syntax-comment'),
};

export const monoFont = token('font-mono');

/**
 * The editor's text size (TYTO-272, ADR 0099): the host's code base, the `codeFontSize` setting
 * in the desktop. Every buffer reads it — briefs, JSON tabs, the template buffers — and so does
 * what CodeMirror draws inside the editor without a size of its own: the gutter, the pinned head
 * lines and the completion list.
 */
export const codeSize = token('code-size');

/**
 * The roles CodeMirror's own furniture reads: the search panel, the completion list, the lint
 * tooltip and the underlines under a diagnostic (TYTO-258, ADR 0081). Named by the part they
 * paint, like `palette`, and every value one custom property — sizes and widths included, so
 * nothing here is a literal a theme could not reach.
 */
export const panels = {
  /** The panel above the buffer and every tooltip: raised, flat, one hairline. */
  surface: token('surface-raised'),
  text: token('text'),
  muted: token('text-muted'),
  line: token('hairline'),
  lineWidth: token('hairline-width'),
  radius: token('radius-sm'),
  textSize: token('text-sm'),
  /** A text field and a button sit on the buffer's surface, inside a field's border. */
  field: token('surface'),
  fieldBorder: token('border'),
  focusRing: token('focus-ring'),
  focusWidth: token('focus-width'),
  hover: token('hover'),
  pressed: token('button-on'),
  accent: token('accent'),
  accentText: token('accent-text'),
  /** The characters of a completion that matched what was typed. */
  strong: token('weight-strong'),
  /** The selected completion is quiet: the selection's colour, the text's own colour on it. */
  selected: token('selection'),
  error: token('error'),
  warning: token('warning'),
  info: token('info'),
  /** The bar at the left of a diagnostic in its tooltip. */
  barWidth: token('space-2'),
  paddingBlock: token('space-1'),
  paddingInline: token('space-2'),
} as const;

/** The custom property a `var(--tyto-…)` value names. */
const propertyOf = (value: string): string => value.replace(/^var\((--[a-z0-9-]+)\)$/, '$1');

/**
 * Every custom property the editor reads, for a host to define. The desktop's
 * `e2e/renderer-tokens.test.ts` holds its token file to this list, because a name nobody
 * defines drops the colour without a word — jsdom resolves no `var()`, so no test of the
 * editor alone could notice.
 */
export const themeTokens: readonly string[] = [
  ...new Set(
    [...Object.values(palette), ...Object.values(panels), monoFont, codeSize].map(propertyOf),
  ),
];

const border = (width: string, colour: string): string => `${width} solid ${colour}`;
const hairline = border(panels.lineWidth, panels.line);

/**
 * CodeMirror's panels, tooltips and diagnostics, painted from the tokens.
 *
 * **Every selector repeats CodeMirror's own, compound and all.** A base theme's `&light X`
 * becomes a generated class and `X` (`.ͼ2 X`), and a theme's `X` its own class and `X`
 * (`.ͼ9 X`): the two tie on specificity and the theme's wins only because CodeMirror mounts it
 * later. A shorter selector — `li[aria-selected]` where
 * CodeMirror writes `.cm-tooltip-autocomplete ul li[aria-selected]` — loses to the base theme in
 * silence, the same trap the selection rule above fell into (ADR 0075, 6). Within this object a
 * later key wins a tie, so the general rule of a family comes before its variants.
 *
 * Exported for `theme.test.ts`, which holds the list of mirrored selectors; not part of the
 * package's surface.
 */
export const panelStyles = {
  // @codemirror/view: the panel container, a text field, a button.
  '.cm-panels': { backgroundColor: panels.surface, color: panels.text },
  '.cm-panels-top': { borderBottom: hairline },
  '.cm-panels-bottom': { borderTop: hairline },
  '.cm-textfield': {
    backgroundColor: panels.field,
    color: panels.text,
    border: border(panels.lineWidth, panels.fieldBorder),
    borderRadius: panels.radius,
    fontSize: panels.textSize,
  },
  '.cm-textfield:focus': {
    outline: border(panels.focusWidth, panels.focusRing),
  },
  // CodeMirror draws its buttons with a gradient image, which a background colour sits under.
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: panels.field,
    color: panels.text,
    border: border(panels.lineWidth, panels.fieldBorder),
    borderRadius: panels.radius,
    fontSize: panels.textSize,
  },
  '.cm-button:hover': { backgroundColor: panels.hover },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: panels.pressed },

  // @codemirror/search: the panel's labels, its close button and the matches in the buffer.
  // A match is outlined and never filled, so the selection and the syntax colours under it read.
  '.cm-panel.cm-search label': { fontSize: panels.textSize, color: panels.muted },
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: panels.accent },
  '.cm-panel.cm-search [name=close]': { color: panels.muted },
  '.cm-searchMatch': {
    backgroundColor: 'transparent',
    outline: border(panels.lineWidth, panels.muted),
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'transparent',
    outline: border(panels.lineWidth, panels.accent),
  },
  '.cm-selectionMatch': { backgroundColor: panels.hover },

  // @replit/codemirror-vim: the `:` prompt is a panel too. A field does not inherit its colour
  // from the page, so without `inherit` the typed command is the system's field colour.
  '.cm-vim-panel': { fontFamily: monoFont },
  '.cm-vim-panel input': { color: 'inherit', fontFamily: 'inherit' },

  // Tooltips: flat, one hairline, no shadow (ADR 0075's "almost no chrome").
  '.cm-tooltip': {
    backgroundColor: panels.surface,
    color: panels.text,
    border: hairline,
    borderRadius: panels.radius,
  },
  '.cm-tooltip-section:not(:first-child)': { borderTop: hairline },

  // @codemirror/autocomplete. The list reads the code size itself rather than inheriting the
  // editor's, so a host can give it a size of its own (TYTO-272's `completion` area).
  '.cm-tooltip.cm-tooltip-autocomplete': { fontSize: codeSize },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: monoFont },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: `${panels.paddingBlock} ${panels.paddingInline}`,
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section': { borderBottom: hairline },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    background: panels.selected,
    color: panels.text,
  },
  '.cm-tooltip-autocomplete-disabled ul li[aria-selected]': { background: panels.hover },
  // Bold in the text's colour, not the accent: the accent on the selection is 2.58:1 in dark.
  '.cm-completionMatchedText': {
    textDecoration: 'none',
    color: panels.text,
    fontWeight: panels.strong,
  },
  '.cm-completionDetail': { color: panels.muted },
  // The JSON tabs' hover help (TYTO-304): this package's own markup inside CodeMirror's
  // tooltip, so its classes are new and mirror nothing.
  // A line length a paragraph reads at: a setting's description can be long, and CodeMirror
  // lets a tooltip run the width of the window.
  '.cm-json-hover': {
    padding: `${panels.paddingBlock} ${panels.paddingInline}`,
    fontSize: panels.textSize,
    maxWidth: '72ch',
    // Never over the whole window: a long list scrolls inside the tooltip.
    maxHeight: '60vh',
    overflowY: 'auto',
    // A long default such as statusBarItems' list is one JSON word; it wraps rather than scrolls.
    overflowWrap: 'anywhere',
  },
  '.cm-json-hover-items': {
    margin: '0',
    paddingInlineStart: panels.paddingInline,
    listStyle: 'none',
  },
  '.cm-json-hover-name': { fontFamily: monoFont },
  '.cm-json-hover-title': { fontFamily: monoFont, fontWeight: panels.strong },
  '.cm-json-hover-label': { color: panels.muted },
  '.cm-completionIcon': { color: panels.muted },

  // @codemirror/lint: the tooltip's diagnostics and the marks in the buffer. CodeMirror's
  // underline is an SVG with its colour written into the image, which no custom property can
  // reach, so the image goes and a wavy text decoration in the token's colour replaces it.
  '.cm-diagnostic-error': { borderLeft: border(panels.barWidth, panels.error) },
  '.cm-diagnostic-warning': { borderLeft: border(panels.barWidth, panels.warning) },
  '.cm-diagnostic-info': { borderLeft: border(panels.barWidth, panels.info) },
  '.cm-diagnostic-hint': { borderLeft: border(panels.barWidth, panels.muted) },
  '.cm-diagnosticAction': {
    backgroundColor: panels.accent,
    color: panels.accentText,
    borderRadius: panels.radius,
  },
  '.cm-diagnosticSource': { color: panels.muted },
  '.cm-lintRange': {
    backgroundImage: 'none',
    textDecorationLine: 'underline',
    textDecorationStyle: 'wavy',
    textDecorationSkipInk: 'none',
  },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecorationColor: panels.error },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecorationColor: panels.warning },
  '.cm-lintRange-info': { backgroundImage: 'none', textDecorationColor: panels.info },
  '.cm-lintRange-hint': { backgroundImage: 'none', textDecorationColor: panels.muted },
  '.cm-lintRange-active': { backgroundColor: panels.hover },
  '.cm-lintPoint:after': { borderBottomColor: panels.error },
  '.cm-lintPoint-warning:after': { borderBottomColor: panels.warning },
  '.cm-lintPoint-info:after': { borderBottomColor: panels.info },
  '.cm-lintPoint-hint:after': { borderBottomColor: panels.muted },
} as const;

const chrome = (colours: Palette, isDark: boolean): Extension =>
  EditorView.theme(
    {
      '&': {
        color: colours.foreground,
        backgroundColor: colours.background,
        fontSize: codeSize,
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
      // The guides' shape is `indent-guides.ts`'s; their colours are the host's, here.
      '.cm-indent-guide': { borderLeftColor: colours.indentGuide },
      '.cm-indent-guide.cm-indent-guide-active': { borderLeftColor: colours.indentGuideActive },
      '.cm-foldPlaceholder': {
        backgroundColor: 'transparent',
        border: 'none',
        color: colours.gutterForeground,
      },
      ...panelStyles,
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

    // Markdown (TYTO-247): the tags `@lezer/markdown` assigns, which neither the brief nor the
    // template grammar uses. `strong` and `emphasis` above already serve it, and its marks
    // (`#`, `>`, `*`, `` ` ``) are `processingInstruction`, the punctuation's colour.
    { tag: tags.heading, color: colours.heading, fontWeight: 'bold' },
    { tag: tags.link, color: colours.link },
    { tag: tags.url, color: colours.url, textDecoration: 'underline' },
    { tag: tags.monospace, color: colours.code },
    { tag: tags.quote, color: colours.quote, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.contentSeparator, color: colours.punctuation },
  ]);

/**
 * Light and dark differ only in CodeMirror's `dark` flag. Since TYTO-258 every colour CodeMirror's
 * own panels, tooltips and diagnostics show is one of the tokens above, so the flag no longer
 * picks a colour anyone sees in a styled part; it still picks the base theme for what nothing
 * here mounts (the lint panel and gutter, the tooltip arrow). The host flips it with `setTheme`
 * when the system does; the colours follow the host's properties on their own.
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
