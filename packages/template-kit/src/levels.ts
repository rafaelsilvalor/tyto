import { group } from '@tyto/core/template';

import { type Align, type Block, at, block, stack } from './blocks.js';
import { fields, plain } from './rows.js';
import { type Measure, type TextStyle, grownTextBlock } from './text.js';

import type { Inline, RichText } from '@tyto/core';

/**
 * A block's lines ranked by the marks every template reads the same way
 * (`docs/slot-vocabulary.md`, "Levels inside a block", TYTO-807).
 *
 * `|` separates the parts of one line; `#`, `##` and `###` before a part mark its level, and a
 * part with no mark is the base level; a line with no mark at all gets its main part by
 * position; a line that is only `---` is the divider the template draws its own way. The marks
 * are plain text to the brief's grammar — this is the one place that reads them, so no
 * template parses them its own way.
 *
 * Mechanism only, as the kit's rule asks: what each level looks like, the gaps and the
 * divider's drawing are the caller's.
 */

/** The written divider: a line holding only this. */
export const DIVIDER = '---';

/** The deepest mark: `###`. A run of more `#` is words, not a mark. */
export const DEEPEST_LEVEL = 6;

/** 0 is the base level (no mark); 1 is `#`, the main part; 2 is `##`; 3 is `###`. */
export type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Where a part stands against its line's main part. */
export type LevelPosition = 'before' | 'main' | 'after';

export interface LevelPart {
  /** The part's words, its `#` taken off and the spaces against its separators trimmed. */
  readonly words: RichText;
  readonly level: Level;
  readonly position: LevelPosition;
  /**
   * `true` on a piece a typed break followed by a mark split from the piece before it, inside
   * one `|` part: `Prepare-se com o \ # líder` (TYTO-854, ADR 0229). It is drawn as the next
   * line of one text, with no part gap above it. Absent on every other part.
   */
  readonly joined?: true;
}

/**
 * One item of a block. `paragraph` is `true` on an item a blank line separates from the item
 * before it (ADR 0205, TYTO-845), so a template can set the space a paragraph opens apart from
 * the one between two lines that stay together. Absent on every other item, the first included.
 */
export type LevelItem =
  | { readonly kind: 'line'; readonly parts: readonly LevelPart[]; readonly paragraph?: true }
  | { readonly kind: 'divider'; readonly paragraph?: true };

/**
 * A block's rich text as its items, in the order written.
 *
 * A line ends where the block's line ends, never at a `\` the author typed: that break stays
 * inside its part and is drawn there, so `# Concurso ABIN \ 2027` is one main part on two
 * lines (TYTO-822). A typed break followed by a mark (`#` to `######` and a space) is the one
 * exception: it starts a new piece of the part at that level, marked `joined`, so
 * `Prepare-se com o \ # líder` is a base-level piece and a main one (TYTO-854, ADR 0229). Text
 * after a typed break with no mark stays in the piece before it, at its level. The spaces
 * against a typed break are not words, and a break at either end of a piece breaks nothing, so
 * both are taken off.
 *
 * Empty lines and empty parts are dropped, so `a | | b` is two parts. In a line with marks,
 * the main part is the first one at the highest level written (`#` before `##`). The block's
 * first line with none gets its main part by position — the only part, the first of two, or the
 * second of three or more — at level 1, the others at the base level; any later line with none
 * is all base level, after the block's main part.
 *
 * `readByPosition: false` turns the positional reading off: every line with no mark is the base
 * level, the first included. A body under a title (TYTO-831) reads so — its first line is a
 * fact, never a name.
 */
export function levelsOf(
  text: RichText,
  options: { readonly readByPosition?: boolean } = {},
): LevelItem[] {
  const byPosition = options.readByPosition ?? true;
  const items: LevelItem[] = [];
  // A blank line before a line the block drops (an empty one) still separates what comes next.
  let pendingParagraph = false;
  for (const { inlines: line, paragraph } of blockLines(text)) {
    pendingParagraph ||= paragraph;
    const written = plain(line).trim();
    if (written === '') continue;
    const opens = pendingParagraph && items.length > 0 ? { paragraph: true as const } : {};
    if (written === DIVIDER) {
      items.push({ kind: 'divider', ...opens });
      pendingParagraph = false;
      continue;
    }
    const parts = fields(line).flatMap(piecesOf);
    if (parts.length === 0) continue;
    const first = byPosition && !items.some((item) => item.kind === 'line');
    items.push({ kind: 'line', parts: ranked(parts, first), ...opens });
    pendingParagraph = false;
  }
  return items;
}

/**
 * The block's lines, cut only at the boundary between two of them. `lines()` cuts at every break,
 * which is right for a table reading each line as a record but would make a typed `\` start a
 * new level line.
 */
function blockLines(text: RichText): { inlines: RichText; paragraph: boolean }[] {
  const result: { inlines: Inline[]; paragraph: boolean }[] = [{ inlines: [], paragraph: false }];
  for (const inline of text) {
    if (inline.kind === 'break' && inline.typed !== true) {
      result.push({ inlines: [], paragraph: inline.paragraph === true });
    } else result[result.length - 1]!.inlines.push(inline);
  }
  return result;
}

/** A mark at the start of a piece's words: `#` to `######` followed by a space. */
const MARK = /^(#{1,6})\s+/u;

/**
 * One `|` part as its pieces, read: cut before every typed break whose next words start with a
 * mark, each piece tidied, the empty ones dropped, every piece after the part's first `joined`.
 */
function piecesOf(part: RichText): Marked[] {
  const cuts: Inline[][] = [[]];
  part.forEach((inline, index) => {
    const next = part[index + 1];
    const opensPiece =
      inline.kind === 'break' &&
      inline.typed === true &&
      next?.kind === 'text' &&
      MARK.test(next.value.trimStart());
    if (opensPiece) cuts.push([]);
    else cuts[cuts.length - 1]!.push(inline);
  });
  // The spaces against a cut were against a typed break: not words, as `tidied` reads them.
  const ends = cuts.length === 1 ? cuts : cuts.map(trimmedEnds);
  const kept = ends.map(tidied).filter((piece) => plain(piece).trim() !== '');
  return kept.map((piece, index) => {
    const marked = markOf(piece);
    return index === 0 ? marked : { ...marked, joined: true as const };
  });
}

/** A piece with the spaces at its two ends taken off. */
function trimmedEnds(piece: readonly Inline[]): Inline[] {
  const inlines = [...piece];
  const first = inlines[0];
  if (first?.kind === 'text') inlines[0] = trimmed(first, 'start');
  const last = inlines[inlines.length - 1];
  if (last?.kind === 'text') inlines[inlines.length - 1] = trimmed(last, 'end');
  return inlines;
}

/** A part with the spaces against each typed break, and any break at its ends, taken off. */
function tidied(part: RichText): RichText {
  const inlines = [...part];
  inlines.forEach((inline, index) => {
    if (inline.kind !== 'break') return;
    const before = inlines[index - 1];
    if (before?.kind === 'text') inlines[index - 1] = trimmed(before, 'end');
    const after = inlines[index + 1];
    if (after?.kind === 'text') inlines[index + 1] = trimmed(after, 'start');
  });
  while (inlines[0]?.kind === 'break') inlines.shift();
  while (inlines[inlines.length - 1]?.kind === 'break') inlines.pop();
  return inlines.filter((inline) => inline.kind !== 'text' || inline.value !== '');
}

type TextInline = Extract<Inline, { kind: 'text' }>;

function trimmed(inline: TextInline, side: 'start' | 'end'): TextInline {
  const value = side === 'start' ? inline.value.trimStart() : inline.value.trimEnd();
  const cut = inline.value.length - value.length;
  const range =
    side === 'start'
      ? { start: Math.min(inline.range.start + cut, inline.range.end), end: inline.range.end }
      : { start: inline.range.start, end: Math.max(inline.range.end - cut, inline.range.start) };
  return { ...inline, value, range };
}

interface Marked {
  readonly words: RichText;
  readonly level: Level;
  readonly joined?: true;
}

/**
 * A part's leading `#` to `######` followed by a space, read and taken off its words (six levels
 * since TYTO-834). Seven or more, or a mark glued to its word (`#1`), are words.
 */
function markOf(part: RichText): Marked {
  const first = part[0];
  if (first?.kind !== 'text') return { words: part, level: 0 };
  const match = MARK.exec(first.value);
  if (match === null) return { words: part, level: 0 };
  const rest = first.value.slice(match[0].length);
  const start = Math.min(first.range.start + match[0].length, first.range.end);
  const head: Inline[] =
    rest === '' ? [] : [{ ...first, value: rest, range: { start, end: first.range.end } }];
  return { words: [...head, ...part.slice(1)], level: match[1]!.length as Level };
}

/**
 * Each part placed against the line's main one, by its marks or, with none, by position.
 *
 * Position reads only the block's first line. A later line with no mark is a supporting line —
 * cargos under the exam's name, say — so all of it is the base level, standing after the main
 * part the first line gave the block (the maintainer's rule, 2026-11-20).
 */
function ranked(parts: readonly Marked[], first: boolean): LevelPart[] {
  const marked = parts.filter((part) => part.level > 0);
  let main: number;
  let levels: Level[];
  if (marked.length === 0 && !first) {
    return parts.map((part) => ({
      ...joinedOf(part),
      words: part.words,
      level: 0,
      position: 'after',
    }));
  }
  if (marked.length === 0) {
    main = parts.length >= 3 ? 1 : 0;
    levels = parts.map((_, index) => (index === main ? 1 : 0));
  } else {
    const highest = Math.min(...marked.map((part) => part.level)) as Level;
    main = parts.findIndex((part) => part.level === highest);
    levels = parts.map((part) => part.level);
  }
  return parts.map((part, index) => ({
    ...joinedOf(part),
    words: part.words,
    level: levels[index]!,
    position: index < main ? 'before' : index === main ? 'main' : 'after',
  }));
}

function joinedOf(part: Marked): { joined?: true } {
  return part.joined === true ? { joined: true } : {};
}

/* ------------------------------------------------------------------------ the stack -- */

/** What one part is drawn with. */
export interface LevelLook {
  readonly style: TextStyle;
  /** Defaults to 1.2, `text()`'s own default. */
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  /** The words as drawn, from the words as written — capitals, say. Never adds or drops words. */
  readonly transform?: (words: RichText) => RichText;
}

/**
 * A space between two neighbours: one number for every pair, or the space for this pair, from
 * the neighbour above and the neighbour below (TYTO-810). A designer spaces lines by what they
 * are — more room under the exam's name than over the salary — and a function says that from
 * the items' levels without counting lines.
 */
export type LevelGap<Neighbour> = number | ((above: Neighbour, below: Neighbour) => number);

interface LevelStackLook {
  /** The wrapping group's name. */
  readonly name: string;
  /** How a part looks, from its level and position: the template's whole say on the hierarchy. */
  readonly look: (part: LevelPart) => LevelLook;
  /** The template's divider, as wide as it likes up to `width`. Without it `---` draws nothing. */
  readonly divider?: (width: number) => Block;
  /** Where each row sits across the block. Defaults to `center`. */
  readonly align?: Align;
}

/**
 * How a stack is drawn. `gap` is the space between two parts of one line, each on its own row,
 * never above a piece `joined` to the one before it by a typed break (TYTO-854);
 * `lineGap` the space between two lines, or a line and a divider, from the two items drawn
 * around it (a divider left out is not a neighbour). `lineGap` defaults to `gap` only when `gap`
 * is a number: a function of two parts cannot space two lines.
 */
export type LevelStackStyle = LevelStackLook &
  (
    | { readonly gap: number; readonly lineGap?: LevelGap<LevelItem> }
    | {
        readonly gap: (above: LevelPart, below: LevelPart) => number;
        readonly lineGap: LevelGap<LevelItem>;
      }
  );

/**
 * The items drawn top to bottom, one part per row, each row as tall as its words measure, so
 * a part that wraps pushes everything under it down. A divider with nothing drawn on one side
 * of it divides nothing and is left out, as `titleBlock` leaves out its rule.
 */
export function levelStack(
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
    const rows = item.parts.map((part, index) => rowOf(part, index, style, width, measure, align));
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
    if (index > 0) y += spaceOf(lineGap, kept[index - 1]!.item, each.item);
    if (each.kind === 'divider') {
      children.push(at(offsetOf(align, width, each.drawing.width), y, each.drawing));
      y += each.drawing.height;
      continue;
    }
    for (const [row, piece] of each.rows.entries()) {
      // A piece joined by a typed break is the next line of one text: no part gap above it.
      const part = each.item.parts[row]!;
      if (row > 0 && part.joined !== true) {
        y += spaceOf(style.gap, each.item.parts[row - 1]!, part);
      }
      children.push(at(offsetOf(align, width, piece.width), y, piece));
      y += piece.height;
    }
  }

  if (children.length === 0) return stack({ name: style.name, items: [] });
  return block(width, y, group({ name: style.name, children }));
}

function spaceOf<Neighbour>(gap: LevelGap<Neighbour>, above: Neighbour, below: Neighbour): number {
  return typeof gap === 'number' ? gap : gap(above, below);
}

function rowOf(
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
  return grownTextBlock(words, width, look.style.size * lineHeight, look.style, measure, {
    name: `${style.name}-${part.position}-${index}`,
    align: TEXT_ALIGN[align],
    lineHeight,
    ...(look.letterSpacing === undefined ? {} : { letterSpacing: look.letterSpacing }),
  });
}

const TEXT_ALIGN = { start: 'left', center: 'center', end: 'right' } as const;

function offsetOf(align: Align, width: number, itemWidth: number): number {
  if (align === 'center') return (width - itemWidth) / 2;
  if (align === 'end') return width - itemWidth;
  return 0;
}
