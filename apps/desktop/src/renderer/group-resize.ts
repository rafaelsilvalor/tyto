/**
 * The geometry of the line between two editor groups (TYTO-289, ADR 0083): where a drag, a key
 * or a double-click puts it. Pure, so the arithmetic is tested without a window; the element
 * that measures and listens is `wireGroupSplitters` in `editor-group.ts`.
 *
 * **A splitter moves one edge and no other.** It sits between a split's children `index` and
 * `index + 1`, and only those two shares change: what they hold together stays theirs, so the
 * groups on either side of the pair keep their size, as a dock's neighbours do.
 */

import type { GroupNode, SplitDirection } from './editor-groups.js';

/**
 * The smallest a group may be dragged to, along each axis, in CSS pixels. The same numbers as
 * `.editor-group`'s `min-width` and `min-height` in `shell.css`, which hold a group there while
 * the window shrinks; these hold it there while a person drags.
 */
export const GROUP_MINIMUM: Readonly<Record<SplitDirection, number>> = { row: 160, column: 96 };

/** How far one arrow key moves the line, in CSS pixels. */
export const KEYBOARD_STEP = 16;

/** The two neighbours of a splitter, measured along the split's axis at the drag's start. */
export interface PairSize {
  readonly before: number;
  readonly after: number;
}

/**
 * The smallest `node` can be along `direction`: a group's minimum; a split running the same way
 * holds its children end to end, so their sum; one running across holds them side by side, so
 * the largest of them.
 */
export function minimumOf(node: GroupNode, direction: SplitDirection): number {
  if (node.kind === 'group') return GROUP_MINIMUM[direction];
  const each = node.children.map((child) => minimumOf(child, direction));
  if (each.length === 0) return GROUP_MINIMUM[direction];
  return node.direction === direction
    ? each.reduce((sum, size) => sum + size, 0)
    : Math.max(...each);
}

/**
 * The shares after the line between `index` and `index + 1` moved by `delta` pixels from where
 * it was when `pair` was measured. Each neighbour keeps at least its minimum; a pair too small
 * to give both theirs is left as it is, since any move would only take one below it.
 */
export function resizedShares(
  sizes: readonly number[],
  index: number,
  pair: PairSize,
  delta: number,
  minimum: PairSize,
): number[] {
  const next = [...sizes];
  const before = sizes[index];
  const after = sizes[index + 1];
  const total = pair.before + pair.after;
  if (before === undefined || after === undefined || !(total > 0)) return next;
  const lowest = minimum.before;
  const highest = total - minimum.after;
  if (lowest > highest) return next;
  const placed = Math.min(Math.max(pair.before + delta, lowest), highest);
  const shared = before + after;
  next[index] = (shared * placed) / total;
  next[index + 1] = shared - next[index]!;
  return next;
}

/** Every child the same share: what a double-click on any of a split's lines puts back. */
export function equalShares(count: number): number[] {
  return count > 0 ? Array.from({ length: count }, () => 1 / count) : [];
}

/**
 * The pixels one key moves the line, or `undefined` for a key that does not move it. A line
 * between groups side by side moves left and right, one between groups stacked moves up and
 * down; the other two arrows are the person's to use for something else.
 */
export function keyboardDelta(key: string, direction: SplitDirection): number | undefined {
  const keys = direction === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  if (key === keys[0]) return -KEYBOARD_STEP;
  if (key === keys[1]) return KEYBOARD_STEP;
  return undefined;
}

/** `aria-valuenow`: the share before the line, as a percentage of the pair it divides. */
export function separatorValue(sizes: readonly number[], index: number): number {
  const before = sizes[index] ?? 0;
  const shared = before + (sizes[index + 1] ?? 0);
  return shared > 0 ? Math.round((100 * before) / shared) : 50;
}

/**
 * `aria-valuemin` and `aria-valuemax` for a pair measured at `pair`: how far each neighbour's
 * minimum lets the line go, in the same percentage. An unmeasured pair (no layout yet) is 0-100.
 */
export function separatorBounds(
  pair: PairSize,
  minimum: PairSize,
): { readonly min: number; readonly max: number } {
  const total = pair.before + pair.after;
  if (!(total > 0) || minimum.before + minimum.after > total) return { min: 0, max: 100 };
  return {
    min: Math.round((100 * minimum.before) / total),
    max: Math.round((100 * (total - minimum.after)) / total),
  };
}
