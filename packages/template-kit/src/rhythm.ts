import { ORPHAN_WORD_LIMIT } from '@tyto/core/template';

import type { TemplateContext, TextRun } from '@tyto/core';

/**
 * Blocks spaced by weight between two edges, and text kept from ending a paragraph on a line
 * of one word (TYTO-516, ADR 0167).
 *
 * Both came out of `questao-estrategica`'s answer slide, which placed each block at a fixed top
 * read off its reference art: the gap left at the foot was whatever the text did not use, the
 * block sat high or low depending on its length, and one paragraph ended on "princípio." alone.
 * Nothing here knows that slide. A template states its gaps as weights and its limits as
 * numbers, and the same two functions serve the next template.
 */

/* ------------------------------------------------------------------------------- gaps -- */

export interface WeightedSpacing {
  /** Where the room starts and ends, in the frame's pixels: the foot of what is above, the top of what is below. */
  readonly top: number;
  readonly bottom: number;
  /** Each block's height, top to bottom. */
  readonly heights: readonly number[];
  /**
   * One weight per gap: the gap over the first block, one between each pair, and the gap under
   * the last — so `heights.length + 1` of them. Equal outer weights centre the blocks.
   */
  readonly weights: readonly number[];
}

export interface Spaced {
  /** Each block's top. */
  readonly tops: readonly number[];
  /** What a weight of 1 came to, in px. 0 when the blocks fill the room or more. */
  readonly unit: number;
  /** How far the blocks run past the room, in px; 0 when they fit. */
  readonly overflow: number;
}

/**
 * The blocks laid top to bottom with the room they leave shared out by weight.
 *
 * Every gap is a multiple of one unit, so they grow and shrink together and keep their
 * proportions — the largest stays the largest — whatever the text's length. When the blocks do
 * not fit, the gaps are 0 and `overflow` says by how much, for the caller to report (ADR 0058).
 */
export function spaceByWeight(spacing: WeightedSpacing): Spaced {
  const { top, bottom, heights, weights } = spacing;
  if (weights.length !== heights.length + 1) {
    throw new RangeError(
      `spaceByWeight takes ${String(heights.length + 1)} weights for ${String(heights.length)} blocks, got ${String(weights.length)}`,
    );
  }
  const used = heights.reduce((sum, height) => sum + height, 0);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const free = bottom - top - used;
  const unit = free > 0 && totalWeight > 0 ? free / totalWeight : 0;

  const tops: number[] = [];
  let cursor = top;
  heights.forEach((height, index) => {
    cursor += (weights[index] ?? 0) * unit;
    tops.push(cursor);
    cursor += height;
  });
  return { tops, unit, overflow: Math.max(0, -free) };
}

/* ------------------------------------------------------------------------------ orphans -- */

/** What a template is handed to ask how its text lays out (ADR 0038). */
type Measure = TemplateContext['measure'];
type MeasurableText = Parameters<Measure>[0];

/** How far a template lets the setting move to keep an orphan off its text. */
export interface OrphanLimits {
  /** How far under the size the text fitted at the size may go, as a fraction of that size. */
  readonly shrink: number;
  /** The most letter spacing added or taken away, in em. */
  readonly tracking: number;
  /** Whether a word may move down from the line above ({@link rebreak}); absent, it may. */
  readonly rebreak?: boolean;
}

/**
 * The house default: a size at most 8% smaller, and letter spacing within a hundredth of an em
 * either way — a change a reader does not see as a different setting.
 */
export const ORPHAN_LIMITS: OrphanLimits = { shrink: 0.08, tracking: 0.01 };

/** The steps the search takes inside the limits: a whole pixel of size, a quarter of the tracking. */
const SIZE_STEP = 1;
const TRACKING_STEPS = 4;

/** A size and a letter spacing, both in px: what a node is built with. */
export interface Setting {
  readonly size: number;
  readonly letterSpacing: number;
  /**
   * The text's runs with one more break, when the text was {@link rebreak}-ed (TYTO-520): the
   * caller draws these instead of its own. Absent, the caller draws what it wrote.
   */
  readonly runs?: readonly TextRun[];
}

export interface SettleRequest<Laid> {
  /** The size the text fits at before any orphan is looked for. */
  readonly size: number;
  /**
   * Lays the text out at a setting: the text node whose last lines are read, whether everything
   * still fits the room, and what the caller keeps.
   */
  readonly layout: (setting: Setting) => {
    readonly text: MeasurableText;
    readonly fits: boolean;
    readonly laid: Laid;
  };
  readonly measure: Measure;
  readonly limits?: OrphanLimits;
}

export interface Settled<Laid> {
  readonly setting: Setting;
  readonly laid: Laid;
  /** The single word a paragraph still ends on, when no setting within the limits moved it. */
  readonly orphan?: string;
}

/**
 * The text set at the first setting, within the limits, at which no paragraph ends on a line of
 * one word.
 *
 * Tried in the order a reader notices least. First the text broken one word earlier above the
 * orphan ({@link rebreak}), at the same size and spacing (TYTO-520): the setting carries the
 * new runs. Then letter spacing at the size the text fitted at, nearest first; then each pixel
 * smaller, plain and then with the same letter spacing. Wider
 * letters push a word down onto the last line, narrower ones or a smaller size pull the lonely
 * word up — either clears it. A setting at which the text no longer fits its room is skipped.
 *
 * When none clears it, the text is set as it fitted and `orphan` names the word, for
 * {@link reportOrphan}. When nothing can measure, nothing is known about the lines: the text is
 * set as it fitted, with no orphan claimed.
 */
export function settle<Laid>(request: SettleRequest<Laid>): Settled<Laid> {
  const { size, layout, measure } = request;
  const limits = request.limits ?? ORPHAN_LIMITS;
  const first = layout({ size, letterSpacing: 0 });
  const orphanAt = (text: MeasurableText): string | undefined => {
    const measured = measure(text);
    return measured === undefined ? undefined : orphanOf(text.runs, measured.runs);
  };

  // Unmeasurable and clean look the same here, and both mean the setting stands.
  const measured = measure(first.text);
  const found = measured === undefined ? undefined : orphanOf(first.text.runs, measured.runs);
  if (found === undefined) return { setting: { size, letterSpacing: 0 }, laid: first.laid };

  const rebroken =
    measured === undefined || limits.rebreak === false
      ? undefined
      : rebreak(first.text.runs, measured.runs);
  if (rebroken !== undefined) {
    const setting = { size, letterSpacing: 0, runs: rebroken };
    const tried = layout(setting);
    // Measured again rather than trusted: the line above may now end on one word, or the moved
    // word may not fit beside the lonely one and wrap, which leaves an orphan either way.
    if (tried.fits && orphanAt(tried.text) === undefined) return { setting, laid: tried.laid };
  }

  const smallest = Math.ceil(size * (1 - limits.shrink));
  for (let candidate = size; candidate >= smallest; candidate -= SIZE_STEP) {
    for (const em of trackings(limits.tracking)) {
      if (candidate === size && em === 0) continue;
      const setting = { size: candidate, letterSpacing: round(em * candidate) };
      const tried = layout(setting);
      if (tried.fits && orphanAt(tried.text) === undefined) return { setting, laid: tried.laid };
    }
  }
  return { setting: { size, letterSpacing: 0 }, laid: first.laid, orphan: found };
}

/** 0, then ±a quarter of the limit, ±half and so on out to ±the limit, nearest first. */
function trackings(limit: number): number[] {
  const steps = [0];
  if (limit <= 0) return steps;
  for (let step = 1; step <= TRACKING_STEPS; step += 1) {
    const em = (limit * step) / TRACKING_STEPS;
    steps.push(-em, em);
  }
  return steps;
}

/** Rounded to a thousandth of a pixel, so the same setting is written the same way twice. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The single word the first orphaned paragraph ends on, or `undefined` when none is.
 *
 * `written` are the runs the text was built with, its paragraphs split where the author broke
 * them; `laid` are the same runs with every break decided, as `measure` hands them back. A
 * paragraph is orphaned when it takes more than one line and its last line holds one word.
 * Words are counted as a reader sees them, so two joined by a no-break space are two: that is
 * how an author keeps the last pair together by hand, and it leaves no orphan.
 */
export function orphanOf(
  written: readonly TextRun[],
  laid: readonly TextRun[],
): string | undefined {
  return firstOrphaned(written, laid)?.word;
}

/** The first orphaned paragraph: its index, the laid lines it took, and its lonely word. */
interface Orphaned {
  readonly paragraph: number;
  readonly lines: readonly string[];
  readonly word: string;
}

function firstOrphaned(
  written: readonly TextRun[],
  laid: readonly TextRun[],
): Orphaned | undefined {
  const paragraphs = linesOf(written).map((line) => wordsOf(line).length);
  const lines = linesOf(laid);

  let line = 0;
  for (const [paragraph, count] of paragraphs.entries()) {
    if (count === 0) {
      line += 1;
      continue;
    }
    let seen = 0;
    const taken: string[] = [];
    while (seen < count && line < lines.length) {
      const text = lines[line] ?? '';
      seen += wordsOf(text).length;
      taken.push(text);
      line += 1;
    }
    const last = wordsOf(taken.at(-1) ?? '');
    if (taken.length > 1 && last.length === 1) {
      return { paragraph, lines: taken, word: last[0] ?? '' };
    }
  }
  return undefined;
}

/**
 * The text broken one word earlier above its first orphan: a break the author could have
 * written, inserted before the last word of the line over the lonely one, so the paragraph's
 * last line holds two words (TYTO-520). `undefined` when no paragraph is orphaned, or when the
 * line above has no word that may move.
 *
 * Words move only at an ordinary space, where the layout itself breaks: two words joined by a
 * no-break space go down together or not at all. Whether the result is clean is the caller's
 * to measure — the line above might now end on one word itself.
 */
export function rebreak(
  written: readonly TextRun[],
  laid: readonly TextRun[],
): TextRun[] | undefined {
  const orphaned = firstOrphaned(written, laid);
  if (orphaned === undefined) return undefined;
  // The layout's own pieces: what lies between ordinary spaces.
  const pieces = (text: string) => text.split(/ +/u).filter((piece) => piece.trim() !== '');
  const before = orphaned.lines.slice(0, -1);
  const moved = before.reduce((sum, line) => sum + pieces(line).length, 0) - 1;
  if (moved <= 0) return undefined;
  return withBreakBefore(written, orphaned.paragraph, moved);
}

/**
 * `runs` with a break before the `piece`-th space-separated piece of paragraph `paragraph`, the
 * spaces in front of it dropped as a wrap drops them.
 */
function withBreakBefore(runs: readonly TextRun[], paragraph: number, piece: number): TextRun[] {
  const result: TextRun[] = [];
  let current = 0;
  let seen = -1;
  let afterSpace = true;
  let done = false;
  for (const run of runs) {
    if (run.kind === 'break') {
      current += 1;
      afterSpace = true;
      result.push(run);
      continue;
    }
    if (done || current !== paragraph) {
      result.push(run);
      continue;
    }
    let cut = -1;
    for (let index = 0; index < run.text.length && cut < 0; index += 1) {
      const space = run.text[index] === ' ';
      if (!space && afterSpace) {
        seen += 1;
        if (seen === piece) cut = index;
      }
      afterSpace = space;
    }
    if (cut < 0) {
      result.push(run);
      continue;
    }
    const head = run.text.slice(0, cut).replace(/ +$/u, '');
    if (head !== '') result.push({ ...run, text: head });
    else trimLast(result);
    result.push({ kind: 'break' }, { ...run, text: run.text.slice(cut) });
    done = true;
  }
  return result;
}

/** Drops the spaces that end the last text run, and the run if nothing else is left. */
function trimLast(runs: TextRun[]): void {
  const last = runs.at(-1);
  if (last?.kind !== 'text') return;
  const text = last.text.replace(/ +$/u, '');
  if (text === '') runs.pop();
  else runs[runs.length - 1] = { ...last, text };
}

/** Runs into the text of each line, split at every break. */
function linesOf(runs: readonly TextRun[]): string[] {
  const lines = [''];
  for (const run of runs) {
    if (run.kind === 'break') lines.push('');
    else lines[lines.length - 1] += run.text;
  }
  return lines;
}

function wordsOf(line: string): string[] {
  return line.split(/\s+/u).filter((word) => word !== '');
}

/**
 * Says a paragraph still ends on `word` alone (ADR 0167). `compile` turns the report into
 * `W_TEMPLATE_ORPHAN` on the directive the slide came from, and the art is drawn regardless.
 */
export function reportOrphan(report: TemplateContext['report'], word: string | undefined): void {
  // Cut to the host's limit: a longer word would get the whole answer refused at the boundary.
  if (word !== undefined)
    report({ code: 'W_TEMPLATE_ORPHAN', word: [...word].slice(0, ORPHAN_WORD_LIMIT).join('') });
}
