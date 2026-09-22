import type {
  GroupDraft,
  ImageDraft,
  NodeDraft,
  RectDraft,
  VectorDraft,
} from '@tyto/core/template';
import { group } from '@tyto/core/template';

/**
 * Arrangement for a template written in TypeScript: stacks, rows and padding, resolved to
 * the absolute coordinates the IR wants (`docs/ir-schema.md`).
 *
 * ## Why a block states its own size
 *
 * Nothing downstream can work one out. A `group` in the IR is a transform and a list with
 * **no box at all** (`packages/core/src/scene/bounds.ts`: "a group has no box"), and a
 * text node's `box` leaves both dimensions optional, because an absent one means "as large
 * as the content needs" — a size only `layoutText` learns, and it runs after the template
 * has already returned (`packages/core/src/brief/compile.ts`).
 *
 * So the height that a stack needs in order to place the next child does not exist
 * anywhere a stack could read it. It has to be stated, which is what {@link Block} is: a
 * draft plus the two numbers the IR cannot supply. Making that explicit in the type is the
 * point — it puts the one real limit of this route where an author trips over it early,
 * instead of in a layout that silently overlaps.
 *
 * A template that wants a box to grow with its text still cannot have one. That needs a
 * template to be able to measure, which it cannot (TYTO-162), and no helper here pretends
 * otherwise.
 *
 * ## Why an offset adds
 *
 * Placing a child sets no coordinate; it **adds** to the one the child already carries. A
 * child written with `transform: { x: 4 }` inside a stack lands four pixels right of its
 * slot rather than losing the nudge, and a caller never has to know whether an arrangement
 * helper or the node itself won.
 */

/**
 * A draft that knows how much room it takes.
 *
 * Returned by every helper here as well as accepted by them, so a stack of rows of stacks
 * composes without anybody restating a number.
 */
export interface Block {
  readonly width: number;
  readonly height: number;
  readonly draft: NodeDraft;
}

/** Cross-axis placement of a child smaller than the arrangement around it. */
export type Align = 'start' | 'center' | 'end';

/** Padding as one number for all four sides, or `[top, right, bottom, left]` like CSS. */
export type Padding = number | readonly [number, number, number, number];

interface Sides {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

function sidesOf(padding: Padding): Sides {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  const [top, right, bottom, left] = padding;
  return { top, right, bottom, left };
}

/**
 * The same draft, moved.
 *
 * Returns `NodeDraft` rather than the caller's narrower type: a block holds the union
 * anyway, and preserving the member would cost a cast for a precision nothing here uses.
 */
function shifted(draft: NodeDraft, dx: number, dy: number): NodeDraft {
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

function offsetFor(align: Align, room: number, size: number): number {
  switch (align) {
    case 'start':
      return 0;
    case 'center':
      return (room - size) / 2;
    case 'end':
      return room - size;
  }
}

/** A block from a draft whose size the caller already has in hand. */
export function block(width: number, height: number, draft: NodeDraft): Block {
  return { width, height, draft };
}

/**
 * A block from a node that carries its own `size` — a rect, an image or a vector.
 *
 * Text and groups are absent from the parameter type on purpose: neither can answer, and
 * an overload that guessed would be the silent overlap this module exists to prevent.
 */
export function sized(draft: RectDraft | ImageDraft | VectorDraft): Block {
  return { width: draft.size.w, height: draft.size.h, draft };
}

export interface StackOptions {
  readonly items: readonly Block[];
  /** Space between neighbours; it does not appear above the first or below the last. */
  readonly gap?: number;
  /** Where a narrower child sits across the stack. Defaults to `start`. */
  readonly align?: Align;
  /** Passed to the wrapping group, so a scene reads back in the author's words. */
  readonly name?: string;
}

/** Children one below the next, top to bottom. The stack is as wide as its widest child. */
export function stack(options: StackOptions): Block {
  const gap = options.gap ?? 0;
  const align = options.align ?? 'start';
  const width = options.items.reduce((widest, item) => Math.max(widest, item.width), 0);

  let y = 0;
  const children: NodeDraft[] = [];
  for (const item of options.items) {
    children.push(shifted(item.draft, offsetFor(align, width, item.width), y));
    y += item.height + gap;
  }

  // The trailing gap is charged per neighbour, so an empty stack is 0 and a stack of one
  // is exactly its child.
  const height = options.items.length === 0 ? 0 : y - gap;
  return { width, height, draft: groupOf(children, options.name) };
}

export interface RowOptions {
  readonly items: readonly Block[];
  readonly gap?: number;
  /** Where a shorter child sits across the row. Defaults to `start`. */
  readonly align?: Align;
  readonly name?: string;
}

/** Children left to right. The row is as tall as its tallest child. */
export function row(options: RowOptions): Block {
  const gap = options.gap ?? 0;
  const align = options.align ?? 'start';
  const height = options.items.reduce((tallest, item) => Math.max(tallest, item.height), 0);

  let x = 0;
  const children: NodeDraft[] = [];
  for (const item of options.items) {
    children.push(shifted(item.draft, x, offsetFor(align, height, item.height)));
    x += item.width + gap;
  }

  const width = options.items.length === 0 ? 0 : x - gap;
  return { width, height, draft: groupOf(children, options.name) };
}

export interface InsetOptions {
  readonly item: Block;
  readonly padding: Padding;
  readonly name?: string;
}

/** The same block with room around it, grown by the padding rather than clipped to it. */
export function inset(options: InsetOptions): Block {
  const sides = sidesOf(options.padding);
  return {
    width: options.item.width + sides.left + sides.right,
    height: options.item.height + sides.top + sides.bottom,
    draft: groupOf([shifted(options.item.draft, sides.left, sides.top)], options.name),
  };
}

/**
 * A block's draft, moved to where it belongs in the frame.
 *
 * The one place a coordinate is written by hand, which is the point: everything inside an
 * arrangement is relative, and a template says once where the arrangement starts.
 */
export function at(x: number, y: number, item: Block): NodeDraft {
  return shifted(item.draft, x, y);
}

function groupOf(children: readonly NodeDraft[], name: string | undefined): GroupDraft {
  return group({ children, ...(name === undefined ? {} : { name }) });
}
