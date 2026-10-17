import { type EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type SyntaxNode, type Tree } from '@lezer/common';
import { type TemplateManifest } from '@tyto/core';

import { briefAnalysisField } from './analysis.js';
import { treeAt } from './syntax.js';

/**
 * A brief's blocks as one flat list (TYTO-296, ADR 0095): the frontmatter and every top-level
 * directive, in document order. "Go to Block" lists it; the breadcrumb (TYTO-273, ADR 0098)
 * names the block the cursor is in from it.
 *
 * **It reads the Lezer tree and not `parseBrief`**, because `parseBrief` hands back no AST at all
 * for a brief with one syntax error, which is every brief halfway through a keystroke. The tree
 * recovers: a directive below the broken line is still a `Directive` node, sometimes inside an
 * error node, and is still listed.
 */
export interface BriefBlock {
  readonly kind: 'frontmatter' | 'directive';
  /** A directive's name as a brief writes it, `lamina` or `ai/caption`; none for the frontmatter. */
  readonly name?: string;
  /**
   * Which occurrence of its name this is, from 1, for a slot the manifest says repeats. Absent
   * for a slot that does not, for a plugin's directive and while the manifest is not known —
   * a number that could be wrong is worse than none.
   */
  readonly ordinal?: number;
  /** Where the block starts: the `::` or the opening fence. */
  readonly from: number;
  /** Where its head line ends, before the line break. */
  readonly headTo: number;
  /** Where its last line ends, before the line break. */
  readonly to: number;
  /** The first words of its text, markup left out and runs of space collapsed; none when empty. */
  readonly firstText?: string;
}

/** As much of a manifest as the ordinals need. */
export type BlockManifest = Pick<TemplateManifest, 'slots'>;

/** How much of a block's first text is kept: enough to tell two `::lamina` apart. */
export const BLOCK_TEXT_LENGTH = 60;

/** The nodes whose text is words, the leaves of `InlineBody` and `BlockText`. */
const WORDS = new Set(['Text', 'Space', 'EscapedDirective']);

/** The end of the first line in `[from, to)`, before its line break. */
function lineEndIn(slice: (from: number, to: number) => string, from: number, to: number): number {
  const text = slice(from, to);
  const at = text.search(/[\r\n]/u);
  return at === -1 ? to : from + at;
}

/** `to` with the line breaks it ends on taken off: a directive's node holds its last newline. */
function withoutTrailingBreak(
  slice: (from: number, to: number) => string,
  from: number,
  to: number,
): number {
  const text = slice(from, to);
  return from + text.replace(/[\r\n]+$/u, '').length;
}

/** The words of a text node, markup dropped, cut to {@link BLOCK_TEXT_LENGTH}. */
function wordsOf(
  node: SyntaxNode,
  slice: (from: number, to: number) => string,
): string | undefined {
  let words = '';
  const collect = (parent: SyntaxNode): void => {
    for (let leaf = parent.firstChild; leaf !== null; leaf = leaf.nextSibling) {
      if (!WORDS.has(leaf.name)) collect(leaf);
      else if (leaf.name === 'Space') words += ' ';
      else if (leaf.name === 'EscapedDirective') words += '::';
      else words += slice(leaf.from, leaf.to);
    }
  };
  collect(node);
  const collapsed = words.replace(/\s+/gu, ' ').trim();
  if (collapsed === '') return undefined;
  return collapsed.length <= BLOCK_TEXT_LENGTH
    ? collapsed
    : `${collapsed.slice(0, BLOCK_TEXT_LENGTH - 1).trimEnd()}…`;
}

/** A directive's first line of text: its inline body, or the first body line that has words. */
function firstTextOf(
  directive: SyntaxNode,
  slice: (from: number, to: number) => string,
): string | undefined {
  for (let child = directive.firstChild; child !== null; child = child.nextSibling) {
    const body = child.name === 'BodyLine' ? child.getChild('BlockText') : child;
    if (body === null || (body.name !== 'InlineBody' && body.name !== 'BlockText')) continue;
    const words = wordsOf(body, slice);
    if (words !== undefined) return words;
  }
  return undefined;
}

/**
 * Where a directive's last text ends. A body line holding only spaces is a `BodyLine` with no
 * `BlockText`, and it is not text: the block ends at its last line with words, as its fold does
 * (ADR 0094), while a blank line *between* two lines of text stays inside it (ADR 0087).
 */
function lastTextEnd(directive: SyntaxNode): number {
  let end = directive.from;
  for (let child = directive.firstChild; child !== null; child = child.nextSibling) {
    const text = child.name === 'BodyLine' ? child.getChild('BlockText') : child;
    if (text === null || !TEXT_PARTS.has(text.name)) continue;
    end = Math.max(end, text.to);
  }
  return end;
}

/** A directive's children that put characters on a line. */
const TEXT_PARTS = new Set(['Namespace', 'Name', 'Adjustments', 'InlineBody', 'BlockText']);

/** The frontmatter's first line between the fences that has anything on it: `template: x`. */
function frontmatterText(
  node: SyntaxNode,
  slice: (from: number, to: number) => string,
): string | undefined {
  const lines = slice(node.from, node.to).split(/\r\n?|\n/u);
  const first = lines.slice(1).find((line) => line.trim() !== '' && line.trim() !== '---');
  return first?.trim().slice(0, BLOCK_TEXT_LENGTH);
}

/**
 * The blocks of the brief `tree` was parsed from, in document order.
 *
 * `slice` reads the text the tree was parsed from, so this is as happy with `parser.parse(text)`
 * as with an editor's state. Only the top level is read — the brief has no nested blocks today —
 * and an error node is looked through, which is what keeps the blocks after a broken line.
 */
export function briefBlocks(
  tree: Tree,
  slice: (from: number, to: number) => string,
  manifest?: BlockManifest,
): readonly BriefBlock[] {
  const blocks: BriefBlock[] = [];
  const seen = new Map<string, number>();
  tree.iterate({
    enter: (ref) => {
      if (ref.type.isTop || ref.type.isError) return true;
      const node = ref.node;
      if (ref.name === 'Frontmatter') {
        const firstText = frontmatterText(node, slice);
        blocks.push({
          kind: 'frontmatter',
          from: node.from,
          headTo: lineEndIn(slice, node.from, node.to),
          to: withoutTrailingBreak(slice, node.from, node.to),
          ...(firstText === undefined ? {} : { firstText }),
        });
      } else if (ref.name === 'Directive') {
        const nameNode = node.getChild('Name');
        if (nameNode === null) return false;
        const namespace = node.getChild('Namespace');
        const name =
          (namespace === null ? '' : slice(namespace.from, namespace.to).slice(0, -1) + '/') +
          slice(nameNode.from, nameNode.to);
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        const repeats = namespace === null && manifest?.slots[name]?.repeat === true;
        const firstText = firstTextOf(node, slice);
        blocks.push({
          kind: 'directive',
          name,
          ...(repeats ? { ordinal: count } : {}),
          from: node.from,
          headTo: lineEndIn(slice, node.from, node.to),
          to: lineEndIn(slice, lastTextEnd(node), node.to),
          ...(firstText === undefined ? {} : { firstText }),
        });
      }
      return false;
    },
  });
  return blocks;
}

/**
 * The blocks of the brief in `state`, against the manifest its last analysis named.
 *
 * The analysis keeps its manifest across a keystroke that does not parse (`briefAnalysisField`),
 * so the ordinals do not blink while somebody types. A state with no analysis yet has no
 * ordinals.
 *
 * **Remembered per syntax tree**, because the breadcrumb (TYTO-273) asks on every caret move: a
 * transaction that changes no text keeps the tree, and the same tree with the same manifest is
 * the same list, so a move costs a lookup. A new tree or a new manifest reads again.
 */
export function blocksOf(state: EditorState): readonly BriefBlock[] {
  const manifest = state.field(briefAnalysisField, false)?.manifest;
  const tree = treeAt(state, state.doc.length);
  const known = remembered.get(tree);
  if (known !== undefined && known.manifest === manifest) return known.blocks;
  const blocks = briefBlocks(tree, (from, to) => state.sliceDoc(from, to), manifest);
  remembered.set(tree, { manifest, blocks });
  return blocks;
}

/** The last list read off each tree, and the manifest it was read against. */
const remembered = new WeakMap<
  Tree,
  { readonly manifest: BlockManifest | undefined; readonly blocks: readonly BriefBlock[] }
>();

/** The block `pos` is inside, from its first character to the end of its last line; or none. */
export function blockAt(blocks: readonly BriefBlock[], pos: number): BriefBlock | undefined {
  return blocks.find((block) => block.from <= pos && pos <= block.to);
}

/**
 * Shows the block starting at `from` without focusing the editor: the caret on its first
 * character and its head line scrolled to the top of the pane, so as much of the block as fits is
 * on screen. "Go to Block" previews the highlighted block this way; scrolling to the nearest edge
 * would leave a block below the pane with only its head line showing at the bottom.
 */
export function previewBlock(view: EditorView, from: number): void {
  const at = Math.max(0, Math.min(from, view.state.doc.length));
  view.dispatch({
    selection: { anchor: at },
    effects: EditorView.scrollIntoView(at, { y: 'start' }),
  });
}
