/*
 * The text family as it was before TYTO-891, copied verbatim from origin/main (c9821b2a:
 * text.ts, title-block.ts, levels.ts) by a script that slices the functions out of the files and
 * only renames them, so the tests can hold the new forms to them byte for byte.
 */
import { group, image, rect, runsOf, solid, text } from '@tyto/core/template';

import { type Align, type Block, at, block, stack } from './blocks.js';
import { atLeastOne } from './text.js';

import type { LevelGap, LevelItem, LevelPart, LevelStackStyle } from './levels.js';
import type { Measure, TextBlockOptions, TextStyle } from './text.js';
import type {
  TitleBlockContent,
  TitleBlockStyle,
  TitlePart,
  TitleTextPart,
} from './title-block.js';
import type { AssetRef, RichText, TextRun } from '@tyto/core';
import type { NonEmpty } from '@tyto/core/template';

function oldRunsIn(value: RichText, style: TextStyle): NonEmpty<TextRun> | undefined {
  return atLeastOne(
    runsOf(
      value,
      { font: style.font, size: style.size, weight: style.weight, color: style.color },
      style.paragraphSpacing === undefined
        ? style.highlights?.options
        : { ...style.highlights?.options, paragraphSpacing: style.paragraphSpacing },
    ),
  );
}

function oldNothing(width: number, height: number): Block {
  return block(width, height, group({ children: [] }));
}

export function oldTextBlock(
  value: RichText,
  size: { readonly w: number; readonly h: number },
  style: TextStyle,
  options: TextBlockOptions = {},
): Block {
  const runs = oldRunsIn(value, style);
  if (runs === undefined) return oldNothing(size.w, size.h);

  return block(size.w, size.h, text({ ...options, runs, box: { w: size.w, h: size.h } }));
}

export function oldGrownTextBlock(
  value: RichText,
  width: number,
  minHeight: number,
  style: TextStyle,
  measure: Measure,
  options: TextBlockOptions = {},
): Block {
  const runs = oldRunsIn(value, style);
  if (runs === undefined) return oldNothing(width, minHeight);

  const measured = measure(text({ ...options, runs, box: { w: width } }));
  if (measured === undefined) {
    return block(
      width,
      minHeight,
      text({ ...options, runs, box: { w: width, h: minHeight }, overflow: 'shrink' }),
    );
  }

  const height = Math.max(minHeight, measured.height);
  return block(width, height, text({ ...options, runs, box: { w: width, h: height } }));
}

export function oldTitleBlock(style: TitleBlockStyle, content: TitleBlockContent): Block {
  const drawn: { readonly part: TitlePart; readonly item: Block }[] = [];

  for (const part of style.parts) {
    const item = oldPieceOf(part, content);
    if (item !== undefined) drawn.push({ part, item });
  }

  // A rule divides; at either end of what was drawn it divides oldNothing.
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

function oldPieceOf(part: TitlePart, content: TitleBlockContent): Block | undefined {
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
          ? (oldMeasuredHeight(words, content.width, part, options, content.measure) ?? part.height)
          : part.height;
      return oldTextBlock(words, { w: content.width, h: height }, part.style, options);
    }
  }
}

function oldMeasuredHeight(
  words: RichText,
  width: number,
  part: TitleTextPart,
  options: Parameters<typeof oldTextBlock>[3],
  measure: Measure,
): number | undefined {
  const probe = oldTextBlock(words, { w: width, h: part.height }, part.style, options).draft;
  if (probe.kind !== 'text') return undefined;
  return measure({ ...probe, box: { w: width } })?.height;
}

export function oldLevelStack(
  items: readonly LevelItem[],
  style: LevelStackStyle,
  width: number,
  measure: Measure,
): Block {
  const align = style.align ?? 'center';
  const lineGap: LevelGap<LevelItem> = style.lineGap ?? (style.gap as number);

  type Drawn =
    | { kind: 'line'; item: LevelItem & { kind: 'line' }; rows: Block[] }
    | { kind: 'divider'; item: LevelItem; drawing: Block };
  const drawn: Drawn[] = [];
  for (const item of items) {
    if (item.kind === 'divider') {
      if (style.divider !== undefined) {
        drawn.push({ kind: 'divider', item, drawing: style.divider(width) });
      }
      continue;
    }
    const rows = item.parts.map((part, index) =>
      oldRowOf(part, index, style, width, measure, align),
    );
    drawn.push({ kind: 'line', item, rows });
  }

  const kept = drawn.filter(
    (each, index) =>
      each.kind !== 'divider' ||
      (drawn.slice(0, index).some((before) => before.kind === 'line') &&
        drawn.slice(index + 1).some((after) => after.kind === 'line')),
  );

  let y = 0;
  const children = [];
  for (const [index, each] of kept.entries()) {
    if (index > 0) y += oldSpaceOf(lineGap, kept[index - 1]!.item, each.item);
    if (each.kind === 'divider') {
      children.push(at(oldOffsetOf(align, width, each.drawing.width), y, each.drawing));
      y += each.drawing.height;
      continue;
    }
    for (const [row, piece] of each.rows.entries()) {
      // A piece joined by a typed break is the next line of one text: no part gap above it.
      const part = each.item.parts[row]!;
      if (row > 0 && part.joined !== true) {
        y += oldSpaceOf(style.gap, each.item.parts[row - 1]!, part);
      }
      children.push(at(oldOffsetOf(align, width, piece.width), y, piece));
      y += piece.height;
    }
  }

  if (children.length === 0) return stack({ name: style.name, items: [] });
  return block(width, y, group({ name: style.name, children }));
}

function oldSpaceOf<Neighbour>(
  gap: LevelGap<Neighbour>,
  above: Neighbour,
  below: Neighbour,
): number {
  return typeof gap === 'number' ? gap : gap(above, below);
}

function oldRowOf(
  part: LevelPart,
  index: number,
  style: LevelStackStyle,
  width: number,
  measure: Measure,
  align: Align,
): Block {
  const look = style.look(part);
  const lineHeight = look.lineHeight ?? 1.2;
  const words = look.transform === undefined ? part.words : look.transform(part.words);
  return oldGrownTextBlock(words, width, look.style.size * lineHeight, look.style, measure, {
    name: `${style.name}-${part.position}-${index}`,
    align: OLD_TEXT_ALIGN[align],
    lineHeight,
    ...(look.letterSpacing === undefined ? {} : { letterSpacing: look.letterSpacing }),
  });
}

const OLD_TEXT_ALIGN = { start: 'left', center: 'center', end: 'right' } as const;

function oldOffsetOf(align: Align, width: number, itemWidth: number): number {
  if (align === 'center') return (width - itemWidth) / 2;
  if (align === 'end') return width - itemWidth;
  return 0;
}
