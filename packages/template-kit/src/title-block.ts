import { group, image, rect, solid } from '@tyto/core/template';

import { type Block, at, block, stack } from './blocks.js';
import { type Measure, type TextStyle, textBlock } from './text.js';

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
  const children = kept.map((each, index) => {
    if (index > 0) y += each.part.gapAbove ?? 0;
    const placed = at((content.width - each.item.width) / 2, y, each.item);
    y += each.item.height;
    return placed;
  });

  // One piece is exactly that piece, as a stack of one would be.
  if (kept.length === 0) return stack({ name: style.name, items: [] });
  return block(content.width, y, group({ name: style.name, children }));
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
      return textBlock(words, { w: content.width, h: height }, part.style, options);
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
