/**
 * The product banner (TYTO-210): one text over a fixed background, the same words in every
 * format.
 *
 * The background is a PNG per format in the template's own folder, read through
 * `context.files` (ADR 0062): `assets/bg-<format>.png`, drawn full-bleed. Over it go the
 * brand kit's logo, or its placeholder (ADR 0065), in the format's logo box, and the text.
 *
 * The text is set by `balance.ts` in the format's {@link BannerLayout} box: the largest size
 * between the layout's floor and ceiling at which it fits, its lines balanced, a
 * parenthesised group like `(GO)` never split nor alone (`breaks.ts`), and no line ending on
 * `de` or `e` when a better break exists. The breaks are drawn as `lineBreak()`s, so the
 * layout chooses nothing. When even the floor does not fit, the text is drawn at the floor
 * and `W_TEMPLATE_OVERFLOW` says by how much — never a silent cut.
 *
 * `**bold**` in the brief is the bold face; italic is drawn upright, because the house faces
 * ship Regular and Bold only.
 */

import { frame, image, lineBreak, run, runsOf, solid, text } from '@tyto/core/template';
import { at, atLeastOne, mark, reportOverflow } from '@tyto/template-kit';

import { balance } from './balance.js';
import { glueParenthesised } from './breaks.js';
import { logoOf } from './kit.js';
import { BOLD, BOOK, FACE, PAPER } from './tokens.js';

import type { SizeRange } from './balance.js';
import type { RichText, TemplateBuild, TemplateContext, TextRun, TextSpan } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';
import type { Measure } from '@tyto/template-kit';

/** Where one format's text goes, and how large it may be. */
export interface BannerLayout {
  /** The box the text is centred in, in the format's pixels. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** The text's size, in px. */
  readonly sizes: SizeRange;
  /** A line's height, as a multiple of the size. */
  readonly lineHeight: number;
  /**
   * The box the logo is drawn in, in the format's pixels. It is drawn at the box's height and
   * centred across its width, so a kit's logo of another shape keeps the same centre line.
   */
  readonly logo?: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/** What one brand's banner is drawn with. */
export interface BannerStyle {
  /** The text's colour. */
  readonly ink: string;
  /** The logo's colour. */
  readonly logoInk: string;
  /** Each format's layout, by format id. */
  readonly layouts: Readonly<Record<string, BannerLayout>>;
}

/** The size widths are measured at, then scaled: an advance is linear in the size. */
const REFERENCE_SIZE = 100;

/** Any character a parenthesised group may join: a letter, a digit, or a closing mark. */
const JOINS_A_GROUP = /[\p{L}\p{N}).,!?]/u;

/** The build for one brand's banner. */
export function productBanner(style: BannerStyle): TemplateBuild {
  return (context: TemplateContext) => {
    const background = context.files.image(`assets/bg-${context.format}.png`);
    const layout = style.layouts[context.format] ?? fallbackLayout(context.size);
    const words = styledText(richTextOf(context, 'titulo') ?? [], style.ink);

    const children: NodeDraft[] = [];
    if (background !== undefined) {
      children.push(image({ name: 'background', asset: background, size: context.size }));
    }
    if (layout.logo !== undefined) {
      const logo = mark(logoOf(context.brand), layout.logo.h, style.logoInk, 'logo');
      children.push(at(layout.logo.x + (layout.logo.w - logo.width) / 2, layout.logo.y, logo));
    }
    const titulo = setTitle(words, layout, context.measure);
    if (titulo !== undefined) {
      reportOverflow(context.report, titulo.overflow, 0);
      children.push(titulo.node);
    }

    return frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      background: solid(PAPER),
      children,
    });
  };
}

/* ---------------------------------------------------------------------- the words -- */

/**
 * The brief's text, character by character, each with the style it is drawn in.
 *
 * Kept per character so that gluing — which turns spaces into no-break spaces and changes no
 * length — and splitting into lines can both work on one plain string and still give every
 * character back its weight. The author's own line breaks are kept as `\n`.
 */
interface StyledText {
  readonly characters: string;
  readonly styles: readonly TextSpan[];
}

function styledText(titulo: RichText, ink: string): StyledText {
  const runs = runsOf(
    titulo,
    { font: FACE, size: REFERENCE_SIZE, weight: BOOK, color: ink },
    { bold: BOLD },
  );
  let characters = '';
  const styles: TextSpan[] = [];
  for (const piece of runs) {
    // An upright face only: the house faces have no italic, and asking for one breaks the
    // built-in render.
    const span: TextSpan =
      piece.kind === 'text'
        ? { ...piece, style: 'normal' }
        : { ...lastStyle(styles, ink), text: '\n' };
    const value = piece.kind === 'text' ? piece.text.replace(/\s+/gu, ' ') : '\n';
    characters += value;
    for (let index = 0; index < value.length; index += 1) styles.push(span);
  }
  return { characters, styles };
}

function lastStyle(styles: readonly TextSpan[], ink: string): TextSpan {
  return (
    styles[styles.length - 1] ??
    run('', { font: FACE, size: REFERENCE_SIZE, weight: BOOK, color: ink })
  );
}

/** One piece of the glued text and where its characters are. */
interface Piece {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The glued text's pieces, and which of them the author started a line with.
 *
 * A piece is what the layout could never break: `Alto (VA)` is one.
 */
function piecesOf(words: StyledText): { pieces: Piece[]; forced: Set<number> } {
  const glued = glueParenthesised(words.characters, JOINS_A_GROUP);
  const found: Piece[] = [];
  const forced = new Set<number>();
  let offset = 0;
  for (const line of glued.split('\n')) {
    // The first piece of every line the author wrote after the first starts a line here too.
    if (found.length > 0) forced.add(found.length);
    let cursor = offset;
    for (const part of line.split(' ')) {
      if (part !== '') found.push({ text: part, start: cursor, end: cursor + part.length });
      cursor += part.length + 1;
    }
    offset += line.length + 1;
  }
  // A break after the last piece starts no line.
  forced.delete(found.length);
  return { pieces: found, forced };
}

/** The runs of pieces `from` to `to` on one line, at `size`. */
function lineRuns(
  words: StyledText,
  all: readonly Piece[],
  from: number,
  to: number,
  size: number,
): TextRun[] {
  const first = all[from]!;
  const last = all[to - 1]!;
  const runs: TextRun[] = [];
  let index = first.start;
  while (index < last.end) {
    const style = words.styles[index]!;
    let end = index + 1;
    while (end < last.end && words.styles[end] === style) end += 1;
    // Between two pieces on one line the space is a plain one again, as the author wrote it.
    const characters = words.characters.slice(index, end).replaceAll('\n', ' ');
    runs.push({ ...style, size, text: characters });
    index = end;
  }
  return runs;
}

/* ------------------------------------------------------------------------ setting -- */

/** The title node and how far it runs past its box. */
interface SetTitle {
  readonly node: NodeDraft;
  readonly overflow: number;
}

function setTitle(words: StyledText, layout: BannerLayout, measure: Measure): SetTitle | undefined {
  const { pieces: all, forced } = piecesOf(words);
  if (all.length === 0) return undefined;

  const widthOf = (from: number, to: number): number | undefined => {
    const runs = atLeastOne(lineRuns(words, all, from, to, REFERENCE_SIZE));
    if (runs === undefined) return 0;
    return measure(text({ runs, box: {}, lineHeight: layout.lineHeight }))?.width;
  };

  const setting = balance({
    pieces: all.map((piece) => piece.text),
    forced,
    widthOf,
    reference: REFERENCE_SIZE,
    box: layout.box,
    lineHeight: layout.lineHeight,
    sizes: layout.sizes,
  });

  // Nothing can measure: one block of text the layout wraps and shrinks into the box.
  const size = setting?.size ?? layout.sizes.floor;
  const starts = setting?.starts ?? [0];
  const runs: TextRun[] = [];
  for (const [line, start] of starts.entries()) {
    if (line > 0) runs.push(lineBreak());
    const end = starts[line + 1] ?? all.length;
    runs.push(...lineRuns(words, all, start, setting === undefined ? all.length : end, size));
    if (setting === undefined) break;
  }

  const drawn = atLeastOne(runs);
  if (drawn === undefined) return undefined;
  const node = text({
    name: 'titulo',
    runs: drawn,
    box: { w: layout.box.w, h: layout.box.h },
    align: 'center',
    valign: 'middle',
    lineHeight: layout.lineHeight,
    ...(setting === undefined ? { overflow: 'shrink' as const } : {}),
    transform: { x: layout.box.x, y: layout.box.y },
  });
  return { node, overflow: setting?.overflow ?? 0 };
}

/** For a format the template has no layout for: the middle eight tenths of the canvas. */
function fallbackLayout(size: { readonly w: number; readonly h: number }): BannerLayout {
  const short = Math.min(size.w, size.h);
  return {
    box: { x: size.w * 0.1, y: size.h * 0.1, w: size.w * 0.8, h: size.h * 0.8 },
    sizes: { floor: Math.max(8, short / 40), ceiling: short / 8, step: 0.5 },
    lineHeight: 1.2,
  };
}

/** A rich-text slot's value, or nothing when the brief left it unset. */
function richTextOf(context: TemplateContext, name: string): RichText | undefined {
  const value = context.slots[name]?.value;
  return value?.kind === 'rich-text' ? value.text : undefined;
}
