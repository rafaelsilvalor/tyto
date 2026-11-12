/**
 * A recipe's text read as a notebook's blocks (TYTO-676, ADR 0195).
 *
 * The reading is by line and by its first word, never by the parser, so a text that does not
 * parse still has its blocks: a step that fails is a block with an error, not a hole.
 *
 * - A **header** block is a run of `recipe`, `|`, `apply`, `every` and `param` lines. It is
 *   never moved, deleted or crossed by a move: `apply` and `every` belong before the first
 *   step, and a `param` line is part of what every step reads.
 * - A **step** block is one step line, one cell: a recipe has no continuation lines.
 * - A **note** block is a run of `#` lines, which the parser skips.
 * - A blank line belongs to no block and stays where it is.
 *
 * Every operation answers **one text change**, which the host hands to its editor as an edit,
 * so undo, the marks kept by line and the saved file follow as they follow typing. The text is
 * the source (ADR 0176): the blocks are a reading of it, never a second copy.
 */

export type RecipeBlockKind = 'header' | 'step' | 'note';

export interface RecipeBlock {
  readonly kind: RecipeBlockKind;
  /** The offset of the block's first character, at the start of its first line. */
  readonly from: number;
  /** The offset just past its last line's text, before that line's break (and its `\r`). */
  readonly to: number;
  /** The one-based numbers of its first and last lines. */
  readonly firstLine: number;
  readonly lastLine: number;
  /** A step block's index among the recipe's steps, which is its cell's index. */
  readonly step?: number;
}

/** One edit: replace `[from, to)` with `insert`. */
export interface TextChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/**
 * A block operation's edit: changes in the text's own offsets, in order and not overlapping,
 * applied together as one edit, and where the block acted on starts once they are applied.
 */
export interface BlockEdit {
  readonly changes: readonly TextChange[];
  /** The offset of the moved block's first character after the edit; absent for a delete. */
  readonly at?: number;
}

const HEADER_WORDS = new Set(['recipe', 'apply', 'every', 'param']);

interface Line {
  readonly number: number;
  readonly from: number;
  /** Past the text, before `\r\n` or `\n`. */
  readonly to: number;
  readonly kind: RecipeBlockKind | 'blank';
}

function kindOf(content: string): Line['kind'] {
  if (content === '') return 'blank';
  if (content.startsWith('#')) return 'note';
  if (content.startsWith('|')) return 'header';
  const word = /^\S+/u.exec(content)?.[0] ?? '';
  return HEADER_WORDS.has(word) ? 'header' : 'step';
}

function linesOf(text: string): readonly Line[] {
  const lines: Line[] = [];
  let from = 0;
  let number = 1;
  for (const raw of text.split('\n')) {
    const body = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ number, from, to: from + body.length, kind: kindOf(body.trim()) });
    from += raw.length + 1;
    number += 1;
  }
  return lines;
}

/** The blocks of a recipe's text, in order. */
export function recipeBlocks(text: string): readonly RecipeBlock[] {
  const blocks: RecipeBlock[] = [];
  let steps = 0;
  let open: { kind: RecipeBlockKind; first: Line; last: Line } | undefined;
  const close = (): void => {
    if (open === undefined) return;
    blocks.push({
      kind: open.kind,
      from: open.first.from,
      to: open.last.to,
      firstLine: open.first.number,
      lastLine: open.last.number,
      ...(open.kind === 'step' ? { step: steps++ } : {}),
    });
    open = undefined;
  };
  for (const line of linesOf(text)) {
    if (line.kind === 'blank') {
      close();
      continue;
    }
    // A step is always its own block; a header or a note run grows line by line.
    if (open !== undefined && open.kind === line.kind && line.kind !== 'step') {
      open.last = line;
      continue;
    }
    close();
    open = { kind: line.kind, first: line, last: line };
  }
  close();
  return blocks;
}

/** The block holding a line (one-based), or `undefined` on a blank line or past the end. */
export function blockAtLine(blocks: readonly RecipeBlock[], line: number): RecipeBlock | undefined {
  return blocks.find((block) => block.firstLine <= line && line <= block.lastLine);
}

/** Whether a block may be moved or deleted: a header block may not. */
export const isMovable = (block: RecipeBlock): boolean => block.kind !== 'header';

/**
 * Moves block `index` one place up or down, past the movable block next to it; the blank
 * lines between the two stay where they are. `undefined` when there is no movable neighbour
 * that way, or the block itself is a header.
 *
 * **The neighbour is what the edit moves**, and the block keeps its lines: an editor maps a
 * mark through an edit by its line, and a line the edit deletes loses its marks, so the block
 * the person moved keeps its result and its fold where the one it passed is written again.
 */
export function moveBlock(
  text: string,
  index: number,
  direction: 'up' | 'down',
): BlockEdit | undefined {
  const blocks = recipeBlocks(text);
  const block = blocks[index];
  const other = blocks[direction === 'up' ? index - 1 : index + 1];
  if (block === undefined || other === undefined) return undefined;
  if (!isMovable(block) || !isMovable(other)) return undefined;
  if (direction === 'up') {
    // `other gap block` becomes `block gap other`: `other` and the gap go below `block`.
    const gap = text.slice(other.to, block.from);
    return {
      changes: [
        { from: other.from, to: block.from, insert: '' },
        { from: block.to, to: block.to, insert: gap + text.slice(other.from, other.to) },
      ],
      at: other.from,
    };
  }
  // `block gap other` becomes `other gap block`: `other` and the gap go above `block`.
  const gap = text.slice(block.to, other.from);
  const moved = text.slice(other.from, other.to);
  return {
    changes: [
      { from: block.from, to: block.from, insert: moved + gap },
      { from: block.to, to: other.to, insert: '' },
    ],
    at: block.from + moved.length + gap.length,
  };
}

/**
 * Deletes block `index` with one line break, the one after it when there is one, so the line
 * below moves up into its place. `undefined` for a header block or an index out of range.
 */
export function deleteBlock(text: string, index: number): BlockEdit | undefined {
  const block = recipeBlocks(text)[index];
  if (block === undefined || !isMovable(block)) return undefined;
  const after = text.indexOf('\n', block.to);
  if (after !== -1) return { changes: [{ from: block.from, to: after + 1, insert: '' }] };
  // The last line, with no break after it: take the break before it, if any.
  let before = block.from > 0 ? text.lastIndexOf('\n', block.from - 1) : -1;
  if (before > 0 && text[before - 1] === '\r') before -= 1;
  return { changes: [{ from: before === -1 ? block.from : before, to: block.to, insert: '' }] };
}

/** Applies an edit's changes to a text, as the editor does, for a test or a host. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let applied = text;
  for (const change of [...changes].sort((left, right) => right.from - left.from)) {
    applied = applied.slice(0, change.from) + change.insert + applied.slice(change.to);
  }
  return applied;
}
