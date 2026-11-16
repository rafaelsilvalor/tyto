import { LRLanguage, LanguageSupport, foldNodeProp } from '@codemirror/language';
import { briefHighlighting, formulaMounts, parser } from '@tyto/brief-lang';
import { type EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { type SyntaxNode } from '@lezer/common';

import { blockEnterKeymap } from './block-enter.js';
import { ancestorsOf, blockIndexBefore, blocksOf, lastNestedIndex } from './brief-blocks.js';
import { OUTER_BLOCKS, type OuterBlocks } from './sticky-scroll.js';

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
 *
 * **A comment line inside the block folds with it** (TYTO-680, ADR 0204): it is the block's,
 * written by the author, so it neither stays out of the fold at the head nor at the end.
 */
const ownBody = (node: SyntaxNode): { from: number; to: number } | null => {
  let from: number | undefined;
  let to: number | undefined;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    const isComment = child.name === 'Comment';
    if (child.name !== 'BodyLine' && !isComment) continue;
    // A comment's node starts at its `//`; the line break and indent in front of it are an
    // anonymous token, so the head line ends where the node before the comment does.
    from ??= isComment ? (child.prevSibling?.to ?? child.from) : child.from;
    if (isComment || child.getChild('BlockText') !== null) to = child.to;
  }
  if (from === undefined || to === undefined) return null;
  return { from, to };
};

/**
 * A directive folds over the blocks nested in it too (TYTO-748, ADR 0207).
 *
 * The tree is flat — `  ::bloco` is a sibling of the `::lamina` above it — so which blocks a
 * directive holds comes from the manifest, through `blocksOf` and the analysis the editor last
 * ran. The fold runs from the end of the head line to the last text of the last block nested
 * in it, up to the next sibling or ancestor; a `::lamina` with no body of its own but blocks
 * under it folds too. With nothing nested — no analysis yet, a template that declares no `per`
 * — it is the directive's own body, exactly as before.
 */
const foldDirective = (
  node: SyntaxNode,
  state: EditorState,
): { from: number; to: number } | null => {
  const own = ownBody(node);
  const blocks = blocksOf(state);
  const index = blockIndexBefore(blocks, node.from);
  const block = blocks[index];
  if (block === undefined || block.from !== node.from) return own;
  const last = lastNestedIndex(blocks, index);
  if (last === index) return own;
  const end = blocks[last]?.to ?? block.to;
  return { from: own?.from ?? block.headTo, to: Math.max(end, own?.to ?? end) };
};

/**
 * The blocks holding `pos` that the tree does not (TYTO-748): the block at or before it and the
 * ones it is nested in, by the manifest, outermost first. Sticky scroll reads them beside the
 * tree's own parents and keeps those whose fold range holds `pos`.
 */
const outerBlocks: OuterBlocks = (state, pos) => {
  const blocks = blocksOf(state);
  const index = blockIndexBefore(blocks, pos);
  if (index < 0) return [];
  return [...ancestorsOf(blocks, index), index].flatMap((at) => {
    const block = blocks[at];
    return block === undefined || block.kind !== 'directive' ? [] : [block.from];
  });
};

export const briefLanguage = LRLanguage.define({
  name: 'brief',
  parser: parser.configure({
    props: [briefHighlighting, foldNodeProp.add({ Directive: foldDirective })],
    // A formula's `\frac`, braces and `$` as nodes of their own, for their colours (TYTO-743).
    // The editor's tree only: `parseBrief` reads the formula with `parseFormula`.
    wrap: formulaMounts,
  }),
  languageData: {
    // `//` at line start (docs/brief-language.md). The language has no block comment.
    commentTokens: { line: '//' },
    [OUTER_BLOCKS]: outerBlocks,
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
