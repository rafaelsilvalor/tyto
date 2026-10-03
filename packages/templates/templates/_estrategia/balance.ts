/**
 * Setting a short text in a fixed box: the largest size it fits at, with its lines balanced
 * and broken where a reader would break them (TYTO-210, the product banner).
 *
 * Tyto's layout breaks greedily — as many words on a line as fit — which leaves a long line
 * over a short one and ends lines wherever the width runs out (`Prefeitura Municipal de / São
 * Miguel`). So this decides the breaks itself and the caller draws each line after a
 * `lineBreak()`; the layout is left nothing to choose.
 *
 * ## What is chosen, in order
 *
 * 1. **The size**: the largest step between the floor and the ceiling at which some set of
 *    breaks fits the box **without ending a line on a function word** (`breaks.ts`: `de`, `do`,
 *    `e`…). Only when no size has such a set is the search run again allowing them. So a
 *    clean break at a smaller size beats an awkward one at a larger size: a better break
 *    existed. A setting that fits at a size fits at every smaller one — widths and line
 *    heights are linear in the size — which is what makes a binary search valid.
 * 2. **At that size, the breaks**, compared in this order:
 *    - fewer lines ending on a function word (`breaks.ts`), so `de`, `do`, `e` close a line
 *      only when no break that fits avoids it;
 *    - fewer lines;
 *    - the narrowest widest line, which is what balanced means: no long line over a short one.
 *
 * Every set of breaks is tried while there are at most {@link ENUMERATION_CAP} pieces — a
 * title, never a paragraph — which is 2^(n−1) sets. Above the cap the breaks are greedy, so a
 * pasted paragraph costs one pass and not an exponential.
 *
 * What a piece is, and what must never split, is the caller's: it glues before it splits.
 * Widths come from the caller too, measured once per run of pieces at a reference size and
 * scaled.
 */

import { endsOnFunctionWord } from './breaks.js';

/** Above this many pieces, the breaks are greedy rather than searched. */
export const ENUMERATION_CAP = 12;

/** Sizes the search may land on. */
export interface SizeRange {
  readonly floor: number;
  readonly ceiling: number;
  readonly step: number;
}

export interface BalanceRequest {
  /** The glued pieces, in order. */
  readonly pieces: readonly string[];
  /** Pieces that must start a line: where the author broke it. */
  readonly forced: ReadonlySet<number>;
  /**
   * The width of pieces `from` to `to` (exclusive) set on one line at `reference`, or
   * `undefined` when nothing can measure.
   */
  readonly widthOf: (from: number, to: number) => number | undefined;
  readonly reference: number;
  readonly box: { readonly w: number; readonly h: number };
  /** A line's height, as a multiple of the size. */
  readonly lineHeight: number;
  readonly sizes: SizeRange;
}

/** What was chosen. */
export interface Balanced {
  readonly size: number;
  /** The index of the first piece of each line; the first is always 0. */
  readonly starts: readonly number[];
  /** How far the setting runs past the box, in px; 0 when it fits. */
  readonly overflow: number;
}

/**
 * The setting for `request`, or `undefined` when there are no pieces or nothing can measure.
 *
 * When even the floor does not fit, the floor's best attempt comes back with its `overflow`,
 * so the caller reports it rather than cutting the text.
 */
export function balance(request: BalanceRequest): Balanced | undefined {
  const count = request.pieces.length;
  if (count === 0) return undefined;
  const widths = rangeWidths(request);
  if (widths === undefined) return undefined;

  return (
    largestFitting(request, widths, true) ??
    largestFitting(request, widths, false) ??
    settingAt(request, widths, request.sizes.floor, false)
  );
}

/**
 * The setting at the largest size that fits, or `undefined` when not even the floor does.
 * `clean` admits only settings that end no line on a function word.
 */
function largestFitting(request: BalanceRequest, widths: Widths, clean: boolean) {
  const { floor, ceiling, step } = request.sizes;
  let low = Math.ceil(floor / step);
  let high = Math.floor(ceiling / step);
  let best: Balanced | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const setting = settingAt(request, widths, middle * step, clean);
    if (setting.overflow === 0) {
      best = setting;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

/** Every run's width at the reference size, read once; `undefined` when one cannot be. */
type Widths = (from: number, to: number) => number;

function rangeWidths(request: BalanceRequest): Widths | undefined {
  const cache = new Map<number, number>();
  const count = request.pieces.length;
  const read = (from: number, to: number): number | undefined => {
    const key = from * (count + 1) + to;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const measured = request.widthOf(from, to);
    if (measured !== undefined) cache.set(key, measured);
    return measured;
  };
  // One probe answers whether anything can measure at all; afterwards a gap is a bug.
  if (read(0, count) === undefined) return undefined;
  return (from, to) => read(from, to) ?? Number.POSITIVE_INFINITY;
}

/**
 * The best setting at one size: one that fits if any does, otherwise the least overflow.
 * `clean` leaves out every setting that ends a line on a function word, and when that leaves
 * nothing the overflow is infinite.
 */
function settingAt(
  request: BalanceRequest,
  widths: Widths,
  size: number,
  clean: boolean,
): Balanced {
  const count = request.pieces.length;
  if (count > ENUMERATION_CAP) {
    const starts = greedyStarts(request, widths, size);
    const awkward = clean && scoreOf(request, widths, starts).functionWordEndings > 0;
    const overflow = awkward ? Number.POSITIVE_INFINITY : overflowOf(request, widths, size, starts);
    return { size, starts, overflow };
  }

  let best: { starts: number[]; overflow: number; score: Score } | undefined;
  const gaps = count - 1;
  for (let mask = 0; mask < 1 << gaps; mask += 1) {
    const starts = startsOf(mask, gaps);
    if (!respectsForced(starts, request.forced)) continue;
    const overflow = overflowOf(request, widths, size, starts);
    const score = scoreOf(request, widths, starts);
    if (clean && score.functionWordEndings > 0) continue;
    if (best === undefined || better(overflow, score, best.overflow, best.score)) {
      best = { starts, overflow, score };
    }
  }
  if (best === undefined) return { size, starts: [0], overflow: Number.POSITIVE_INFINITY };
  return { size, starts: best.starts, overflow: best.overflow };
}

/** Line starts from a bit per gap: bit `i` set breaks before piece `i + 1`. */
function startsOf(mask: number, gaps: number): number[] {
  const starts = [0];
  for (let gap = 0; gap < gaps; gap += 1) {
    if ((mask & (1 << gap)) !== 0) starts.push(gap + 1);
  }
  return starts;
}

function respectsForced(starts: readonly number[], forced: ReadonlySet<number>): boolean {
  for (const index of forced) if (!starts.includes(index)) return false;
  return true;
}

/** As many pieces on each line as fit, a forced break always taken. */
function greedyStarts(request: BalanceRequest, widths: Widths, size: number): number[] {
  const scale = size / request.reference;
  const starts = [0];
  let start = 0;
  for (let index = 1; index < request.pieces.length; index += 1) {
    const tooWide = widths(start, index + 1) * scale + SLACK > request.box.w;
    if (request.forced.has(index) || tooWide) {
      starts.push(index);
      start = index;
    }
  }
  return starts;
}

/**
 * A pixel of slack, so a line measured exactly as wide as the box is never wrapped again by a
 * rounding error between the scaled width and the one the layout measures at this size.
 */
const SLACK = 1;

/** How far these lines run past the box at this size, across or down; 0 when they fit. */
function overflowOf(
  request: BalanceRequest,
  widths: Widths,
  size: number,
  starts: readonly number[],
): number {
  const scale = size / request.reference;
  const widest = Math.max(...lineWidths(request, widths, starts)) * scale + SLACK;
  const height = starts.length * request.lineHeight * size;
  return Math.max(0, widest - request.box.w, height - request.box.h);
}

function lineWidths(request: BalanceRequest, widths: Widths, starts: readonly number[]): number[] {
  return starts.map((start, line) => widths(start, starts[line + 1] ?? request.pieces.length));
}

/** What tells two settings that both fit apart, most important first. */
interface Score {
  readonly functionWordEndings: number;
  readonly lines: number;
  readonly widest: number;
}

function scoreOf(request: BalanceRequest, widths: Widths, starts: readonly number[]): Score {
  // The last line ends where the text does, and a forced break is the author's: neither is
  // a choice this makes.
  const endings = starts
    .slice(1)
    .filter((start) => !request.forced.has(start))
    .filter((start) => endsOnFunctionWord(request.pieces[start - 1]!)).length;
  return {
    functionWordEndings: endings,
    lines: starts.length,
    widest: Math.max(...lineWidths(request, widths, starts)),
  };
}

function better(overflow: number, score: Score, bestOverflow: number, bestScore: Score): boolean {
  if (overflow !== bestOverflow) return overflow < bestOverflow;
  if (score.functionWordEndings !== bestScore.functionWordEndings) {
    return score.functionWordEndings < bestScore.functionWordEndings;
  }
  if (score.lines !== bestScore.lines) return score.lines < bestScore.lines;
  return score.widest < bestScore.widest;
}
