import { LRLanguage, LanguageSupport, foldNodeProp } from '@codemirror/language';
import { briefHighlighting, parser } from '@tyto/brief-lang';
import { keymap } from '@codemirror/view';
import { type SyntaxNode } from '@lezer/common';

import { blockEnterKeymap } from './block-enter.js';

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
 *
 * **The fold ends at the last line with text** (TYTO-295). Since TYTO-294 a blank line inside
 * a block is a `BodyLine` with no `BlockText`, and one at the end of a block — whitespace
 * before the next directive — would otherwise be folded into it, and a directive whose only
 * body is such a line would fold over nothing anybody wrote. The sticky header reads these
 * ranges too, so a block that ends at its last word stops pinning there.
 */
const foldDirectiveBody = (node: SyntaxNode): { from: number; to: number } | null => {
  const bodyLines = node.getChildren('BodyLine');
  const first = bodyLines[0];
  const last = bodyLines.filter((line) => line.getChild('BlockText') !== null).at(-1);
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
 * Its one companion is Enter as an indented block wants it (TYTO-305): a key that belongs to
 * the language, not to an input mode, so it travels with the language and a JSON tab keeps
 * CodeMirror's own Enter. It is not an entry of the keybinding table (ADR 0074) for the same
 * reason — the table is per input mode and per window, and this is per language. Ahead of
 * `baseExtensions` in the editor's list, so it is reached before `defaultKeymap`'s Enter; an
 * open completion list still takes Enter first, from its higher precedence.
 */
export const brief = (): LanguageSupport =>
  new LanguageSupport(briefLanguage, [keymap.of(blockEnterKeymap)]);
