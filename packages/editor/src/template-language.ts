import { LRLanguage, LanguageSupport, foldNodeProp } from '@codemirror/language';
import { type EditorState } from '@codemirror/state';
import { type SyntaxNode } from '@lezer/common';
import { parser, templateHighlighting } from '@tyto/template-lang';

/**
 * The template language as CodeMirror sees it — the second `LanguageSupport` this package
 * ships, beside `brief()`.
 *
 * Same argument as the brief language: the parser is the one `@tyto/template-lang` ships
 * and `compileTemplate` runs, and the colours are `templateHighlighting`, which lives with
 * the grammar. The editor and the compiler cannot disagree about what a template means,
 * because there is one tree and one table.
 *
 * What this module adds is only what needs an editor to be meaningful: folding, and the
 * comment token a keybinding asks for.
 */

/** A span, or nothing when there is nothing worth collapsing. */
type Fold = { from: number; to: number } | null;

const between = (from: number, to: number): Fold => (from < to ? { from, to } : null);

/**
 * An element folds to its opening tag, attributes and all.
 *
 * The end comes from the tree — `CloseTag` is a node — and only the start is scanned for,
 * because `tagEnd` is a lowercase token and therefore has no node to ask. The scan stops at
 * the close tag, so a `>` inside a later child cannot be mistaken for this element's.
 *
 * A self-closing element has no `CloseTag` and does not fold: there would be nothing left
 * to show.
 */
const foldElement = (node: SyntaxNode, state: EditorState): Fold => {
  const close = node.getChild('CloseTag');
  if (close === null) return null;
  const head = state.doc.sliceString(node.from, close.from).indexOf('>');
  return head === -1 ? null : between(node.from + head + 1, close.from);
};

/** A rule or an at-rule folds to its selector, leaving the braces visible. */
const foldBraces = (node: SyntaxNode, state: EditorState): Fold => {
  const text = state.doc.sliceString(node.from, node.to);
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  return open === -1 || close === -1 ? null : between(node.from + open + 1, node.from + close);
};

/** The whole stylesheet folds to `<style>`, which is what a reader of the markup wants. */
const foldStyleSheet = (node: SyntaxNode, state: EditorState): Fold => {
  const text = state.doc.sliceString(node.from, node.to);
  const open = text.indexOf('>');
  const close = text.lastIndexOf('</');
  return open === -1 || close === -1 ? null : between(node.from + open + 1, node.from + close);
};

export const templateLanguage = LRLanguage.define({
  name: 'tyto-template',
  parser: parser.configure({
    props: [
      templateHighlighting,
      foldNodeProp.add({
        Element: foldElement,
        StyleSheet: foldStyleSheet,
        Block: foldBraces,
        NestedBlock: foldBraces,
      }),
    ],
  }),
  languageData: {
    /**
     * The markup comment, not the CSS one.
     *
     * A template is two languages in one file and `languageData` is per language, so one of
     * the two had to win. The markup comment is legal everywhere in the file and the CSS
     * one only inside `<style>`, which makes the markup comment the one that is never
     * wrong.
     */
    commentTokens: { block: { open: '<!--', close: '-->' } },
  },
});

/**
 * What a host adds to an `EditorState` to get the template language.
 *
 * A `LanguageSupport` rather than the bare language, for the same reason `brief()` is one:
 * when completion and the lint source attach here, a host's import does not change.
 */
export const template = (): LanguageSupport => new LanguageSupport(templateLanguage);
