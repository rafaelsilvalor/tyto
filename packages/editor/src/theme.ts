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
 * The tags are the ones `briefHighlighting` assigns in `@tyto/brief-lang` — that list is
 * the contract between the grammar and this file. A tag styled here that the grammar never
 * assigns renders nothing; a node the grammar tags and this file ignores falls back to the
 * editor's foreground colour, which is legible but flat.
 */

/** Named so the two palettes can be read side by side rather than diffed. */
interface Palette {
  readonly background: string;
  readonly foreground: string;
  readonly caret: string;
  readonly selection: string;
  readonly activeLine: string;
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
}

const light: Palette = {
  background: '#ffffff',
  foreground: '#1f2328',
  caret: '#1f2328',
  selection: '#cfe3ff',
  activeLine: '#f6f8fa',
  gutterBackground: '#f6f8fa',
  gutterForeground: '#8c959f',
  frontmatter: '#6639ba',
  comment: '#6e7781',
  directiveName: '#0550ae',
  namespace: '#0a7ea4',
  punctuation: '#57606a',
  attributeName: '#953800',
  attributeValue: '#0a3069',
  escape: '#cf222e',
};

const dark: Palette = {
  background: '#1e2127',
  foreground: '#abb2bf',
  caret: '#528bff',
  selection: '#3e4451',
  activeLine: '#2c313a',
  gutterBackground: '#1e2127',
  gutterForeground: '#545862',
  frontmatter: '#c678dd',
  comment: '#7f848e',
  directiveName: '#61afef',
  namespace: '#56b6c2',
  punctuation: '#828997',
  attributeName: '#d19a66',
  attributeValue: '#98c379',
  escape: '#e06c75',
};

const chrome = (palette: Palette, isDark: boolean): Extension =>
  EditorView.theme(
    {
      '&': {
        color: palette.foreground,
        backgroundColor: palette.background,
      },
      '.cm-content': {
        caretColor: palette.caret,
        fontFamily: "'JetBrains Mono', 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace",
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: palette.caret },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: palette.selection,
      },
      '.cm-activeLine': { backgroundColor: palette.activeLine },
      '.cm-activeLineGutter': {
        backgroundColor: palette.activeLine,
        color: palette.foreground,
      },
      '.cm-gutters': {
        backgroundColor: palette.gutterBackground,
        color: palette.gutterForeground,
        border: 'none',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: 'transparent',
        border: 'none',
        color: palette.gutterForeground,
      },
    },
    { dark: isDark },
  );

const syntax = (palette: Palette): HighlightStyle =>
  HighlightStyle.define([
    { tag: tags.meta, color: palette.frontmatter },
    { tag: tags.lineComment, color: palette.comment, fontStyle: 'italic' },

    { tag: tags.definitionKeyword, color: palette.directiveName, fontWeight: 'bold' },
    { tag: tags.namespace, color: palette.namespace },
    { tag: tags.punctuation, color: palette.punctuation },

    { tag: tags.attributeName, color: palette.attributeName },
    { tag: tags.attributeValue, color: palette.attributeValue },

    // Bold and italic are the one place the editor shows what the render will do rather
    // than what the source says, so they carry weight and slant and no colour of their own.
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },

    { tag: tags.escape, color: palette.escape },
    { tag: tags.processingInstruction, color: palette.punctuation },
    { tag: tags.separator, color: palette.punctuation },
  ]);

export const briefLightTheme: Extension = [chrome(light, false), syntaxHighlighting(syntax(light))];

export const briefDarkTheme: Extension = [chrome(dark, true), syntaxHighlighting(syntax(dark))];

/** The two names `createEditor` accepts, and what `setTheme` switches between. */
export type ThemeName = 'light' | 'dark';

export const themes: Readonly<Record<ThemeName, Extension>> = {
  light: briefLightTheme,
  dark: briefDarkTheme,
};
