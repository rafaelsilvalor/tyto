/**
 * A recipe's text read as a notebook's blocks (TYTO-676, ADR 0195 and ADR 0196).
 *
 * The reading is by line and by its first word, never by the parser, so a text that does not
 * parse still has its blocks: a step that fails is a line of its block, not a hole.
 *
 * **A blank line separates blocks**, as a Jupyter notebook separates cells (ADR 0196): a block
 * is a run of consecutive lines that are not blank, and may hold several steps and `#` lines.
 *
 * - The **header** block is the recipe's leading run of `recipe`, `|`, `apply`, `every` and
 *   `param` lines. It ends at the first other line **even with no blank line before it**, so a
 *   step written right under `recipe x` is a block of its own. A run elsewhere made only of such
 *   lines is a header block too. A header block is never moved, deleted or crossed by a move:
 *   `apply` and `every` belong before the first step, and every step reads the `param` lines.
 * - A **step** block holds one step or more, on one line chained with `|` (TYTO-706) or on
 *   several: `steps` are their cells' indices, first and last.
 *   Its result is its last step's (ADR 0196).
 * - A **note** block is made only of `#` lines, which the parser skips.
 * - A blank line belongs to no block and stays where it is.
 *
 * Every operation answers **one text change**, which the host hands to its editor as an edit,
 * so undo, the marks kept by line and the saved file follow as they follow typing. The text is
 * the source (ADR 0176): the blocks are a reading of it, never a second copy.
 */

import { chainSegments } from './chain.js';

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
  /**
   * A step block's steps, by their index among the recipe's steps, which is their cells'
   * index: the first and the last, and where the last one's line starts, which is the line its
   * result is drawn under.
   */
  readonly steps?: { readonly first: number; readonly last: number; readonly lastFrom: number };
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

const HEADER_WORDS = new Set(['recipe', 'apply', 'every', 'param', 'const']);

interface Line {
  readonly number: number;
  readonly from: number;
  /** Past the text, before `\r\n` or `\n`. */
  readonly to: number;
  readonly kind: RecipeBlockKind | 'blank';
  /** A step line's steps, more than one when it chains them with `|` (TYTO-706). */
  readonly steps: readonly { readonly from: number; readonly to: number }[];
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
    const kind = kindOf(body.trim());
    const steps =
      kind === 'step'
        ? chainSegments(body).map((segment) => ({
            from: from + segment.from,
            to: from + segment.to,
          }))
        : [];
    lines.push({ number, from, to: from + body.length, kind, steps });
    from += raw.length + 1;
    number += 1;
  }
  return lines;
}

/**
 * Each step of a recipe's text, in order, so a step's place in the list is its cell's index:
 * where its text starts and ends, and where its line starts. A line that chains steps with `|`
 * gives one entry per step, all with the same `line` (TYTO-706).
 */
export function recipeSteps(
  text: string,
): readonly { readonly from: number; readonly to: number; readonly line: number }[] {
  return linesOf(text).flatMap((line) =>
    line.steps.map((step) => ({ from: step.from, to: step.to, line: line.from })),
  );
}

/** The blocks of a recipe's text, in order. */
export function recipeBlocks(text: string): readonly RecipeBlock[] {
  const blocks: RecipeBlock[] = [];
  let step = 0;
  let run: Line[] = [];
  let first = true;
  const push = (lines: readonly Line[]): void => {
    const head = lines[0];
    const tail = lines.at(-1);
    if (head === undefined || tail === undefined) return;
    const steps = lines.flatMap((line) => line.steps.map(() => line));
    const header = lines.some((line) => line.kind === 'header');
    const kind: RecipeBlockKind = steps.length > 0 ? 'step' : header ? 'header' : 'note';
    const last = steps.at(-1);
    blocks.push({
      kind,
      from: head.from,
      to: tail.to,
      firstLine: head.number,
      lastLine: tail.number,
      ...(last === undefined
        ? {}
        : { steps: { first: step, last: step + steps.length - 1, lastFrom: last.from } }),
    });
    step += steps.length;
  };
  const close = (): void => {
    if (run.length === 0) return;
    if (first) {
      // The recipe's own header is a block of its own even with no blank line after it.
      const header = run.findIndex((line) => line.kind !== 'header');
      if (header > 0) {
        push(run.slice(0, header));
        run = run.slice(header);
      }
      first = false;
    }
    push(run);
    run = [];
  };
  for (const line of linesOf(text)) {
    if (line.kind === 'blank') close();
    else run.push(line);
  }
  close();
  return blocks;
}

/**
 * The lines of one kind, in order, read as `recipeBlocks` reads them: where each starts and
 * ends. A step line may chain several steps with `|`, so a cell's index is its place in
 * {@link recipeSteps}, not in the `'step'` lines (TYTO-706); the `'header'` lines
 * are every `recipe`, `|`, `apply`, `every` and `param` line, wherever its block is.
 */
export function recipeLines(
  text: string,
  kind: 'step' | 'header',
): readonly { readonly from: number; readonly to: number }[] {
  return linesOf(text)
    .filter((line) => line.kind === kind)
    .map(({ from, to }) => ({ from, to }));
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
  return moveBlockTo(text, index, direction === 'up' ? index - 1 : index + 2);
}

/**
 * Moves block `index` to just before block `before`, or below the last block with `'end'`, as
 * a drag drops it (TYTO-676). The blocks it passes and every one of them must be movable: a
 * header is never moved nor crossed. `undefined` when the block would not move (`before` is the
 * block itself or the one after it) or may not.
 *
 * **The blocks passed over are what the edit moves**, as in {@link moveBlock}: they and the gap
 * that set the block apart change sides, and the block keeps its lines, so its result and its
 * fold stay with it. The blank lines between blocks stay as they were: the block takes the
 * place, and the separator, of the first block it passes.
 */
export function moveBlockTo(
  text: string,
  index: number,
  before: number | 'end',
): BlockEdit | undefined {
  const blocks = recipeBlocks(text);
  const target = before === 'end' ? blocks.length : before;
  const block = blocks[index];
  if (block === undefined || !isMovable(block)) return undefined;
  if (!Number.isInteger(target) || target < 0 || target > blocks.length) return undefined;
  // Dropped on the block itself or just below it, nothing is passed: nothing moves.
  const passed = target < index ? blocks.slice(target, index) : blocks.slice(index + 1, target);
  const first = passed[0];
  const last = passed.at(-1);
  if (first === undefined || last === undefined || !passed.every(isMovable)) return undefined;
  const others = text.slice(first.from, last.to);
  if (target < index) {
    // `others gap block` becomes `block gap others`: the others and the gap go below the block.
    const gap = text.slice(last.to, block.from);
    return {
      changes: [
        { from: first.from, to: block.from, insert: '' },
        { from: block.to, to: block.to, insert: gap + others },
      ],
      at: first.from,
    };
  }
  // `block gap others` becomes `others gap block`: the others and the gap go above the block.
  const gap = text.slice(block.to, first.from);
  return {
    changes: [
      { from: block.from, to: block.from, insert: others + gap },
      { from: block.to, to: last.to, insert: '' },
    ],
    at: block.from + others.length + gap.length,
  };
}

/**
 * Deletes block `index` with the blank line that set it apart (ADR 0196), so one blank line still
 * separates the blocks around it: up to the next block's start, or, for the last block, from the
 * end of the block before it. With no block either side, its lines and the break after them.
 * `undefined` for a header block or an index out of range.
 */
export function deleteBlock(text: string, index: number): BlockEdit | undefined {
  const blocks = recipeBlocks(text);
  const block = blocks[index];
  if (block === undefined || !isMovable(block)) return undefined;
  const next = blocks[index + 1];
  if (next !== undefined) return { changes: [{ from: block.from, to: next.from, insert: '' }] };
  const previous = blocks[index - 1];
  if (previous !== undefined) {
    return { changes: [{ from: previous.to, to: block.to, insert: '' }] };
  }
  const after = text.indexOf('\n', block.to);
  return { changes: [{ from: block.from, to: after === -1 ? block.to : after + 1, insert: '' }] };
}

/** Applies an edit's changes to a text, as the editor does, for a test or a host. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let applied = text;
  for (const change of [...changes].sort((left, right) => right.from - left.from)) {
    applied = applied.slice(0, change.from) + change.insert + applied.slice(change.to);
  }
  return applied;
}
