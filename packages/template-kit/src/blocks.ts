import type { ImageDraft, NodeDraft, RectDraft, VectorDraft } from '@tyto/core/template';

import { area, areaIn, shifted } from './area.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

export { anchorOf } from './area.js';

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
  /**
   * Where a block's words sit, in its own coordinates (ADR 0230 decision 2): the top of the
   * first line's capitals and the baseline of the last line. A block of text answers it; a block
   * with no text leaves it out, and is read as {@link anchorOf} reads it: its own top and foot.
   */
  readonly anchor?: Anchor;
}

/** The top of a block's first capitals and its last baseline, from the block's top. */
export interface Anchor {
  readonly capTop: number;
  readonly baseline: number;
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

/**
 * Children one below the next, top to bottom. The stack is as wide as its widest child.
 *
 * The form every template written before TYTO-891 calls; it is {@link stackIn} over an
 * unbounded area and draws the same bytes.
 */
export function stack(options: StackOptions): Block {
  return blockOnly(
    stackIn(
      UNBOUNDED,
      options.items,
      { gap: options.gap ?? 0, align: options.align ?? 'start' },
      { ...(options.name === undefined ? {} : { name: options.name }) },
    ),
  );
}

export interface RowOptions {
  readonly items: readonly Block[];
  readonly gap?: number;
  /** Where a shorter child sits across the row. Defaults to `start`. */
  readonly align?: Align;
  readonly name?: string;
}

/** Children left to right. The row is as tall as its tallest child; {@link rowIn}, unbounded. */
export function row(options: RowOptions): Block {
  return blockOnly(
    rowIn(
      UNBOUNDED,
      options.items,
      { gap: options.gap ?? 0, align: options.align ?? 'start' },
      { ...(options.name === undefined ? {} : { name: options.name }) },
    ),
  );
}

export interface InsetOptions {
  readonly item: Block;
  readonly padding: Padding;
  readonly name?: string;
}

/** The same block with room around it, grown by the padding; {@link insetIn}, unbounded. */
export function inset(options: InsetOptions): Block {
  const sides = sidesOf(options.padding);
  return blockOnly(
    insetIn(UNBOUNDED, options.item, sides, {
      ...(options.name === undefined ? {} : { name: options.name }),
    }),
  );
}

/* --------------------------------------------------------- the area-taking forms -- */

const UNBOUNDED: Area = { width: Infinity, height: Infinity };

/** A block without what an area-taking form adds to it: the shape the older forms return. */
function blockOnly(item: Block & { readonly overflow: number }): Block {
  return {
    width: item.width,
    height: item.height,
    draft: item.draft,
    ...(item.anchor === undefined ? {} : { anchor: item.anchor }),
  };
}

/** The numbers a stack uses (TYTO-891, ADR 0224 decision 2); defaults are the older form's. */
export const STACK_PARAMETERS = {
  gap: {
    kind: 'length',
    default: 0,
    description: 'Space between neighbours, in px; an item may state its own gap above it.',
  },
  align: {
    kind: 'choice',
    default: 'start',
    choices: ['start', 'center', 'end'],
    description: 'Where a narrower child sits across the stack.',
  },
  measureFrom: {
    kind: 'choice',
    default: 'box',
    choices: ['box', 'capitals'],
    description:
      "Where a gap runs from: one box's foot to the next one's top, or one block's last " +
      "baseline to the next one's first capitals (ADR 0230 decision 2).",
  },
} as const satisfies ParameterSchema;

export type StackParameters = ValuesOf<typeof STACK_PARAMETERS>;

/** A stack's item with its own gap above it, instead of the stack's. */
export interface StackItem {
  readonly item: Block;
  readonly gapAbove: number;
}

/**
 * Children one below the next in `area`: as wide as the area when it has a width, else as its
 * widest child; each gap the stack's or the item's own. With `measureFrom: 'capitals'` a gap
 * runs from the block above's last baseline to the next one's first capitals, each read by its
 * anchor (a block with none, by its box). `overflow` is how far it runs past a bounded area.
 *
 * A shortcut over {@link area} (ADR 0232): a column that fills the area's width and never
 * collapses, laid out by the same arithmetic it always used, so its bytes stay.
 */
export function stackIn(
  room: Area,
  items: readonly (Block | StackItem)[],
  given: Partial<StackParameters> = {},
  options: { readonly name?: string } = {},
): Block & { readonly overflow: number } {
  const values = parameterValues(STACK_PARAMETERS, given);
  return areaIn(
    room,
    area({
      ...options,
      flow: 'column',
      ...values,
      width: 'fill',
      collapse: 'never',
      children: items,
    }),
  );
}

/** The numbers a row uses; defaults are the older form's. */
export const ROW_PARAMETERS = {
  gap: { kind: 'length', default: 0, description: 'Space between neighbours, in px.' },
  align: {
    kind: 'choice',
    default: 'start',
    choices: ['start', 'center', 'end'],
    description: 'Where a shorter child sits down the row.',
  },
} as const satisfies ParameterSchema;

export type RowParameters = ValuesOf<typeof ROW_PARAMETERS>;

/**
 * Children left to right in `area`: as tall as the area when it has a height, else as its
 * tallest child. `overflow` is how far it runs past a bounded width. A shortcut over
 * {@link area}: a row that fills the area's height (ADR 0232).
 */
export function rowIn(
  room: Area,
  items: readonly Block[],
  given: Partial<RowParameters> = {},
  options: { readonly name?: string } = {},
): Block & { readonly overflow: number } {
  const values = parameterValues(ROW_PARAMETERS, given);
  return areaIn(
    room,
    area({
      ...options,
      flow: 'row',
      ...values,
      height: 'fill',
      collapse: 'never',
      children: items,
    }),
  );
}

/** The room an inset adds on each side; defaults are none. */
export const INSET_PARAMETERS = {
  top: { kind: 'length', default: 0, description: 'Room above the block, in px.' },
  right: { kind: 'length', default: 0, description: 'Room right of the block, in px.' },
  bottom: { kind: 'length', default: 0, description: 'Room below the block, in px.' },
  left: { kind: 'length', default: 0, description: 'Room left of the block, in px.' },
} as const satisfies ParameterSchema;

export type InsetParameters = ValuesOf<typeof INSET_PARAMETERS>;

/**
 * `item` with room around it, grown by the room rather than clipped to it. `overflow` is how
 * far the result runs past a bounded area's height. A shortcut over {@link area}: a column with
 * padding that hugs its one child (ADR 0232).
 */
export function insetIn(
  room: Area,
  item: Block,
  given: Partial<InsetParameters> = {},
  options: { readonly name?: string } = {},
): Block & { readonly overflow: number } {
  const sides = parameterValues(INSET_PARAMETERS, given);
  return areaIn(
    room,
    area({
      ...options,
      padding: [sides.top, sides.right, sides.bottom, sides.left],
      collapse: 'never',
      children: [item],
    }),
  );
}

/**
 * A block's draft, moved to where it belongs in the frame.
 *
 * The one place a coordinate is written by hand, which is the point: everything inside an
 * arrangement is relative, and a template says once where the arrangement starts. It returns a
 * draft, not a block, so a block's anchor ends here: to put a text's capitals at a height, place
 * it at that height less `anchorOf(item).capTop`.
 */
export function at(x: number, y: number, item: Block): NodeDraft {
  return shifted(item.draft, x, y);
}
