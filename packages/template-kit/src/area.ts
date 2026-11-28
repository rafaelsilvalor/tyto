import type { GroupDraft, NodeDraft } from '@tyto/core/template';
import { group } from '@tyto/core/template';

import type { Anchor, Block, Padding } from './blocks.js';
import { columnOrder } from './order.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

/**
 * The layout area (TYTO-912, ADR 0232): one piece that groups children, sets the gaps, the
 * order and the flow between them, sizes each one fixed, by its content or by the room left,
 * floats some above the flow, and nests in itself.
 *
 * ## Why a description and not a block
 *
 * Every other arrangement of the kit receives its children already built, so a child is
 * measured before its parent knows how much room it gets. An area holds its children unbuilt
 * and becomes a {@link Block} only when {@link areaIn} offers it room: it measures the children
 * whose size does not depend on the room, splits what is left among the ones that fill, and only
 * then builds each child with its final room. A nested area repeats this inside the room it was
 * given. That is also the shape of a node in the editor ADR 0224 anticipates: parameters a panel
 * can read, and inputs wired to other nodes.
 *
 * ## The seams left for the cards after this one
 *
 * The draft is a group of the flow's children followed by the floats: a box the area draws
 * (TYTO-913) goes first, under both. `flow` is the one place a grid or a wrapping row enters
 * (TYTO-914), and `children` is a plain list a repeat over a brief list can produce (TYTO-915).
 */

/* ----------------------------------------------------------------- the helpers -- */

/** A block's anchor, or its box's own edges when it has none (ADR 0230 decision 2). */
export function anchorOf(item: Block): Anchor {
  return item.anchor ?? { capTop: 0, baseline: item.height };
}

/**
 * The anchor of an arrangement: its first child's capitals and its last child's baseline, each
 * moved by where the arrangement put it. Absent when no child has words, so a block of shapes
 * reads exactly as it did before anchors existed.
 */
function anchorAcross(
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

/**
 * The same draft, moved.
 *
 * Returns `NodeDraft` rather than the caller's narrower type: a block holds the union
 * anyway, and preserving the member would cost a cast for a precision nothing here uses.
 */
export function shifted(draft: NodeDraft, dx: number, dy: number): NodeDraft {
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

/** Where a child of `size` starts in `room` on the cross axis; `stretch` places at the start. */
export function offsetFor(
  align: 'start' | 'center' | 'end' | 'stretch',
  room: number,
  size: number,
): number {
  switch (align) {
    case 'start':
    case 'stretch':
      return 0;
    case 'center':
      return (room - size) / 2;
    case 'end':
      return room - size;
  }
}

export function groupOf(children: readonly NodeDraft[], name: string | undefined): GroupDraft {
  return group({ children, ...(name === undefined ? {} : { name }) });
}

/** How far a size runs past a bounded room; 0 for an unbounded one. */
export function overrun(size: number, room: number): number {
  return Number.isFinite(room) ? Math.max(0, size - room) : 0;
}

/* ------------------------------------------------------------------ the schema -- */

const SIZE_MODES = ['auto', 'hug', 'fill', 'fixed'] as const;

/**
 * The area's own numbers and words (ADR 0224 decision 2, ADR 0232). Its size is here so a node
 * panel can show it; a child's size in its parent is the child's own (an area's) or its slot's.
 */
export const AREA_PARAMETERS = {
  flow: {
    kind: 'choice',
    default: 'column',
    choices: ['column', 'row'],
    description: 'The direction the children follow: down a column or along a row.',
  },
  gap: {
    kind: 'length',
    default: 0,
    description: 'Space between neighbours, in px; a child may state its own gap above it.',
  },
  measureFrom: {
    kind: 'choice',
    default: 'box',
    choices: ['box', 'capitals'],
    description:
      "Where a gap in a column runs from: one box's foot to the next one's top, or one block's " +
      "last baseline to the next one's first capitals (ADR 0230 decision 2). A row reads boxes.",
  },
  justify: {
    kind: 'choice',
    default: 'start',
    choices: ['start', 'center', 'end', 'space-between'],
    description: 'Where the children sit along the flow when the area is larger than they are.',
  },
  align: {
    kind: 'choice',
    default: 'start',
    choices: ['start', 'center', 'end', 'stretch'],
    description:
      'Where a child sits across the flow; stretch gives a child with no size of its own the ' +
      "area's whole width (in a column) or height (in a row).",
  },
  paddingTop: { kind: 'length', default: 0, description: 'Room inside the area, above, in px.' },
  paddingRight: { kind: 'length', default: 0, description: 'Room inside, on the right, in px.' },
  paddingBottom: { kind: 'length', default: 0, description: 'Room inside, below, in px.' },
  paddingLeft: { kind: 'length', default: 0, description: 'Room inside, on the left, in px.' },
  widthMode: {
    kind: 'choice',
    default: 'auto',
    choices: SIZE_MODES,
    description:
      'How wide the area is: by its content (hug), the room it is offered (fill), `width` ' +
      '(fixed), or auto: hug, or fill when its parent stretches it.',
  },
  width: { kind: 'length', default: 0, min: 0, description: 'The width when fixed, in px.' },
  widthWeight: {
    kind: 'ratio',
    default: 1,
    min: 0,
    description: "The area's share of the room left in a row, against its neighbours that fill.",
  },
  heightMode: {
    kind: 'choice',
    default: 'auto',
    choices: SIZE_MODES,
    description: 'How tall the area is, as `widthMode` says it for the width.',
  },
  height: { kind: 'length', default: 0, min: 0, description: 'The height when fixed, in px.' },
  heightWeight: {
    kind: 'ratio',
    default: 1,
    min: 0,
    description: "The area's share of the room left in a column, against its neighbours.",
  },
  minWidth: {
    kind: 'length',
    default: 0,
    min: 0,
    description: 'The narrowest it gets; 0 is none.',
  },
  maxWidth: {
    kind: 'length',
    default: Infinity,
    min: 0,
    description: 'The widest it gets, in px.',
  },
  minHeight: {
    kind: 'length',
    default: 0,
    min: 0,
    description: 'The shortest it gets; 0 is none.',
  },
  maxHeight: {
    kind: 'length',
    default: Infinity,
    min: 0,
    description: 'The tallest it gets, in px.',
  },
  collapse: {
    kind: 'choice',
    default: 'when-empty',
    choices: ['when-empty', 'never'],
    description:
      'Whether an area with no child in its flow takes no room and no gap in its parent.',
  },
} as const satisfies ParameterSchema;

export type AreaParameters = ValuesOf<typeof AREA_PARAMETERS>;

/* ------------------------------------------------------------------- the types -- */

/**
 * A size: a number of px, `'hug'` (the content's), `'fill'` (the room left, weight 1),
 * `{ fill: weight }`, or `'auto'` (hug, or fill when the parent stretches it).
 */
export type AreaSize = number | 'auto' | 'hug' | 'fill' | { readonly fill: number };

/** A point of the parent's box a floating child is held to. */
export type FloatAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

/** A child out of the flow: held to a point of its parent's box, moved by `x` and `y`. */
export interface Float {
  readonly anchor: FloatAnchor;
  readonly x?: number;
  readonly y?: number;
}

/**
 * A child built from the room it is given: any kit piece that takes an area, wrapped as
 * `(room) => capTextIn(room, …)`. Answering `undefined` makes it absent: no room, no gap.
 */
export type Leaf = (room: Area) => Block | undefined;

export type AreaItem = AreaDescription | Leaf | Block;

/**
 * A child with what its parent needs to know about it. Today's `StackItem` (`{ item, gapAbove }`)
 * is one. An absent `item` is an optional child the brief left out.
 */
export interface AreaSlot {
  readonly item: AreaItem | undefined | null | false;
  /** The name `order` reads; an area child's own name otherwise. */
  readonly name?: string;
  readonly width?: AreaSize;
  readonly height?: AreaSize;
  /** The least room along the flow; 0 is none. */
  readonly min?: number;
  /** The most room along the flow. */
  readonly max?: number;
  /** This child's gap above (or before) it, instead of the area's. */
  readonly gapAbove?: number;
  /** Out of the flow, held to a point of the area's box and drawn above the flow. */
  readonly float?: Float;
}

/** A child as written: an item, a slot around one, or nothing (an absent optional child). */
export type AreaChild = AreaItem | AreaSlot | undefined | null | false;

/** An area not yet laid out: what {@link area} returns and {@link areaIn} lays out. */
export interface AreaDescription {
  readonly kind: 'area';
  readonly name?: string;
  readonly parameters: AreaParameters;
  /** The brief's order (`context.order`); absent keeps the children in source order. */
  readonly order?: readonly { readonly name: string }[] | undefined;
  readonly children: readonly AreaChild[];
}

export interface AreaOptions extends Partial<
  Omit<
    AreaParameters,
    | 'width'
    | 'height'
    | 'widthMode'
    | 'heightMode'
    | 'widthWeight'
    | 'heightWeight'
    | 'paddingTop'
    | 'paddingRight'
    | 'paddingBottom'
    | 'paddingLeft'
  >
> {
  readonly name?: string;
  readonly width?: AreaSize;
  readonly height?: AreaSize;
  readonly padding?: Padding;
  readonly order?: readonly { readonly name: string }[] | undefined;
  readonly children: readonly AreaChild[];
}

/* ------------------------------------------------------------- the description -- */

type SizeMode = (typeof SIZE_MODES)[number];

interface SizeValues {
  readonly mode?: SizeMode;
  readonly length?: number;
  readonly weight?: number;
}

function sizeValues(size: AreaSize | undefined): SizeValues {
  if (size === undefined) return {};
  if (typeof size === 'number') return { mode: 'fixed', length: size };
  if (typeof size === 'string') return { mode: size };
  return { mode: 'fill', weight: size.fill };
}

function paddingValues(padding: Padding | undefined): Partial<AreaParameters> {
  if (padding === undefined) return {};
  const [top, right, bottom, left] =
    typeof padding === 'number' ? [padding, padding, padding, padding] : padding;
  return { paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left };
}

/** An area, described: nothing is measured or drawn until {@link areaIn} offers it room. */
export function area(options: AreaOptions): AreaDescription {
  const { name, width, height, padding, order, children, ...scalars } = options;
  const across = sizeValues(width);
  const down = sizeValues(height);
  const given: Partial<AreaParameters> = {
    ...scalars,
    ...paddingValues(padding),
    ...(across.mode === undefined ? {} : { widthMode: across.mode }),
    ...(across.length === undefined ? {} : { width: across.length }),
    ...(across.weight === undefined ? {} : { widthWeight: across.weight }),
    ...(down.mode === undefined ? {} : { heightMode: down.mode }),
    ...(down.length === undefined ? {} : { height: down.length }),
    ...(down.weight === undefined ? {} : { heightWeight: down.weight }),
  };
  return {
    kind: 'area',
    ...(name === undefined ? {} : { name }),
    parameters: parameterValues(AREA_PARAMETERS, given),
    ...(order === undefined ? {} : { order }),
    children,
  };
}

/* ------------------------------------------------------------------ the layout -- */

/** How one axis of a child is sized once its parent has decided. */
type Resolved =
  | { readonly mode: 'hug' }
  | { readonly mode: 'fill'; readonly weight: number }
  | { readonly mode: 'fixed'; readonly size: number };

const HUG: Resolved = { mode: 'hug' };

type Laid = Block & { readonly overflow: number };

interface Entry {
  readonly item: AreaItem;
  readonly slot: Omit<AreaSlot, 'item'>;
  /** The slot's name, the area's own, or one no order can name: the child keeps its place. */
  readonly name: string;
}

function isArea(item: AreaItem): item is AreaDescription {
  return typeof item !== 'function' && 'kind' in item && item.kind === 'area';
}

function entryOf(child: AreaChild, index: number): Entry[] {
  if (child === undefined || child === null || child === false) return [];
  const slotted = typeof child !== 'function' && 'item' in child;
  const item = slotted ? child.item : child;
  if (item === undefined || item === null || item === false) return [];
  const slot: Omit<AreaSlot, 'item'> = slotted ? child : {};
  const own = isArea(item) ? item.name : undefined;
  return [{ item, slot, name: slot.name ?? own ?? `\u0000child ${index}` }];
}

/** An area's own size on one axis, as its parameters state it. */
function ownSize(parameters: AreaParameters, axis: 'width' | 'height'): AreaSize {
  const mode = axis === 'width' ? parameters.widthMode : parameters.heightMode;
  switch (mode) {
    case 'fixed':
      return axis === 'width' ? parameters.width : parameters.height;
    case 'fill':
      return { fill: axis === 'width' ? parameters.widthWeight : parameters.heightWeight };
    default:
      return mode;
  }
}

/** A size floored by `min` (0 is no floor) and capped by `max`. */
function bounded(size: number, min: number, max: number): number {
  if (size > max) return max;
  if (min > 0 && size < min) return min;
  return size;
}

/** The room a resolved axis has: its fixed size, or the room when it fills a bounded one. */
function definite(resolved: Resolved, room: number): number | undefined {
  if (resolved.mode === 'fixed') return resolved.size;
  if (resolved.mode === 'fill' && Number.isFinite(room)) return room;
  return undefined;
}

/** Room offered to a child on one axis, by how that axis was resolved. */
function roomFor(resolved: Resolved, bound: number, share?: number): number {
  if (resolved.mode === 'fixed') return resolved.size;
  if (resolved.mode === 'fill') return share ?? bound;
  return bound;
}

function build(item: AreaItem, room: Area, width: Resolved, height: Resolved): Block | undefined {
  if (typeof item === 'function') return item(room) ?? undefined;
  if (isArea(item)) return layOut(item, room, width, height);
  return item;
}

interface Placed {
  readonly offsets: readonly number[];
  readonly content: number;
}

/**
 * Where each child starts along the flow, and how long the flow is. In box mode it is the
 * arithmetic `stackIn` and `rowIn` always did, a sum added at a time, so their bytes stay.
 */
function place(
  sizes: readonly number[],
  anchors: readonly Anchor[],
  gaps: readonly number[],
  gap: number,
  capitals: boolean,
): Placed {
  const offsets: number[] = [];
  let at = 0;
  for (let index = 0; index < sizes.length; index += 1) {
    if (index > 0) {
      at = capitals
        ? offsets[index - 1]! + anchors[index - 1]!.baseline + gaps[index]! - anchors[index]!.capTop
        : at + (sizes[index - 1]! + gaps[index]!);
    }
    offsets.push(at);
  }
  const last = sizes[sizes.length - 1];
  const content = last === undefined ? 0 : capitals ? at + last : at + (last + gap) - gap;
  return { offsets, content };
}

/** Shares of `free` by weight, each within its bounds, freezing the ones a bound holds. */
function shares(
  free: number,
  fills: readonly { readonly weight: number; readonly min: number; readonly max: number }[],
): number[] {
  const result: (number | undefined)[] = fills.map(() => undefined);
  let left = free;
  for (;;) {
    const open = fills.map((_, index) => index).filter((index) => result[index] === undefined);
    if (open.length === 0) break;
    const total = open.reduce((sum, index) => sum + fills[index]!.weight, 0);
    const raw = (index: number): number =>
      total > 0 ? Math.max(0, (left * fills[index]!.weight) / total) : 0;
    const held = open.filter((index) => {
      const fill = fills[index]!;
      return bounded(raw(index), fill.min, fill.max) !== raw(index);
    });
    if (held.length === 0) {
      for (const index of open) result[index] = raw(index);
      break;
    }
    for (const index of held) {
      const fill = fills[index]!;
      result[index] = bounded(raw(index), fill.min, fill.max);
      left -= result[index]!;
    }
  }
  return result.map((share) => share ?? 0);
}

const FRACTIONS: Readonly<Record<FloatAnchor, readonly [number, number]>> = {
  'top-left': [0, 0],
  top: [0.5, 0],
  'top-right': [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  'bottom-left': [0, 1],
  bottom: [0.5, 1],
  'bottom-right': [1, 1],
};

interface Child {
  readonly entry: Entry;
  readonly main: Resolved;
  readonly cross: Resolved;
  readonly min: number;
  readonly max: number;
  block?: Block | undefined;
  /** Its room along the flow, once known. */
  size?: number;
  absent?: boolean;
}

/**
 * Lay out an area in `room`, its own size on each axis already resolved by its parent (or by
 * {@link areaIn} from its parameters). `undefined` when it collapses.
 */
function layOut(
  description: AreaDescription,
  room: Area,
  resolvedWidth: Resolved,
  resolvedHeight: Resolved,
): Laid | undefined {
  const parameters = description.parameters;
  const column = parameters.flow === 'column';
  const capitals = column && parameters.measureFrom === 'capitals';
  const [mainStart, mainEnd, crossStart, crossEnd] = column
    ? [
        parameters.paddingTop,
        parameters.paddingBottom,
        parameters.paddingLeft,
        parameters.paddingRight,
      ]
    : [
        parameters.paddingLeft,
        parameters.paddingRight,
        parameters.paddingTop,
        parameters.paddingBottom,
      ];
  const mainAxis = column ? 'height' : 'width';
  const crossAxis = column ? 'width' : 'height';
  const mainOf = (item: { readonly width: number; readonly height: number }): number =>
    item[mainAxis];
  const crossOf = (item: { readonly width: number; readonly height: number }): number =>
    item[crossAxis];
  const mainRoom = room[mainAxis];
  const crossRoom = room[crossAxis];
  const ownMainDefinite = definite(column ? resolvedHeight : resolvedWidth, mainRoom);
  const ownCrossDefinite = definite(column ? resolvedWidth : resolvedHeight, crossRoom);
  const innerMain =
    ownMainDefinite === undefined ? Infinity : ownMainDefinite - mainStart - mainEnd;
  const crossBound = (ownCrossDefinite ?? crossRoom) - crossStart - crossEnd;
  const [ownMin, ownMax] = column
    ? [parameters.minHeight, parameters.maxHeight]
    : [parameters.minWidth, parameters.maxWidth];
  const [ownCrossMin, ownCrossMax] = column
    ? [parameters.minWidth, parameters.maxWidth]
    : [parameters.minHeight, parameters.maxHeight];

  const entries = description.children.flatMap(entryOf);
  const flowing = columnOrder(
    entries.filter((entry) => entry.slot.float === undefined),
    description.order,
  );
  const floating = entries.filter((entry) => entry.slot.float !== undefined);

  const resolve = (entry: Entry, axis: 'width' | 'height', isMain: boolean): Resolved => {
    const written =
      entry.slot[axis] ?? (isArea(entry.item) ? ownSize(entry.item.parameters, axis) : 'auto');
    const size: AreaSize =
      written === 'auto' ? (!isMain && parameters.align === 'stretch' ? 'fill' : 'hug') : written;
    if (typeof size === 'number') return { mode: 'fixed', size };
    if (size === 'hug') return HUG;
    const weight = size === 'fill' ? 1 : size.fill;
    // A fill with no definite room to share is measured by its content (ADR 0232).
    if (isMain ? innerMain === Infinity : !Number.isFinite(crossBound)) return HUG;
    return { mode: 'fill', weight };
  };
  const boundsOf = (entry: Entry): [number, number] => {
    const item = entry.item;
    const own = isArea(item)
      ? column
        ? [item.parameters.minHeight, item.parameters.maxHeight]
        : [item.parameters.minWidth, item.parameters.maxWidth]
      : [0, Infinity];
    return [entry.slot.min ?? own[0]!, entry.slot.max ?? own[1]!];
  };

  const children: Child[] = flowing.map((entry) => {
    const [min, max] = boundsOf(entry);
    return {
      entry,
      main: resolve(entry, mainAxis, true),
      cross: resolve(entry, crossAxis, false),
      min,
      max,
    };
  });
  const roomOf = (child: Child, main: number): Area => {
    const across = roomFor(child.cross, crossBound);
    return column ? { width: across, height: main } : { width: main, height: across };
  };
  const resolvedOf = (child: Child, main: Resolved): [Resolved, Resolved] =>
    column ? [child.cross, main] : [main, child.cross];

  // Pass one: the children whose room along the flow does not depend on the room left.
  for (const child of children) {
    if (child.main.mode === 'fill') continue;
    const mainRoomOf = child.main.mode === 'fixed' ? child.main.size : Infinity;
    child.block = build(
      child.entry.item,
      roomOf(child, mainRoomOf),
      ...resolvedOf(child, child.main),
    );
    if (child.block === undefined) {
      child.absent = true;
      continue;
    }
    if (child.main.mode === 'fixed') {
      child.size = child.main.size;
      continue;
    }
    const measured = mainOf(child.block);
    child.size = bounded(measured, child.min, child.max);
    const item = child.entry.item;
    if (child.size !== measured && (typeof item === 'function' || isArea(item))) {
      // A child held by its bounds is built again at the size it was held to; a ready block
      // keeps its size and sits at the start of the room it is given.
      const fixed: Resolved = { mode: 'fixed', size: child.size };
      child.block = build(item, roomOf(child, child.size), ...resolvedOf(child, fixed));
    }
  }

  const gapsOf = (present: readonly Child[]): number[] =>
    present.map((child, index) =>
      index === 0 ? 0 : (child.entry.slot.gapAbove ?? parameters.gap),
    );

  // Pass two: the room left, shared among the children that fill it, by weight.
  for (;;) {
    const present = children.filter((child) => child.absent !== true);
    const filling = present.filter((child) => child.main.mode === 'fill');
    if (filling.length === 0) break;
    const empty = place(
      present.map((child) => (child.main.mode === 'fill' ? 0 : child.size!)),
      present.map((child) =>
        child.main.mode === 'fill' || child.block === undefined
          ? { capTop: 0, baseline: 0 }
          : boxAnchor(child.block, mainOf),
      ),
      gapsOf(present),
      parameters.gap,
      capitals,
    );
    const split = shares(
      innerMain - empty.content,
      filling.map((child) => ({
        weight: child.main.mode === 'fill' ? child.main.weight : 0,
        min: child.min,
        max: child.max,
      })),
    );
    let dropped = false;
    for (const [index, child] of filling.entries()) {
      const share = split[index]!;
      const fixed: Resolved = { mode: 'fixed', size: share };
      child.block = build(child.entry.item, roomOf(child, share), ...resolvedOf(child, fixed));
      child.size = share;
      if (child.block === undefined) {
        child.absent = true;
        dropped = true;
      }
    }
    if (!dropped) break;
  }

  const present = children.filter((child) => child.absent !== true);
  if (present.length === 0 && parameters.collapse === 'when-empty') return undefined;
  const blocks = present.map((child) => child.block!);
  const sizes = present.map((child) => child.size!);
  const placed = place(
    sizes,
    blocks.map((item) => boxAnchor(item, mainOf)),
    gapsOf(present),
    parameters.gap,
    capitals,
  );

  // Along the flow: the content, the room the area holds, and where `justify` puts the content.
  const contentOuter = placed.content + mainStart + mainEnd;
  const ownMain = bounded(ownMainDefinite ?? contentOuter, ownMin, ownMax);
  const offsets = justified(
    placed.offsets,
    parameters.justify,
    ownMainDefinite === undefined ? 0 : Math.max(0, innerMain - placed.content),
  );

  // Across it: the area's own size, or its widest child's.
  const widest = blocks.reduce((most, item) => Math.max(most, crossOf(item)), 0);
  const ownCross = bounded(
    ownCrossDefinite ?? widest + crossStart + crossEnd,
    ownCrossMin,
    ownCrossMax,
  );
  const innerCross =
    ownCrossDefinite !== undefined || ownCross !== widest + crossStart + crossEnd
      ? ownCross - crossStart - crossEnd
      : widest;

  const drafts: NodeDraft[] = [];
  const tops: number[] = [];
  for (const [index, item] of blocks.entries()) {
    const along = mainStart + offsets[index]!;
    const across = crossStart + offsetFor(parameters.align, innerCross, crossOf(item));
    const [dx, dy] = column ? [across, along] : [along, across];
    drafts.push(shifted(item.draft, dx, dy));
    tops.push(dy);
  }

  const [width, height] = column ? [ownCross, ownMain] : [ownMain, ownCross];
  for (const entry of floating) {
    const item = build(entry.item, { width, height }, HUG, HUG);
    if (item === undefined) continue;
    const float = entry.slot.float!;
    const [across, down] = FRACTIONS[float.anchor];
    const dx = (across === 0 ? 0 : across * (width - item.width)) + (float.x ?? 0);
    const dy = (down === 0 ? 0 : down * (height - item.height)) + (float.y ?? 0);
    drafts.push(shifted(item.draft, dx, dy));
  }

  const limit = ownMainDefinite === undefined ? mainRoom : ownMain;
  return {
    width,
    height,
    draft: groupOf(drafts, description.name),
    ...anchorAcross(blocks, tops),
    overflow: Math.max(overrun(contentOuter, limit), overrun(ownMain, mainRoom)),
  };
}

/** A block's anchor along the flow: its words' in a column, its box's edges in a row. */
function boxAnchor(item: Block, mainOf: (item: Block) => number): Anchor {
  return item.anchor ?? { capTop: 0, baseline: mainOf(item) };
}

function justified(
  offsets: readonly number[],
  justify: AreaParameters['justify'],
  free: number,
): readonly number[] {
  if (justify === 'start' || free === 0) return offsets;
  if (justify === 'center') return offsets.map((offset) => offset + free / 2);
  if (justify === 'end') return offsets.map((offset) => offset + free);
  if (offsets.length < 2) return offsets;
  const step = free / (offsets.length - 1);
  return offsets.map((offset, index) => offset + step * index);
}

/**
 * An area laid out in `room`: a block as large as its sizes say, with how far its flow runs past
 * a bounded room (no child is shrunk to fit; that stays with `fittedColumn`). An area that
 * collapses answers an empty block.
 */
export function areaIn(room: Area, description: AreaDescription): Laid {
  const resolvedOf = (axis: 'width' | 'height'): Resolved => {
    const size = ownSize(description.parameters, axis);
    if (typeof size === 'number') return { mode: 'fixed', size };
    if (size === 'auto' || size === 'hug') return HUG;
    return { mode: 'fill', weight: size === 'fill' ? 1 : size.fill };
  };
  return (
    layOut(description, room, resolvedOf('width'), resolvedOf('height')) ?? {
      width: 0,
      height: 0,
      draft: groupOf([], description.name),
      overflow: 0,
    }
  );
}
