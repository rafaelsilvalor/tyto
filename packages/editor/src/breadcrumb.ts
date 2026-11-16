import { type EditorState } from '@codemirror/state';

import { type BriefBlock, blockAt, blocksOf } from './brief-blocks.js';

/**
 * Where the caret is in a brief, for the header row of an editor group (TYTO-273, ADR 0098): the
 * block it is in, read off the list "Go to Block" shows (ADR 0095) — never a walk of its own.
 *
 * - In a directive: its name as the brief writes it and, for a slot the manifest says repeats,
 *   which one it is — `::lamina 2`, `::titulo`, `::ai/caption`.
 * - In the frontmatter: the frontmatter, and the key on or above the caret's line, `template`.
 *   **The window names the frontmatter** ("cabeçalho" / "header"); the editor owns no word.
 * - Anywhere else — between blocks, on a blank line after a block's last text, on a comment —
 *   none, and the row is empty.
 *
 * The file's name is not part of it: the tab above already says which file this is.
 */
export type Breadcrumb =
  | { readonly kind: 'frontmatter'; readonly key?: string }
  | { readonly kind: 'directive'; readonly label: string };

/** `::lamina 2`, `::titulo`, `::ai/caption`: how a directive block is named wherever it is listed. */
export function directiveLabel(block: Pick<BriefBlock, 'name' | 'ordinal' | 'depth'>): string {
  return BLOCK_INDENT.repeat(block.depth ?? 0) + plainLabel(block);
}

/** `::lamina 2`, with no indent: one part of a breadcrumb. */
function plainLabel(block: Pick<BriefBlock, 'name' | 'ordinal'>): string {
  const ordinal = block.ordinal === undefined ? '' : ` ${String(block.ordinal)}`;
  return `::${block.name ?? ''}${ordinal}`;
}

/**
 * What a nested block's label starts with, once per level (ADR 0207): an em space, which HTML
 * does not collapse, so "Go to Block" draws the tree as VS Code's outline does.
 */
export const BLOCK_INDENT = ' ';

/** Between the blocks of a breadcrumb's chain, as the window writes its other parts. */
export const BREADCRUMB_CHAIN_SEPARATOR = ' › ';

/** The block and every block it sits inside, outermost first. */
function chainOf(blocks: readonly BriefBlock[], block: BriefBlock): BriefBlock[] {
  const chain = [block];
  let at = block.parent;
  while (at !== undefined && chain.length <= blocks.length) {
    const parent = blocks[at];
    if (parent === undefined) break;
    chain.unshift(parent);
    at = parent.parent;
  }
  return chain;
}

/**
 * A frontmatter key at the start of a line, `template:` or `formato_saida :`. YAML allows more,
 * but a brief's frontmatter is flat keys (`docs/brief-language.md`), and a line that is not one —
 * a list item, a continuation, a comment — is passed over on the way up.
 */
const FRONTMATTER_KEY = /^([A-Za-z0-9_][\w.-]*)[ \t]*:/u;

/**
 * The key on the caret's line or the nearest one above it, inside the frontmatter `block`. None on
 * the opening fence, or above the first key.
 */
function keyAbove(
  block: BriefBlock,
  pos: number,
  slice: (from: number, to: number) => string,
): string | undefined {
  const rest = slice(pos, block.to);
  const breakAt = rest.search(/[\r\n]/u);
  const lineEnd = breakAt === -1 ? block.to : pos + breakAt;
  // The opening fence is the first line; the keys are the lines after it, up to the caret's.
  const lines = slice(block.from, lineEnd)
    .split(/\r\n?|\n/u)
    .slice(1);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const key = FRONTMATTER_KEY.exec(lines[index] ?? '')?.[1];
    if (key !== undefined) return key;
  }
  return undefined;
}

/**
 * The breadcrumb for `pos` among `blocks`, reading the text through `slice` — so it is tested
 * against `parser.parse(text)` with no editor, as `briefBlocks` is.
 */
export function breadcrumbAt(
  blocks: readonly BriefBlock[],
  pos: number,
  slice: (from: number, to: number) => string,
): Breadcrumb | undefined {
  const block = blockAt(blocks, pos);
  if (block === undefined) return undefined;
  if (block.kind === 'directive') {
    const label = chainOf(blocks, block).map(plainLabel).join(BREADCRUMB_CHAIN_SEPARATOR);
    return { kind: 'directive', label };
  }
  const key = keyAbove(block, pos, slice);
  return key === undefined ? { kind: 'frontmatter' } : { kind: 'frontmatter', key };
}

/**
 * The breadcrumb for the main selection's head in `state`. Cheap on a caret move: `blocksOf` is
 * remembered per syntax tree, so only the lookup and, in the frontmatter, a few lines are read.
 */
export function breadcrumbOf(state: EditorState): Breadcrumb | undefined {
  return breadcrumbAt(blocksOf(state), state.selection.main.head, (from, to) =>
    state.sliceDoc(from, to),
  );
}
