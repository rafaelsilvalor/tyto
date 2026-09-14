import { LRLanguage, LanguageSupport, foldNodeProp } from '@codemirror/language';
import { briefHighlighting, parser } from '@tyto/brief-lang';
import { type SyntaxNode } from '@lezer/common';

/**
 * The brief language as CodeMirror sees it.
 *
 * The parser is the one `@tyto/brief-lang` ships and the compiler runs, not a second
 * description of the same syntax — that is the whole reason the grammar is a package
 * rather than a function inside `parseBrief`. The editor and the compiler cannot disagree
 * about what a brief means, because there is only one tree.
 *
 * The colours are not here either: `briefHighlighting` lives beside the grammar, so adding
 * a node to the language and forgetting to style it is one file's problem rather than two
 * packages'. This module contributes only what needs an editor to be meaningful — folding,
 * and the comment token a keybinding asks for.
 */

/**
 * A directive folds to its first line.
 *
 * `BodyLine { blockIndent BlockText }` starts at the line break in front of the indent, so
 * the first body line's `from` is the end of the head line and the last one's `to` is the
 * end of the block. Folding that span leaves `::titulo` on screen with its body collapsed,
 * which is the shape an author scrolling a twelve-slide brief wants.
 *
 * A directive with an inline body has no `BodyLine` at all and does not fold: there would
 * be nothing left to show.
 */
const foldDirectiveBody = (node: SyntaxNode): { from: number; to: number } | null => {
  const bodyLines = node.getChildren('BodyLine');
  const first = bodyLines[0];
  const last = bodyLines.at(-1);
  if (!first || !last) return null;
  return { from: first.from, to: last.to };
};

export const briefLanguage = LRLanguage.define({
  name: 'brief',
  parser: parser.configure({
    props: [briefHighlighting, foldNodeProp.add({ Directive: foldDirectiveBody })],
  }),
  languageData: {
    // `//` at line start (docs/brief-language.md). The language has no block comment.
    commentTokens: { line: '//' },
  },
});

/**
 * What a host adds to an `EditorState` to get the brief language.
 *
 * It carries no companion extensions yet. Completion and the lint source (E8.2) attach
 * here when they land, which is why this is a `LanguageSupport` rather than the bare
 * language: the host's import does not change when they do.
 */
export const brief = (): LanguageSupport => new LanguageSupport(briefLanguage);
