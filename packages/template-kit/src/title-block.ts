import { group, image, rect, solid } from '@tyto/core/template';

import { type Block, at, block, stack } from './blocks.js';
import { type TextStyle, textBlock } from './text.js';

import type { AssetRef, RichText } from '@tyto/core';
import type { TextOptions } from '@tyto/core/template';

/**
 * A title block: a column of optional pieces, each centred on the block — a picture, lines of
 * words, a rule.
 *
 * The second configurable component (TYTO-185, ADR 0039). The Saúde agenda's cover is a
 * picture over the cover words; the Saúde approved list's is an emblem, a kicker, a subtitle,
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
  /** The box's height: one line and its leading, or more if the piece may wrap. */
  readonly height: number;
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
      return textBlock(value as RichText, { w: content.width, h: part.height }, part.style, {
        name: part.name,
        align: 'center',
        ...(part.lineHeight === undefined ? {} : { lineHeight: part.lineHeight }),
        ...(part.letterSpacing === undefined ? {} : { letterSpacing: part.letterSpacing }),
        ...(part.overflow === undefined ? {} : { overflow: part.overflow }),
      });
    }
  }
}
