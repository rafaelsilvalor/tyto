import type { NodeDraft } from '@tyto/core/template';
import { group } from '@tyto/core/template';

import { type Block, at } from './blocks.js';
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
export const WEIGHT = 'peso';

/** The values `peso` takes: `1` lighter, `2` as designed (the default), `3` heavier. */
export const WEIGHTS = ['1', '2', '3'] as const;

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
  lightWeight: {
    kind: 'ratio',
    default: 0.85,
    min: 0,
    description: 'The scale of a block written with {peso: 1}.',
  },
  normalWeight: {
    kind: 'ratio',
    default: 1,
    min: 0,
    description: 'The scale of a block written with {peso: 2}, or with no peso.',
  },
  heavyWeight: {
    kind: 'ratio',
    default: 1.2,
    min: 0,
    description: 'The scale of a block written with {peso: 3}.',
  },
} as const satisfies ParameterSchema;

export type BlockColumnParameters = ValuesOf<typeof BLOCK_COLUMN_PARAMETERS>;

/** What `weightOf` reads of a slot: its adjustments, as `resolve` hands them over. */
export interface Adjusted {
  readonly adjustments: readonly { readonly name: string; readonly value?: string }[];
}

/**
 * The scale a block is built at, from the `peso` its slot was written with: the light, normal or
 * heavy weight of the column's parameters. A slot written without `peso`, absent, or given a
 * value outside `1`, `2` and `3` is built at the normal weight.
 */
export function weightOf(
  slot: Adjusted | undefined,
  parameters: Partial<BlockColumnParameters> = {},
): number {
  const values = parameterValues(BLOCK_COLUMN_PARAMETERS, parameters);
  const written = slot?.adjustments.find((adjustment) => adjustment.name === WEIGHT)?.value;
  switch (written) {
    case '1':
      return values.lightWeight;
    case '3':
      return values.heavyWeight;
    default:
      return values.normalWeight;
  }
}

/**
 * One block the column may hold: a typed input (ADR 0224, decision 4). Its `name` is the slot it
 * shows, the one the brief's order names; `build` makes it at a scale of its reference sizes
 * inside the area the column offers. A block that answers `undefined`, or a block with no height,
 * is absent: it takes no room and no gap.
 */
export interface ColumnEntry {
  readonly name: string;
  readonly build: (area: Area, scale: number) => Block | undefined;
  /** The scale to build it at, usually `weightOf` its slot. Defaults to 1. */
  readonly scale?: number;
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
}

export interface Column {
  /** As wide as the area, and as tall as it when its height is bounded. */
  readonly block: Block;
  /** The blocks drawn, in the order drawn. */
  readonly placed: readonly PlacedBlock[];
  /** How much taller than the area the group came out; 0 when it fits. */
  readonly overflow: number;
}

/**
 * The entries in drawing order: the template's own order, with the places of the entries the
 * brief named filled by those entries in the brief's order.
 */
export function columnOrder<Entry extends { readonly name: string }>(
  entries: readonly Entry[],
  order: readonly { readonly name: string }[] | undefined,
): Entry[] {
  if (order === undefined) return [...entries];
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const written: Entry[] = [];
  for (const { name } of order) {
    const entry = byName.get(name);
    if (entry !== undefined && !written.includes(entry)) written.push(entry);
  }
  const queue = [...written];
  return entries.map((entry) => (written.includes(entry) ? queue.shift()! : entry));
}

/**
 * The column: every entry measured against the area at its scale, the absent ones dropped, the
 * rest stacked with their gaps and the group aligned between the area's edges. When the area's
 * height is unbounded, the column is as tall as the group.
 */
export function blockColumn(area: Area, options: BlockColumnOptions): Column {
  const values = parameterValues(BLOCK_COLUMN_PARAMETERS, options.parameters);

  // First pass: measure. Nothing is placed before every size is known.
  const measured: { name: string; block: Block; scale: number }[] = [];
  for (const entry of columnOrder(options.entries, options.order)) {
    const scale = entry.scale ?? 1;
    const built = entry.build(area, scale);
    if (built === undefined || built.height <= 0) continue;
    measured.push({ name: entry.name, block: built, scale });
  }

  const gaps = measured.map((item, index) => {
    const below = measured[index + 1];
    if (below === undefined) return 0;
    return Math.max(0, options.gapBetween?.(item.name, below.name) ?? values.gap);
  });
  const content = measured.reduce((sum, item, index) => sum + item.block.height + gaps[index]!, 0);

  const bounded = Number.isFinite(area.height);
  const room = bounded ? area.height : content;
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
  };
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
