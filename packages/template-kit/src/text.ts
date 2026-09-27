import { group, runsOf, text } from '@tyto/core/template';

import { type Block, block } from './blocks.js';

import type { FontRef, RichText, TemplateContext, TextRun } from '@tyto/core';
import type { NonEmpty, TextOptions } from '@tyto/core/template';

/**
 * Text as a {@link Block}: a brief's words at a size somebody stated, or at the size they
 * measure to.
 *
 * Moved here from `agenda-semana/parts.ts` by TYTO-185. Neither function knows a colour or
 * a face — both arrive in a {@link TextStyle} — so they are mechanism, and mechanism is what
 * this package owns.
 */

/** What a template is handed to ask how tall its text will be (ADR 0038). */
export type Measure = TemplateContext['measure'];

/** The four things a run of brief text is drawn with. */
export interface TextStyle {
  readonly font: FontRef;
  readonly size: number;
  readonly weight: number;
  readonly color: string;
}

/** Everything `text()` takes except what these functions decide themselves. */
export type TextBlockOptions = Omit<TextOptions, 'runs' | 'box'>;

/**
 * At least one run, or nothing.
 *
 * `text()` takes `NonEmpty<TextRun>` because a text node with no runs is
 * `E_SCENE_EMPTY_TEXT` — the SDK makes it unwritable rather than diagnosable. A brief can
 * still leave a field empty, so somebody has to turn "no runs" into "no node", and this is
 * the narrowing that lets the compiler check that it happened.
 */
export function atLeastOne(runs: readonly TextRun[]): NonEmpty<TextRun> | undefined {
  const [first, ...rest] = runs;
  return first === undefined ? undefined : [first, ...rest];
}

function runsIn(value: RichText, style: TextStyle): NonEmpty<TextRun> | undefined {
  return atLeastOne(
    runsOf(value, { font: style.font, size: style.size, weight: style.weight, color: style.color }),
  );
}

/** The same room, painted with nothing: a group is a transform and a list, one node. */
function nothing(width: number, height: number): Block {
  return block(width, height, group({ children: [] }));
}

/**
 * A text block of a stated size, or the same space drawn empty.
 *
 * The size is stated either way, which is what keeps a row the same shape when one of its
 * fields was left empty in the brief.
 */
export function textBlock(
  value: RichText,
  size: { readonly w: number; readonly h: number },
  style: TextStyle,
  options: TextBlockOptions = {},
): Block {
  const runs = runsIn(value, style);
  if (runs === undefined) return nothing(size.w, size.h);

  return block(size.w, size.h, text({ ...options, runs, box: { w: size.w, h: size.h } }));
}

/**
 * A text block as tall as its lines, and never shorter than `minHeight`.
 *
 * **It wraps and grows rather than shrinking** (TYTO-184). The text is built with the width
 * and no height, asked how tall it comes out, and given that height — never less than
 * `minHeight`, so a short line is drawn exactly as a fixed box would draw it.
 *
 * Where nothing can measure (`measure` answers `undefined`: no faces in this compile), the
 * box is `minHeight` and a long line shrinks into it. That height is a guess, and the
 * exporter's own wrap can differ from it.
 */
export function grownTextBlock(
  value: RichText,
  width: number,
  minHeight: number,
  style: TextStyle,
  measure: Measure,
  options: TextBlockOptions = {},
): Block {
  const runs = runsIn(value, style);
  if (runs === undefined) return nothing(width, minHeight);

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

/**
 * How wide a brief's words come out on one line, rounded up to a whole pixel: 0 for an empty
 * field, and nothing when nothing can measure.
 *
 * Rounded up so a box made exactly this wide never wraps the line it was measured for over a
 * fraction of a pixel.
 */
export function naturalWidth(
  value: RichText,
  style: TextStyle,
  measure: Measure,
): number | undefined {
  const runs = runsIn(value, style);
  if (runs === undefined) return 0;
  const measured = measure(text({ runs, box: {} }));
  return measured === undefined ? undefined : Math.ceil(measured.width);
}
