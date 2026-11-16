import type { FaceCache } from './face.js';
import { coverRuns } from './fallback.js';
import type { FormulaGlyph, FormulaRule, FormulaRun, MathItem, TextSpan } from '../scene/nodes.js';

/**
 * A formula laid out in boxes, the way TeX sets one, with one fixed geometry (ADR 0206).
 *
 * Every box is measured from its own baseline: `ascent` up, `descent` down, `width` across.
 * A text piece's box is its ink, not its face's ascent, because a fraction's clearance is
 * measured from what is drawn: the face's ascent would leave the `1` a line above its rule.
 * The numbers below are em of the size the fraction or the scripts are set in, and the same
 * for every face; a face's own `MATH` table is not read, so the layout can be redone by hand.
 */

/** The math axis, where a fraction rule is centred: about half the height of a minus sign. */
export const MATH_AXIS = 0.25;
/** The fraction rule's thickness. */
export const RULE_THICKNESS = 0.06;
/** Clear space between the rule and the ink of the numerator, and of the denominator. */
export const RULE_CLEARANCE = 0.12;
/** How far the rule runs past the wider of numerator and denominator, on each side. */
export const RULE_OVERHANG = 0.1;
/**
 * Room on each side of a fraction, outside its rule: TeX's `\nulldelimiterspace` (1.2 pt at
 * 10 pt). Without it the rule sat 8 px from an `=` before it and 9 px from one after it at
 * 40 px, closer than the words around it; Rafael chose 13 and 13 (TYTO-734, ADR 0206).
 */
export const FRACTION_SIDE = 0.12;
/** A script's size against the size it is set after. */
export const SCRIPT_SCALE = 0.7;
/** A superscript's baseline above, and a subscript's below, the baseline around them. */
export const SUPERSCRIPT_RAISE = 0.4;
export const SUBSCRIPT_DROP = 0.2;
/** The same two when both scripts are present, so they do not collide. */
export const STACKED_SUPERSCRIPT_RAISE = 0.45;
export const STACKED_SUBSCRIPT_DROP = 0.25;

/** The ink of text with no ink of its own, such as a space: a lower-case letter's. */
const NO_INK = { ascent: 0, descent: 0 };

export type FormulaStyle = Pick<FormulaRun, 'font' | 'size' | 'weight' | 'style' | 'color'>;

export interface PlacedFormula {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
  readonly glyphs: readonly FormulaGlyph[];
  readonly rules: readonly FormulaRule[];
  /** Characters no face of the chain draws (ADR 0168), once each. */
  readonly missing: readonly string[];
}

interface Box {
  width: number;
  ascent: number;
  descent: number;
  glyphs: FormulaGlyph[];
  rules: FormulaRule[];
}

/** Rounded to a thousandth, as layout rounds a size: the numbers reach a document as text. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function emptyBox(): Box {
  return { width: 0, ascent: 0, descent: 0, glyphs: [], rules: [] };
}

/** `box` drawn into `into` with its origin at (`x`, `y`). */
function place(into: Box, box: Box, x: number, y: number): void {
  for (const glyph of box.glyphs) into.glyphs.push({ ...glyph, x: glyph.x + x, y: glyph.y + y });
  for (const rule of box.rules) into.rules.push({ ...rule, x: rule.x + x, y: rule.y + y });
  into.ascent = Math.max(into.ascent, box.ascent - y);
  into.descent = Math.max(into.descent, box.descent + y);
}

/**
 * Lays a formula out at its own size, or returns `undefined` when its face cannot be
 * measured — the same answer `measureText` gives for a node in a face nothing holds.
 */
export function layoutFormula(
  run: FormulaStyle & Pick<FormulaRun, 'math'>,
  faces: FaceCache,
): PlacedFormula | undefined {
  if (faces.get({ family: run.font.family, weight: run.weight, style: run.style }) === undefined) {
    return undefined;
  }
  const missing = new Set<string>();

  const text = (value: string, size: number): Box => {
    const box = emptyBox();
    const span: TextSpan = {
      kind: 'text',
      text: value,
      font: run.font,
      size,
      weight: run.weight,
      style: run.style,
      color: run.color,
    };
    const covered = coverRuns([span], faces);
    for (const character of covered.missing) missing.add(character);
    for (const piece of covered.runs) {
      if (piece.kind !== 'text') continue;
      const face = faces.get({
        family: piece.font.family,
        weight: piece.weight,
        style: piece.style,
      });
      const ink = face?.ink?.(piece.text) ?? NO_INK;
      // One glyph per word, at the advance of what comes before it, and none for a space: a
      // space is where the next word starts, never a character to draw. A `<text>` that
      // starts with a space loses it in an HTML document — measured in Chromium on
      // `$F = \frac{1}{2} = 25\ Hz$`, the ` = 25 Hz` after the fraction was drawn 1 px from
      // the rule in HTML and 9 px from it in SVG (TYTO-734) — so the space never reaches one.
      for (const word of piece.text.matchAll(/[^ \t]+/gu)) {
        box.glyphs.push({
          text: word[0],
          font: piece.font,
          size,
          weight: piece.weight,
          style: piece.style,
          x: box.width + (face?.advance(piece.text.slice(0, word.index)) ?? 0) * size,
          y: 0,
        });
      }
      box.width += (face?.advance(piece.text) ?? 0) * size;
      box.ascent = Math.max(box.ascent, ink.ascent * size);
      box.descent = Math.max(box.descent, ink.descent * size);
    }
    return box;
  };

  const list = (items: readonly MathItem[], size: number): Box => {
    const box = emptyBox();
    for (const item of items) {
      const part = itemBox(item, size);
      place(box, part, box.width, 0);
      box.width += part.width;
    }
    return box;
  };

  const fraction = (numerator: Box, denominator: Box, size: number): Box => {
    const box = emptyBox();
    const thickness = RULE_THICKNESS * size;
    const width = Math.max(numerator.width, denominator.width) + 2 * RULE_OVERHANG * size;
    const ruleTop = -(MATH_AXIS * size + thickness / 2);
    const clearance = RULE_CLEARANCE * size;
    const side = FRACTION_SIDE * size;
    box.width = width + 2 * side;
    box.rules.push({ x: side, y: ruleTop, width, thickness });
    box.ascent = -ruleTop;
    box.descent = Math.max(0, ruleTop + thickness);
    // The numerator's ink ends `clearance` above the rule; the denominator's starts as far below.
    place(
      box,
      numerator,
      side + (width - numerator.width) / 2,
      ruleTop - clearance - numerator.descent,
    );
    place(
      box,
      denominator,
      side + (width - denominator.width) / 2,
      ruleTop + thickness + clearance + denominator.ascent,
    );
    return box;
  };

  const scripts = (
    superscript: readonly MathItem[] | undefined,
    subscript: readonly MathItem[] | undefined,
    size: number,
  ): Box => {
    const box = emptyBox();
    const both = superscript !== undefined && subscript !== undefined;
    const scriptSize = size * SCRIPT_SCALE;
    if (superscript !== undefined) {
      const raised = list(superscript, scriptSize);
      place(box, raised, 0, -(both ? STACKED_SUPERSCRIPT_RAISE : SUPERSCRIPT_RAISE) * size);
      box.width = Math.max(box.width, raised.width);
    }
    if (subscript !== undefined) {
      const lowered = list(subscript, scriptSize);
      place(box, lowered, 0, (both ? STACKED_SUBSCRIPT_DROP : SUBSCRIPT_DROP) * size);
      box.width = Math.max(box.width, lowered.width);
    }
    return box;
  };

  const itemBox = (item: MathItem, size: number): Box => {
    switch (item.kind) {
      case 'text':
        return text(item.text, size);
      case 'fraction':
        return fraction(list(item.numerator, size), list(item.denominator, size), size);
      case 'scripts':
        return scripts(item.superscript, item.subscript, size);
    }
  };

  const laid = list(run.math, run.size);
  return {
    width: round(laid.width),
    ascent: round(laid.ascent),
    descent: round(laid.descent),
    glyphs: laid.glyphs.map((glyph) => ({ ...glyph, x: round(glyph.x), y: round(glyph.y) })),
    rules: laid.rules.map((rule) => ({
      x: round(rule.x),
      y: round(rule.y),
      width: round(rule.width),
      thickness: round(rule.thickness),
    })),
    missing: [...missing],
  };
}

/**
 * A formula as one line of plain text: `1/(40·10^(−3))`. What an exporter draws when the
 * formula could not be laid out, and the reading a plain-text traversal of a brief gets
 * (ADR 0206 decisions 12 and 13). A part longer than one character goes in parentheses.
 */
export function linearReading(math: readonly MathItem[]): string {
  const grouped = (items: readonly MathItem[]): string => {
    const reading = linearReading(items);
    return [...reading].length === 1 ? reading : `(${reading})`;
  };
  return math
    .map((item) => {
      switch (item.kind) {
        case 'text':
          return item.text;
        case 'fraction':
          return `${grouped(item.numerator)}/${grouped(item.denominator)}`;
        case 'scripts':
          return (
            (item.subscript === undefined ? '' : `_${grouped(item.subscript)}`) +
            (item.superscript === undefined ? '' : `^${grouped(item.superscript)}`)
          );
      }
    })
    .join('');
}
