/*
 * The arrangement pieces as they were before TYTO-891, copied verbatim from origin/main
 * (7201ccba: blocks.ts, mark.ts, icons.ts, rhythm.ts) by a script that slices them out of the
 * files and only renames them, so the tests can hold the new forms to them byte for byte.
 */
import { group, solid, vector } from '@tyto/core/template';

import { type Align, type Anchor, type Block, type Padding, anchorOf, block } from './blocks.js';

import type { Icon } from './icons.js';
import type { Mark } from './mark.js';
import type { Spaced, WeightedSpacing } from './rhythm.js';
import type { GroupDraft, NodeDraft } from '@tyto/core/template';

interface Sides {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface StackOptions {
  readonly items: readonly Block[];
  readonly gap?: number;
  readonly align?: Align;
  readonly name?: string;
}

export interface RowOptions {
  readonly items: readonly Block[];
  readonly gap?: number;
  readonly align?: Align;
  readonly name?: string;
}

export interface InsetOptions {
  readonly item: Block;
  readonly padding: Padding;
  readonly name?: string;
}

export function oldAnchorAcross(
  items: readonly Block[],
  offsets: readonly number[],
): { readonly anchor?: Anchor } {
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return {};
  if (!items.some((item) => item.anchor !== undefined)) return {};
  return {
    anchor: {
      capTop: offsets[0]! + anchorOf(first).capTop,
      baseline: offsets[items.length - 1]! + anchorOf(last).baseline,
    },
  };
}

function oldSidesOf(padding: Padding): Sides {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  const [top, right, bottom, left] = padding;
  return { top, right, bottom, left };
}

function oldShifted(draft: NodeDraft, dx: number, dy: number): NodeDraft {
  const transform = {
    ...draft.transform,
    x: draft.transform.x + dx,
    y: draft.transform.y + dy,
  };
  switch (draft.kind) {
    case 'group':
      return { ...draft, transform };
    case 'rect':
      return { ...draft, transform };
    case 'text':
      return { ...draft, transform };
    case 'image':
      return { ...draft, transform };
    case 'vector':
      return { ...draft, transform };
  }
}

function oldOffsetFor(align: Align, room: number, size: number): number {
  switch (align) {
    case 'start':
      return 0;
    case 'center':
      return (room - size) / 2;
    case 'end':
      return room - size;
  }
}

export function oldStack(options: StackOptions): Block {
  const gap = options.gap ?? 0;
  const align = options.align ?? 'start';
  const width = options.items.reduce((widest, item) => Math.max(widest, item.width), 0);

  let y = 0;
  const children: NodeDraft[] = [];
  const tops: number[] = [];
  for (const item of options.items) {
    children.push(oldShifted(item.draft, oldOffsetFor(align, width, item.width), y));
    tops.push(y);
    y += item.height + gap;
  }

  // The trailing gap is charged per neighbour, so an empty stack is 0 and a stack of one
  // is exactly its child.
  const height = options.items.length === 0 ? 0 : y - gap;
  return {
    width,
    height,
    draft: oldGroupOf(children, options.name),
    ...oldAnchorAcross(options.items, tops),
  };
}

export function oldRow(options: RowOptions): Block {
  const gap = options.gap ?? 0;
  const align = options.align ?? 'start';
  const height = options.items.reduce((tallest, item) => Math.max(tallest, item.height), 0);

  let x = 0;
  const children: NodeDraft[] = [];
  const tops: number[] = [];
  for (const item of options.items) {
    const top = oldOffsetFor(align, height, item.height);
    children.push(oldShifted(item.draft, x, top));
    tops.push(top);
    x += item.width + gap;
  }

  const width = options.items.length === 0 ? 0 : x - gap;
  return {
    width,
    height,
    draft: oldGroupOf(children, options.name),
    ...oldAnchorAcross(options.items, tops),
  };
}

export function oldInset(options: InsetOptions): Block {
  const sides = oldSidesOf(options.padding);
  return {
    width: options.item.width + sides.left + sides.right,
    height: options.item.height + sides.top + sides.bottom,
    draft: oldGroupOf([oldShifted(options.item.draft, sides.left, sides.top)], options.name),
    ...oldAnchorAcross([options.item], [sides.top]),
  };
}

function oldGroupOf(children: readonly NodeDraft[], name: string | undefined): GroupDraft {
  return group({ children, ...(name === undefined ? {} : { name }) });
}

export function oldMark(shape: Mark, height: number, fill: string, name: string): Block {
  const scale = height / shape.box.h;

  return block(
    shape.box.w * scale,
    height,
    vector({
      name,
      geometry: { kind: 'path', d: shape.d, fillRule: shape.fillRule },
      size: shape.box,
      fill: solid(fill),
      transform: { scaleX: scale, scaleY: scale },
    }),
  );
}

const OLD_NO_FILL = solid({ r: 0, g: 0, b: 0, a: 0 });

export function oldIcon(shape: Icon, height: number, color: string, name: string): Block {
  const scale = height / shape.box.h;
  const paint =
    shape.paint.kind === 'fill'
      ? { fill: solid(color) }
      : {
          fill: OLD_NO_FILL,
          stroke: {
            paint: solid(color),
            width: shape.paint.width,
            align: 'center' as const,
          },
        };
  return block(
    shape.box.w * scale,
    height,
    vector({
      name,
      geometry: { kind: 'path', d: shape.d, fillRule: shape.fillRule ?? 'nonzero' },
      size: shape.box,
      ...paint,
      transform: { scaleX: scale, scaleY: scale },
    }),
  );
}

export function oldSpaceByWeight(spacing: WeightedSpacing): Spaced {
  const { top, bottom, heights, weights } = spacing;
  if (weights.length !== heights.length + 1) {
    throw new RangeError(
      `spaceByWeight takes ${String(heights.length + 1)} weights for ${String(heights.length)} blocks, got ${String(weights.length)}`,
    );
  }
  const used = heights.reduce((sum, height) => sum + height, 0);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const free = bottom - top - used;
  const unit = free > 0 && totalWeight > 0 ? free / totalWeight : 0;

  const tops: number[] = [];
  let cursor = top;
  heights.forEach((height, index) => {
    cursor += (weights[index] ?? 0) * unit;
    tops.push(cursor);
    cursor += height;
  });
  return { tops, unit, overflow: Math.max(0, -free) };
}
