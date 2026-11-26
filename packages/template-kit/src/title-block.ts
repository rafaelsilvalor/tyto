import { group, image, rect, solid } from '@tyto/core/template';

import { type Block, anchorOf, at, block, stack } from './blocks.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';
import { type Measure, type TextStyle, textBlock, textIn } from './text.js';

import type { AssetRef, RichText } from '@tyto/core';
import type { TextOptions } from '@tyto/core/template';

/**
 * A title block: a column of optional pieces, each centred on the block — a picture, lines of
 * words, a rule.
 *
 * The second configurable component (TYTO-185, ADR 0047). The azul agenda's cover is a
 * picture over the cover words; the azul approved list's is an emblem, a kicker, a subtitle,
 * a rule and the exam's name. Both are one {@link TitleBlockStyle} each.
 *
 * **A piece the brief left empty is not drawn, and its gap goes with it**, so an agenda with
 * no illustration closes up rather than leaving a hole. A rule is drawn whenever something
 * is drawn on both sides of it — a divider with nothing to divide is left out too.
 */

export interface TitleImagePart {
  readonly kind: 'image';
  /** The content field this piece draws. */
  readonly field: string;
  readonly name: string;
  readonly size: { readonly w: number; readonly h: number };
  /** Space above this piece, when something is drawn above it. */
  readonly gapAbove?: number;
}

export interface TitleTextPart {
  readonly kind: 'text';
  readonly field: string;
  readonly name: string;
  readonly style: TextStyle;
  /**
   * The box's height: one line and its leading, or more if the piece may wrap. With `measured`,
   * only what is used when nothing can measure.
   */
  readonly height: number;
  /**
   * Measure the words and take their height instead of `height` (TYTO-890), when the content
   * hands a `measure`. Absent, the stated height, as before.
   */
  readonly measured?: true;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly overflow?: TextOptions['overflow'];
  readonly gapAbove?: number;
}

export interface TitleRulePart {
  readonly kind: 'rule';
  readonly name: string;
  readonly width: number;
  readonly thickness: number;
  readonly color: string;
  readonly gapAbove?: number;
}

export type TitlePart = TitleImagePart | TitleTextPart | TitleRulePart;

export interface TitleBlockStyle {
  /** Top to bottom. */
  readonly parts: readonly TitlePart[];
  /** The block's own group. */
  readonly name: string;
}

export interface TitleBlockContent {
  /** What each field holds; a field that is absent or empty draws nothing. */
  readonly fields: Readonly<Record<string, RichText | AssetRef | undefined>>;
  readonly width: number;
  /** Measures a text part that says `measured`; absent, every part takes its stated height. */
  readonly measure?: Measure;
}

/** The block, drawn: as wide as `width`, as tall as the pieces that had something to draw. */
export function titleBlock(style: TitleBlockStyle, content: TitleBlockContent): Block {
  const drawn = titleBlockIn(
    { width: content.width, height: Infinity },
    style,
    content.fields,
    {},
    {
      ...(content.measure === undefined ? {} : { measure: content.measure }),
    },
  );
  return { width: drawn.width, height: drawn.height, draft: drawn.draft };
}

/** The choice a title block makes over its parts (TYTO-891); the default is the older form's. */
export const TITLE_BLOCK_PARAMETERS = {
  measureFrom: {
    kind: 'choice',
    default: 'box',
    choices: ['box', 'capitals'],
    description:
      "Where a part's `gapAbove` runs from: the part above's foot to this one's top, or its " +
      "last baseline to this one's first capitals (ADR 0230 decision 2).",
  },
} as const satisfies ParameterSchema;

export type TitleBlockParameters = ValuesOf<typeof TITLE_BLOCK_PARAMETERS>;

/**
 * The parts with something to draw, centred across `area`, one under the next. With
 * `measureFrom: 'capitals'` each `gapAbove` runs from the part above's last baseline to this
 * one's first capitals, a text part read by its anchor and a picture or a rule by its box, as a
 * stacked exam card is measured. The block's anchor is its first part's capitals and its last
 * part's baseline; `overflow` is how far it runs past a bounded area.
 */
export function titleBlockIn(
  area: Area,
  style: TitleBlockStyle,
  fields: TitleBlockContent['fields'],
  given: Partial<TitleBlockParameters> = {},
  options: { readonly measure?: Measure } = {},
): Block & { readonly overflow: number } {
  const { measureFrom } = parameterValues(TITLE_BLOCK_PARAMETERS, given);
  const content = {
    fields,
    width: area.width,
    ...(options.measure === undefined ? {} : { measure: options.measure }),
  };
  const drawn: { readonly part: TitlePart; readonly item: Block }[] = [];

  for (const part of style.parts) {
    const item = pieceOf(part, content);
    if (item !== undefined) drawn.push({ part, item });
  }

  // A rule divides; at either end of what was drawn it divides nothing.
  const kept = drawn.filter(
    (each, index) => each.part.kind !== 'rule' || (index > 0 && index < drawn.length - 1),
  );

  let y = 0;
  const tops: number[] = [];
  const children = kept.map((each, index) => {
    const above = kept[index - 1];
    if (above !== undefined) {
      const gap = each.part.gapAbove ?? 0;
      // In box mode the older form's own steps, so its bytes stay.
      if (measureFrom === 'capitals') {
        y = tops[index - 1]! + anchorOf(above.item).baseline + gap - anchorOf(each.item).capTop;
      } else y += gap;
    }
    const placed = at((area.width - each.item.width) / 2, y, each.item);
    tops.push(y);
    y += each.item.height;
    return placed;
  });

  // One piece is exactly that piece, as a stack of one would be.
  if (kept.length === 0) return { ...stack({ name: style.name, items: [] }), overflow: 0 };
  const first = kept[0]!;
  const last = kept[kept.length - 1]!;
  const anchored = kept.some((each) => each.item.anchor !== undefined);
  return {
    ...block(area.width, y, group({ name: style.name, children })),
    ...(anchored
      ? {
          anchor: {
            capTop: tops[0]! + anchorOf(first.item).capTop,
            baseline: tops[kept.length - 1]! + anchorOf(last.item).baseline,
          },
        }
      : {}),
    overflow: Number.isFinite(area.height) ? Math.max(0, y - area.height) : 0,
  };
}

function pieceOf(part: TitlePart, content: TitleBlockContent): Block | undefined {
  switch (part.kind) {
    case 'rule':
      return block(
        part.width,
        part.thickness,
        rect({
          name: part.name,
          size: { w: part.width, h: part.thickness },
          fill: solid(part.color),
        }),
      );
    case 'image': {
      const value = content.fields[part.field];
      if (value === undefined || Array.isArray(value)) return undefined;
      return block(
        part.size.w,
        part.size.h,
        image({ name: part.name, asset: value as AssetRef, size: part.size, fit: 'contain' }),
      );
    }
    case 'text': {
      const value = content.fields[part.field];
      if (value === undefined || !Array.isArray(value) || value.length === 0) return undefined;
      const options = {
        name: part.name,
        align: 'center' as const,
        ...(part.lineHeight === undefined ? {} : { lineHeight: part.lineHeight }),
        ...(part.letterSpacing === undefined ? {} : { letterSpacing: part.letterSpacing }),
        ...(part.overflow === undefined ? {} : { overflow: part.overflow }),
      };
      const words = value as RichText;
      const height =
        part.measured === true && content.measure !== undefined
          ? (measuredHeight(words, content.width, part, options, content.measure) ?? part.height)
          : part.height;
      const { name, ...given } = options;
      return textIn(words, { width: content.width, height }, part.style, given, {
        text: { name },
      });
    }
  }
}

/**
 * The height `words` take at `width`, as the text part would draw them with no height of its
 * own: measured, or nothing when nothing can measure.
 */
function measuredHeight(
  words: RichText,
  width: number,
  part: TitleTextPart,
  options: Parameters<typeof textBlock>[3],
  measure: Measure,
): number | undefined {
  const probe = textBlock(words, { w: width, h: part.height }, part.style, options).draft;
  if (probe.kind !== 'text') return undefined;
  return measure({ ...probe, box: { w: width } })?.height;
}
