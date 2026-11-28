import type { ResolvedSlot } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';
import { group } from '@tyto/core/template';

import { type Block, anchorOf, at } from './blocks.js';
import { columnOrder } from './order.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

/**
 * A column of information blocks, in the brief's order, weighted and centred in its area
 * (TYTO-824, ADR 0224).
 *
 * Templates repeat one pattern: a head, a role and salary, a proof, an offer, a foot — blocks
 * stacked in a panel. Placed one by one at fixed tops (anuncio's first assembly), the room the
 * words leave pools in one gap between them. Here the template says only how each block is
 * built and what goes between two neighbours; the column puts the blocks in the order the brief
 * wrote them, drops the ones the brief left out, keeps their natural spacing and centres the
 * group between the area's edges.
 *
 * It is the first arrangement under ADR 0224, decision 3: it **measures** every block against
 * the area before it **places** any, so what it returns — the block, where each child went, and
 * by how much the group did not fit — is known before anything is drawn.
 */

/** The adjustment a brief writes on a block to make it larger or smaller: `{peso: 3}`. */
export { columnOrder } from './order.js';

export const WEIGHT = 'peso';

/**
 * The values `peso` takes, lightest to heaviest: `3` is the block as designed, and the default
 * (maintainer, 2026-11-22, TYTO-834). `6` to `8` since TYTO-853 (maintainer, 2026-11-24).
 */
export const WEIGHTS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

/**
 * The adjustment that scales a block's letters only, leaving the spaces inside it to `peso`:
 * `{tamanho: 6}` (TYTO-853). It takes the values and the scales of `peso`.
 */
export const SIZE = 'tamanho';

/** The values `tamanho` takes: those of `peso`. */
export const SIZES = WEIGHTS;

/**
 * The adjustment that scales only the spaces inside a block (between two parts, two lines, and
 * the paragraph a blank line opens), leaving its letters to `peso`: `{espaco: 4}` (TYTO-853).
 * Its values take the scales of `peso` 1 to 5.
 */
export const SPACING = 'espaco';

/** The values `espaco` takes. */
export const SPACINGS = ['1', '2', '3', '4', '5'] as const;

/**
 * The adjustment that sets the room **above** a block, between it and the block over it:
 * `{distancia: 5}` (TYTO-853). It multiplies the gap the template states for that pair; it does
 * not follow `peso`, and on the first block of a column there is nothing above to space.
 */
export const DISTANCE = 'distancia';

/** The values `distancia` takes: `3`, the default, is the template's own gap. */
export const DISTANCES = ['1', '2', '3', '4', '5'] as const;

export const BLOCK_COLUMN_PARAMETERS = {
  gap: {
    kind: 'length',
    default: 0,
    min: 0,
    description: 'The room between two neighbours when the template states none for the pair.',
  },
  verticalAlign: {
    kind: 'choice',
    default: 'center',
    choices: ['start', 'center', 'end'],
    description: 'Where the group sits between the top and the bottom of its area.',
  },
  horizontalAlign: {
    kind: 'choice',
    default: 'center',
    choices: ['start', 'center', 'end'],
    description: 'Where a block narrower than the area sits across it.',
  },
  measureFrom: {
    kind: 'choice',
    default: 'box',
    choices: ['box', 'capitals'],
    description:
      "Where a gap runs from: one block's foot to the next one's top, or one block's last " +
      "baseline to the next one's first capitals (ADR 0230 decision 2, TYTO-891).",
  },
  weight1: {
    kind: 'ratio',
    default: 0.7,
    min: 0,
    description: 'The scale of a block written with {peso: 1}.',
  },
  weight2: {
    kind: 'ratio',
    default: 0.85,
    min: 0,
    description: 'The scale of a block written with {peso: 2}.',
  },
  weight3: {
    kind: 'ratio',
    default: 1,
    min: 0,
    description: 'The scale of a block written with {peso: 3}, or with no peso: as designed.',
  },
  weight4: {
    kind: 'ratio',
    default: 1.2,
    min: 0,
    description: 'The scale of a block written with {peso: 4}.',
  },
  weight5: {
    kind: 'ratio',
    default: 1.4,
    min: 0,
    description: 'The scale of a block written with {peso: 5}.',
  },
  weight6: {
    kind: 'ratio',
    default: 1.6,
    min: 0,
    description: 'The scale of a block written with {peso: 6}.',
  },
  weight7: {
    kind: 'ratio',
    default: 1.8,
    min: 0,
    description: 'The scale of a block written with {peso: 7}.',
  },
  weight8: {
    kind: 'ratio',
    default: 2,
    min: 0,
    description: 'The scale of a block written with {peso: 8}.',
  },
  distance1: {
    kind: 'ratio',
    default: 0,
    min: 0,
    description: 'The share of its gap left above a block written with {distancia: 1}.',
  },
  distance2: {
    kind: 'ratio',
    default: 0.5,
    min: 0,
    description: 'The share of its gap left above a block written with {distancia: 2}.',
  },
  distance3: {
    kind: 'ratio',
    default: 1,
    min: 0,
    description:
      'The share of its gap left above a block written with {distancia: 3}, or with none: as designed.',
  },
  distance4: {
    kind: 'ratio',
    default: 1.5,
    min: 0,
    description: 'The share of its gap left above a block written with {distancia: 4}.',
  },
  distance5: {
    kind: 'ratio',
    default: 2,
    min: 0,
    description: 'The share of its gap left above a block written with {distancia: 5}.',
  },
  shrinkFloor: {
    kind: 'ratio',
    default: 0.7,
    min: 0,
    max: 1,
    description:
      'The smallest share of its size every block shrinks to, all by one factor, when the group is taller than its area (TYTO-825).',
  },
  reach: {
    kind: 'length',
    default: 0,
    min: 0,
    description:
      'How far above its top edge the column may grow once every block is at the floor; what is still left over is the overflow.',
  },
} as const satisfies ParameterSchema;

export type BlockColumnParameters = ValuesOf<typeof BLOCK_COLUMN_PARAMETERS>;

/** What `weightOf` reads of a slot: its adjustments, as `resolve` hands them over. */
export interface Adjusted {
  readonly adjustments: readonly { readonly name: string; readonly value?: string }[];
}

/** The value a slot was written with for one adjustment, when it is one of `allowed`. */
function writtenOf(
  slot: Adjusted | undefined,
  name: string,
  allowed: readonly string[],
): string | undefined {
  const value = slot?.adjustments.find((adjustment) => adjustment.name === name)?.value;
  return value !== undefined && allowed.includes(value) ? value : undefined;
}

/** The scale of a `peso` level, `3` and anything unknown being the block as designed. */
function weightScale(level: string | undefined, values: BlockColumnParameters): number {
  switch (level) {
    case '1':
      return values.weight1;
    case '2':
      return values.weight2;
    case '4':
      return values.weight4;
    case '5':
      return values.weight5;
    case '6':
      return values.weight6;
    case '7':
      return values.weight7;
    case '8':
      return values.weight8;
    default:
      return values.weight3;
  }
}

/**
 * The scale a block is built at, from the `peso` its slot was written with: `weight1` to
 * `weight8` of the column's parameters. A slot written without `peso`, absent, or given a value
 * outside `1` to `8` is built at `weight3`, the block as designed.
 */
export function weightOf(
  slot: Adjusted | undefined,
  parameters: Partial<BlockColumnParameters> = {},
): number {
  const values = parameterValues(BLOCK_COLUMN_PARAMETERS, parameters);
  return weightScale(writtenOf(slot, WEIGHT, WEIGHTS), values);
}

/** The scale of a block's letters: its `tamanho` when written, else its `peso` (TYTO-853). */
export function sizeOf(
  slot: Adjusted | undefined,
  parameters: Partial<BlockColumnParameters> = {},
): number {
  const size = writtenOf(slot, SIZE, SIZES);
  if (size === undefined) return weightOf(slot, parameters);
  return weightScale(size, parameterValues(BLOCK_COLUMN_PARAMETERS, parameters));
}

/**
 * The scale of the spaces inside a block: its `espaco` when written, read on the scales of
 * `peso` 1 to 5, else its `peso` (TYTO-853).
 */
export function spacingOf(
  slot: Adjusted | undefined,
  parameters: Partial<BlockColumnParameters> = {},
): number {
  const spacing = writtenOf(slot, SPACING, SPACINGS);
  if (spacing === undefined) return weightOf(slot, parameters);
  return weightScale(spacing, parameterValues(BLOCK_COLUMN_PARAMETERS, parameters));
}

/**
 * The share of its gap a block keeps above it, from its `distancia`: `distance1` to
 * `distance5`, `3` or none being the template's own gap (TYTO-853).
 */
export function distanceOf(
  slot: Adjusted | undefined,
  parameters: Partial<BlockColumnParameters> = {},
): number {
  const values = parameterValues(BLOCK_COLUMN_PARAMETERS, parameters);
  switch (writtenOf(slot, DISTANCE, DISTANCES)) {
    case '1':
      return values.distance1;
    case '2':
      return values.distance2;
    case '4':
      return values.distance4;
    case '5':
      return values.distance5;
    default:
      return values.distance3;
  }
}

/** What a column entry reads of its slot's adjustments. */
export interface BlockScales {
  /** The letters' scale: `tamanho`, else `peso`. */
  readonly scale: number;
  /** The inner spaces' scale: `espaco`, else `peso`. */
  readonly spacing: number;
  /** The share of the gap above the block: `distancia`. */
  readonly distance: number;
}

/**
 * Everything a column entry reads of its slot's adjustments, ready to spread into the entry:
 * `{ ...scalesOf(slot), build: (area, scale, spacing) => ... }`. A template adopts `peso`,
 * `tamanho`, `espaco` and `distancia` at once through it (TYTO-853).
 */
export function scalesOf(
  slot: Adjusted | undefined,
  parameters: Partial<BlockColumnParameters> = {},
): BlockScales {
  return {
    scale: sizeOf(slot, parameters),
    spacing: spacingOf(slot, parameters),
    distance: distanceOf(slot, parameters),
  };
}

/**
 * One block the column may hold: a typed input (ADR 0224, decision 4). Its `name` is the slot it
 * shows, the one the brief's order names; `build` makes it at a scale of its reference sizes
 * inside the area the column offers. A block that answers `undefined`, or a block with no height,
 * is absent: it takes no room and no gap.
 */
export interface ColumnEntry {
  readonly name: string;
  /**
   * The block at `scale` for its letters and `spacing` for the spaces inside it. A block that
   * scales both alike reads `scale` alone; the column always passes both, and a caller that
   * passes one means the spaces at `scale`.
   */
  readonly build: (area: Area, scale: number, spacing?: number) => Block | undefined;
  /** The scale of its letters, usually `sizeOf` its slot. Defaults to 1. */
  readonly scale?: number;
  /** The scale of the spaces inside it, usually `spacingOf` its slot. Defaults to `scale`. */
  readonly spacing?: number;
  /**
   * The share of the gap above it it keeps, usually `distanceOf` its slot. Defaults to 1. The
   * first block drawn has no gap above, so its distance changes nothing.
   */
  readonly distance?: number;
}

export interface BlockColumnOptions {
  /** The blocks in the template's own order: where a block the brief did not write is drawn. */
  readonly entries: readonly ColumnEntry[];
  /**
   * The brief's order, `context.order` (ADR 0225): the blocks it wrote, top to bottom. The
   * entries it names take, among themselves, the order it gives; an entry it does not name — a
   * block drawn from a default, or from no slot — keeps its own place in `entries`.
   */
  readonly order?: readonly { readonly name: string }[] | undefined;
  /** The room between two neighbours, by name; `undefined` falls back to the `gap` parameter. */
  readonly gapBetween?: (above: string, below: string) => number | undefined;
  readonly parameters?: Partial<BlockColumnParameters>;
  /** Passed to the wrapping group, so a scene reads back in the author's words. */
  readonly name?: string;
}

/** Where one block of the column went, relative to the column's top. */
export interface PlacedBlock {
  readonly name: string;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  /** The scale its inner spaces were built at. */
  readonly spacing: number;
}

export interface Column {
  /** As wide as the area, and as tall as it when its height is bounded. */
  readonly block: Block;
  /** The blocks drawn, in the order drawn. */
  readonly placed: readonly PlacedBlock[];
  /** How much taller than its room the group came out, after shrinking and reaching; 0 when it fits. */
  readonly overflow: number;
  /** The factor every block was shrunk by to fit the area: 1 when it fitted as built. */
  readonly shrink: number;
  /**
   * How far above the area's top the column grew to hold the group at the floor, within the
   * `reach` parameter: the caller places the block this much higher than the area's top.
   */
  readonly rise: number;
}

/**
 * One block of `context.order` (ADR 0225, ADR 0227) as the column reads it: the slot's name and
 * the value drawn there, with its adjustments. Structural, so a hand-built order fits too.
 */
export interface OrderedBlock {
  readonly name: string;
  readonly slot?: (Adjusted & { readonly value: ResolvedSlot['value'] }) | undefined;
}

/** What a kind of block builds from one placed value: the column entry, less its name. */
export type BlockOfKind = (
  slot: NonNullable<OrderedBlock['slot']>,
) => Omit<ColumnEntry, 'name'> | undefined;

/**
 * The column's entries one per **placed block** (TYTO-839, ADR 0227): two `::corpo`, or a shared
 * title and a slide's own, are two entries in the brief's order, each built by its kind's
 * `build` from its own value and usually at `scalesOf` its own adjustments. `fallback` is the
 * template's own order, as `entries` is to `columnOrder`: its entries that the brief named give
 * their places to the placed blocks, in the brief's order, and the blocks past those places come
 * right after the last of them; an entry the brief did not name keeps its place.
 *
 * Pass the result as `entries` with no `order`: it is already in drawing order, and a name may
 * appear more than once. An order with no values (a context built by hand) falls back to
 * `columnOrder(fallback, order)`, as before.
 */
export function entriesInOrder(
  order: readonly OrderedBlock[] | undefined,
  kinds: Readonly<Record<string, BlockOfKind>>,
  fallback: readonly ColumnEntry[] = [],
): ColumnEntry[] {
  if (order === undefined || order.some((placed) => placed.slot === undefined)) {
    return columnOrder(fallback, order);
  }
  const placed: ColumnEntry[] = [];
  for (const block of order) {
    const kind = kinds[block.name];
    const built = block.slot === undefined || kind === undefined ? undefined : kind(block.slot);
    if (built !== undefined) placed.push({ name: block.name, ...built });
  }
  const written = new Set(placed.map((entry) => entry.name));
  const result: ColumnEntry[] = [];
  let next = 0;
  let lastWritten = -1;
  for (const entry of fallback) {
    if (written.has(entry.name)) {
      if (next < placed.length) result.push(placed[next++]!);
      lastWritten = result.length;
      continue;
    }
    result.push(entry);
  }
  const rest = placed.slice(next);
  result.splice(lastWritten < 0 ? result.length : lastWritten, 0, ...rest);
  return result;
}

/**
 * The column: every entry measured against the area at its scale, the absent ones dropped, the
 * rest stacked with their gaps and the group aligned between the area's edges. When the area's
 * height is unbounded, the column is as tall as the group.
 *
 * A group taller than a bounded area is fitted in three steps, in this order (TYTO-825): every
 * block is rebuilt smaller by one factor, the largest that fits, never below `shrinkFloor` (the
 * gaps keep their size); at the floor, the column grows above its top edge by up to `reach`
 * (`rise`); what is still taller is `overflow`, for the caller to report (`reportOverflow`).
 */
export function blockColumn(area: Area, options: BlockColumnOptions): Column {
  const values = parameterValues(BLOCK_COLUMN_PARAMETERS, options.parameters);

  const entries = columnOrder(options.entries, options.order);
  const gapOf = (above: string, below: string): number =>
    Math.max(0, options.gapBetween?.(above, below) ?? values.gap);

  // First pass: measure. Nothing is placed before every size is known; when the group is taller
  // than its area, it is measured again with every block shrunk by one factor, down to the floor.
  const bounded = Number.isFinite(area.height);
  let shrink = 1;
  const capitals = values.measureFrom === 'capitals';
  let laid = measuredAt(entries, area, 1, gapOf, capitals);
  if (bounded && laid.content > area.height && values.shrinkFloor < 1) {
    const floor = measuredAt(entries, area, values.shrinkFloor, gapOf, capitals);
    if (floor.content > area.height) {
      shrink = values.shrinkFloor;
      laid = floor;
    } else {
      // The largest factor at which the group fits: text that wraps makes the height step, so
      // it is searched rather than divided out.
      let fits = values.shrinkFloor;
      let tooTall = 1;
      let fitting = floor;
      while (tooTall - fits > SHRINK_PRECISION) {
        const middle = (fits + tooTall) / 2;
        const tried = measuredAt(entries, area, middle, gapOf, capitals);
        if (tried.content <= area.height) {
          fits = middle;
          fitting = tried;
        } else tooTall = middle;
      }
      shrink = fits;
      laid = fitting;
    }
  }
  const { measured, gaps, content } = laid;

  const rise = bounded ? Math.min(values.reach, Math.max(0, content - area.height)) : 0;
  const room = bounded ? area.height + rise : content;
  const free = room - content;

  // Second pass: place, from the top the alignment leaves.
  let top = Math.max(0, offsetFor(values.verticalAlign, free));
  const placed: PlacedBlock[] = [];
  const children: NodeDraft[] = [];
  measured.forEach((item, index) => {
    const left = offsetFor(values.horizontalAlign, area.width - item.block.width);
    children.push(at(left, top, item.block));
    placed.push({
      name: item.name,
      top,
      width: item.block.width,
      height: item.block.height,
      scale: item.scale,
      spacing: item.spacing,
    });
    top += item.block.height + gaps[index]!;
  });

  return {
    block: {
      width: area.width,
      height: room,
      draft: group({ children, ...(options.name === undefined ? {} : { name: options.name }) }),
    },
    placed,
    overflow: Math.max(0, -free),
    shrink,
    rise,
  };
}

/** The shrink search stops when two factors are this close. */
const SHRINK_PRECISION = 0.005;

interface Measured {
  readonly name: string;
  readonly block: Block;
  readonly scale: number;
  readonly spacing: number;
  readonly distance: number;
}

interface Laid {
  readonly measured: readonly Measured[];
  readonly gaps: readonly number[];
  readonly content: number;
}

/**
 * Every entry built at its own scales times `factor`, the absent ones dropped, and the gaps: each
 * the pair's gap times the lower block's distance. Measured from the capitals, a gap is moved by
 * what lies below the upper block's last baseline and above the lower block's first capitals,
 * so the room between the boxes is the gap less those (ADR 0230 decision 2).
 */
function measuredAt(
  entries: readonly ColumnEntry[],
  area: Area,
  factor: number,
  gapOf: (above: string, below: string) => number,
  capitals: boolean,
): Laid {
  const measured: Measured[] = [];
  for (const entry of entries) {
    const scale = (entry.scale ?? 1) * factor;
    const spacing = (entry.spacing ?? entry.scale ?? 1) * factor;
    const built = entry.build(area, scale, spacing);
    if (built === undefined || built.height <= 0) continue;
    const distance = entry.distance ?? 1;
    measured.push({ name: entry.name, block: built, scale, spacing, distance });
  }
  const gaps = measured.map((item, index) => {
    const below = measured[index + 1];
    if (below === undefined) return 0;
    const gap = gapOf(item.name, below.name) * below.distance;
    if (!capitals) return gap;
    return gap + (anchorOf(item.block).baseline - item.block.height) - anchorOf(below.block).capTop;
  });
  const content = measured.reduce((sum, item, index) => sum + item.block.height + gaps[index]!, 0);
  return { measured, gaps, content };
}

function offsetFor(align: 'start' | 'center' | 'end', free: number): number {
  switch (align) {
    case 'start':
      return 0;
    case 'center':
      return free / 2;
    case 'end':
      return free;
  }
}
