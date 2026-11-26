import { group, rect } from '@tyto/core/template';

import { type Block, at, block } from './blocks.js';
import { reportOverflow } from './page.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

import type { LevelItem, LevelPart } from './levels.js';
import type { TemplateContext } from '@tyto/core';
import type { NodeDraft, NodeOptions, RectOptions } from '@tyto/core/template';

/**
 * A card: an outlined box cut into segments from top to bottom, one or more of them a filled
 * band (TYTO-800). The reference's offers are cards — "Pacote Completo" over "30% OFF" over
 * "Por tempo limitado" — and two of them side by side share one height.
 *
 * Mechanism only, as the kit's rule asks: the caller draws each segment's words and picks the
 * colours, the radius, the stroke and the band's effects. The card stacks the segments, gives
 * a band the corners of the edge it reaches, and grows to its content.
 */

/** A band is filled with the card's band paint; a plain segment shows the card behind it. */
export type CardSegmentKind = 'band' | 'plain';

export interface CardSegment {
  readonly kind: CardSegmentKind;
  /** The segment's words as the caller drew them, centred across the card. */
  readonly content: Block;
  /**
   * The least height the segment takes, its content centred in it. Content taller than this
   * grows the segment by the difference. Defaults to the content's height.
   */
  readonly minHeight?: number;
}

export interface CardStyle {
  /** The wrapping group's name, and the outline's. */
  readonly name: string;
  readonly width: number;
  /** The card's corner radius; a band at an edge takes that edge's two corners. */
  readonly radius: number;
  readonly fill?: RectOptions['fill'];
  readonly stroke?: RectOptions['stroke'];
  readonly band: {
    readonly fill: NonNullable<RectOptions['fill']>;
    readonly effects?: NodeOptions['effects'];
    /** The band's rectangle's name. Defaults to `band`. */
    readonly name?: string;
  };
  /**
   * A fixed height. Content shorter than it leaves the room before the last segment, so a
   * foot sits at the bottom; content taller than it is reported as an overflow and drawn
   * past the card. Without it the card is as tall as its segments.
   */
  readonly height?: number;
}

/** Where one segment was drawn, from the card's top. */
export interface PlacedSegment {
  readonly kind: CardSegmentKind;
  readonly top: number;
  readonly height: number;
}

export interface Card extends Block {
  readonly segments: readonly PlacedSegment[];
}

/** The height the segments take with nothing added: the sum of each one's own height. */
export function naturalCardHeight(segments: readonly CardSegment[]): number {
  return segments.reduce((sum, segment) => sum + heightOf(segment), 0);
}

/**
 * The segments drawn one under the next inside an outlined box. A band touching the card's top
 * takes its top corners, one touching its bottom takes the bottom corners, and one in the
 * middle is square. No segment, no card: an empty block.
 */
export function card(
  segments: readonly CardSegment[],
  style: CardStyle,
  report?: TemplateContext['report'],
): Card {
  const drawn = cardIn({ width: style.width, height: style.height ?? Infinity }, segments, style);
  // The older form reported its own overflow, and only for a fixed height; the area form
  // returns it.
  if (report !== undefined && style.height !== undefined && segments.length > 0) {
    reportOverflow(report, drawn.overflow, 0);
  }
  return { width: drawn.width, height: drawn.height, draft: drawn.draft, segments: drawn.segments };
}

/** The number a card's style states (TYTO-891): its corners; the width and height are the area's. */
export const CARD_PARAMETERS = {
  radius: {
    kind: 'length',
    default: 0,
    min: 0,
    description: "The card's corner radius, in px; a band at an edge takes that edge's corners.",
  },
} as const satisfies ParameterSchema;

export type CardParameters = ValuesOf<typeof CARD_PARAMETERS>;

/**
 * The segments drawn one under the next in a card as wide as `area`, and as tall as a bounded
 * area (the room going before its foot) or as its segments. The radius given is laid over the
 * style's. `overflow` is how far the segments run past a bounded height.
 */
export function cardIn(
  area: Area,
  segments: readonly CardSegment[],
  style: CardStyle,
  given: Partial<CardParameters> = {},
): Card & { readonly overflow: number } {
  const bounded = Number.isFinite(area.height);
  const { height: _height, ...unsized } = style;
  return drawCard(segments, {
    ...unsized,
    width: area.width,
    radius:
      given.radius === undefined ? style.radius : parameterValues(CARD_PARAMETERS, given).radius,
    ...(bounded ? { height: area.height } : {}),
  });
}

/** The card itself, as `card` drew it before TYTO-891, its overflow returned. */
function drawCard(
  segments: readonly CardSegment[],
  style: CardStyle,
): Card & { readonly overflow: number } {
  if (segments.length === 0) {
    return { ...block(0, 0, group({ name: style.name, children: [] })), segments: [], overflow: 0 };
  }

  const natural = naturalCardHeight(segments);
  const height = style.height ?? natural;
  const overflow =
    style.height !== undefined && natural - style.height > 0 ? natural - style.height : 0;
  // The room a fixed or shared height adds goes before the last segment, so the foot sits at
  // the bottom and the bands of cards side by side line up at the top (maintainer, 2026-11-20).
  const room = Math.max(0, height - natural);
  const roomBefore = segments.length > 1 ? segments.length - 1 : 1;

  const placed: PlacedSegment[] = [];
  const bands: NodeDraft[] = [];
  const words: NodeDraft[] = [];
  let y = 0;
  for (const [index, segment] of segments.entries()) {
    if (index === roomBefore) y += room;
    const own = heightOf(segment);
    placed.push({ kind: segment.kind, top: y, height: own });
    if (segment.kind === 'band') {
      const top = y === 0;
      const bottom = index === segments.length - 1 && (segments.length > 1 || room === 0);
      const corner = (rounded: boolean): number => (rounded ? style.radius : 0);
      bands.push(
        rect({
          name: style.band.name ?? 'band',
          size: { w: style.width, h: own },
          radius: [corner(top), corner(top), corner(bottom), corner(bottom)],
          fill: style.band.fill,
          ...(style.band.effects === undefined ? {} : { effects: style.band.effects }),
          transform: { y },
        }),
      );
    }
    const x = (style.width - segment.content.width) / 2;
    words.push(at(x, y + (own - segment.content.height) / 2, segment.content));
    y += own;
  }

  const outline = rect({
    name: style.name,
    size: { w: style.width, h: height },
    radius: style.radius,
    ...(style.fill === undefined ? {} : { fill: style.fill }),
    ...(style.stroke === undefined ? {} : { stroke: style.stroke }),
  });
  const drawn = group({ name: style.name, children: [outline, ...bands, ...words] });
  return { ...block(style.width, height, drawn), segments: placed, overflow };
}

/**
 * Where the card's first band ends, from the card's top: the edge a caller pins to the
 * reference so that a band or a title that grows rises instead of pushing what is under the
 * card down (TYTO-811's rule). Nothing when the card has no band.
 */
export function bandBottom(drawn: Card): number | undefined {
  const band = drawn.segments.find((segment) => segment.kind === 'band');
  return band === undefined ? undefined : band.top + band.height;
}

export interface CardRowItem {
  readonly segments: readonly CardSegment[];
  readonly style: CardStyle;
}

/**
 * Cards side by side, lined up the way the maintainer chose on 2026-11-20: every card's first
 * band starts at the same height, the segment above a band that starts higher growing to meet
 * it (its words centred in it); then every card is as tall as the tallest, or the largest fixed
 * height among them, its room going before its foot. A band at a card's top edge stays there.
 */
export function cardRow(
  rowItems: readonly CardRowItem[],
  gap: number,
  report?: TemplateContext['report'],
  name = 'card-row',
): Block {
  const drawn = cardRowIn({ width: Infinity, height: Infinity }, rowItems, { gap }, { name });
  // Every card is as tall as the tallest, so none runs past its own height; the older form
  // reported each card's overflow all the same, and so does this, for the same answer.
  if (report !== undefined) for (const each of drawn.cards) reportOverflow(report, each, 0);
  return { width: drawn.width, height: drawn.height, draft: drawn.draft };
}

/** The number a row of cards uses (TYTO-891). */
export const CARD_ROW_PARAMETERS = {
  gap: { kind: 'length', default: 0, description: 'Between two cards, in px.' },
} as const satisfies ParameterSchema;

export type CardRowParameters = ValuesOf<typeof CARD_ROW_PARAMETERS>;

/**
 * Cards side by side in `area`, lined up as `cardRow` lines them. `overflow` is how far the row
 * runs past a bounded area, across or down; `cards` is each card's own overflow, in order.
 */
export function cardRowIn(
  area: Area,
  rowItems: readonly CardRowItem[],
  given: Partial<CardRowParameters> = {},
  options: { readonly name?: string } = {},
): Block & { readonly overflow: number; readonly cards: readonly number[] } {
  const { gap } = parameterValues(CARD_ROW_PARAMETERS, given);
  const name = options.name ?? 'card-row';
  const items = bandsLinedUp(rowItems);
  const height = items.reduce(
    (tallest, item) => Math.max(tallest, item.style.height ?? 0, naturalCardHeight(item.segments)),
    0,
  );
  let x = 0;
  const children: NodeDraft[] = [];
  const cards: number[] = [];
  for (const [index, item] of items.entries()) {
    if (index > 0) x += gap;
    const drawn = drawCard(item.segments, { ...item.style, height });
    if (item.segments.length > 0) cards.push(drawn.overflow);
    children.push(at(x, 0, drawn));
    x += drawn.width;
  }
  const rowHeight = items.length === 0 ? 0 : height;
  const across = Number.isFinite(area.width) ? x - area.width : 0;
  const down = Number.isFinite(area.height) ? rowHeight - area.height : 0;
  return {
    ...block(x, rowHeight, group({ name, children })),
    overflow: Math.max(0, across, down),
    cards,
  };
}

/** Where a card's first band starts with nothing added; nothing for no band or one on top. */
function naturalBandTop(segments: readonly CardSegment[]): number | undefined {
  const first = segments.findIndex((segment) => segment.kind === 'band');
  if (first <= 0) return undefined;
  return naturalCardHeight(segments.slice(0, first));
}

/** The segment above each card's first band grown so every first band starts together. */
function bandsLinedUp(items: readonly CardRowItem[]): CardRowItem[] {
  const tops = items.map((item) => naturalBandTop(item.segments));
  const lowest = Math.max(0, ...tops.map((top) => top ?? 0));
  return items.map((item, index) => {
    const top = tops[index];
    if (top === undefined || top === lowest) return item;
    const above = item.segments.findIndex((segment) => segment.kind === 'band') - 1;
    const segments = item.segments.map((segment, position) =>
      position === above ? { ...segment, minHeight: heightOf(segment) + lowest - top } : segment,
    );
    return { ...item, segments };
  });
}

/** What a part of `::apelo` is in the card: before the band, the band, or after it. */
export type CardRole = 'title' | 'band' | 'foot';

/**
 * A block's levels as a card's segments, the vocabulary's reading (`docs/slot-vocabulary.md`):
 * the main part is the band, the parts before it the title, the parts after it the foot, later
 * lines joining the foot. A role with no part has no segment, so the band reaches that edge.
 * No main part, no segments.
 */
export function cardSegments(
  items: readonly LevelItem[],
  draw: (role: CardRole, parts: readonly LevelPart[]) => Block,
  minHeight: Partial<Record<CardRole, number>> = {},
): CardSegment[] {
  const parts = items.flatMap((item) => (item.kind === 'line' ? item.parts : []));
  const main = parts.findIndex((part) => part.position === 'main');
  if (main < 0) return [];
  const groups: [CardRole, readonly LevelPart[]][] = [
    ['title', parts.slice(0, main)],
    ['band', [parts[main]!]],
    ['foot', parts.slice(main + 1)],
  ];
  return groups
    .filter(([, rolled]) => rolled.length > 0)
    .map(([role, rolled]) => ({
      kind: role === 'band' ? 'band' : 'plain',
      content: draw(role, rolled),
      ...(minHeight[role] === undefined ? {} : { minHeight: minHeight[role] }),
    }));
}

function heightOf(segment: CardSegment): number {
  return Math.max(segment.minHeight ?? 0, segment.content.height);
}
