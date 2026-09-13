import { run } from './values.js';
import { originOf, rememberOrigin } from '../text/origin.js';
import { unionRanges } from '../source/range.js';
import type { SourceRange } from '../source/range.js';
import type { ColorChannels } from './values.js';
import type { Inline, RichText } from '../brief/ast.js';
import type { TextRun, TextSpan } from '../scene/nodes.js';
import type { Color, FontRef, GradientStop, Paint } from '../scene/primitives.js';

/**
 * `RichText` from a brief → `TextRun[]` for a `text()` node.
 *
 * The brief says what is emphasised; the template says what emphasis looks like. This is
 * the seam: bold and italic arrive as structure and leave as a weight and a style, and a
 * `Break` arrives as structure and leaves as a `LineBreak` run rather than as a `\n` in a
 * string (ADR 0016).
 *
 * Marks are the part no default can cover. `{cor:laranja}` names a colour in the template's
 * own vocabulary, and only the template knows what `laranja` is, so it supplies the
 * mapping. A mark nothing maps passes its children through unchanged — a template that
 * does not use a mark should not have to refuse it.
 */

/** The style text takes where the brief says nothing about it. */
export interface RunStyle {
  readonly font: FontRef;
  readonly size: number;
  readonly color: string | ColorChannels | Paint;
  readonly weight?: number;
  readonly style?: 'normal' | 'italic';
  readonly decoration?: 'underline' | 'line-through';
}

export interface RunsOptions {
  /** The weight `**bold**` takes. 700 is what a template that says nothing means. */
  readonly bold?: number;
  /** What `{key:value}` does to the runs it wraps; `undefined` leaves them alone. */
  readonly mark?: (key: string, value: string) => Partial<RunStyle> | undefined;
}

const BOLD = 700;

const sameColor = (a: Color, b: Color) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

const sameStops = (a: readonly GradientStop[], b: readonly GradientStop[]) =>
  a.length === b.length &&
  a.every((stop, index) => {
    const other = b[index];
    return (
      other !== undefined && stop.offset === other.offset && sameColor(stop.color, other.color)
    );
  });

/**
 * Compared by variant rather than by a generic deep equal, so that a `Paint` gaining a
 * field fails to compile here instead of silently comparing as equal.
 */
function samePaint(a: Paint, b: Paint): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'solid':
      return b.kind === 'solid' && sameColor(a.color, b.color);
    case 'linear-gradient':
      return b.kind === 'linear-gradient' && a.angle === b.angle && sameStops(a.stops, b.stops);
    case 'radial-gradient':
      return (
        b.kind === 'radial-gradient' &&
        a.center.x === b.center.x &&
        a.center.y === b.center.y &&
        a.radius === b.radius &&
        sameStops(a.stops, b.stops)
      );
    case 'image':
      return (
        b.kind === 'image' &&
        a.fit === b.fit &&
        a.asset.id === b.asset.id &&
        a.asset.source === b.asset.source &&
        a.asset.path === b.asset.path &&
        a.asset.hash === b.asset.hash
      );
  }
}

const sameFont = (a: FontRef, b: FontRef) =>
  a.family === b.family && a.source === b.source && a.path === b.path;

/** Every field a `TextSpan` has except `text`: what "these two would draw the same" means. */
const sameStyle = (a: TextSpan, b: TextSpan) =>
  a.size === b.size &&
  a.weight === b.weight &&
  a.style === b.style &&
  a.decoration === b.decoration &&
  sameFont(a.font, b.font) &&
  samePaint(a.color, b.color);

/**
 * One run where two would have drawn the same thing.
 *
 * The source is not `a *b* c` — bold splits that into three inlines with two different
 * styles, which is correct and not mergeable. It is a mark nothing maps: `styled` passes
 * those children through with the surrounding style exactly, so
 * `Direito {cor:laranja}Constitucional{/} hoje` in a template that never declared
 * `laranja` is three runs that are one run's worth of drawing.
 *
 * The merged run's origin spans both sources, which is a decision and not a detail: a
 * `W_TEXT_OVERFLOW` on it points at the whole stretch the author wrote rather than at
 * whichever third of it happened to come first. `unionRanges` covers the gap between
 * them, and the gap is exactly the directive that produced no style.
 *
 * Returns `false` when the previous run cannot absorb this one — a `LineBreak` is never a
 * merge target, so two breaks in a row stay two runs (ADR 0016).
 */
function absorbedByPrevious(target: TextRun[], produced: TextSpan, range: SourceRange): boolean {
  const previous = target[target.length - 1];
  if (previous === undefined || previous.kind !== 'text') return false;
  if (!sameStyle(previous, produced)) return false;

  const merged: TextSpan = { ...previous, text: previous.text + produced.text };
  const origin = originOf(previous);
  rememberOrigin(merged, origin === undefined ? range : unionRanges(origin, range));
  target[target.length - 1] = merged;
  return true;
}

function styled(inline: Inline, style: RunStyle, options: RunsOptions): RunStyle {
  switch (inline.kind) {
    case 'bold':
      return { ...style, weight: options.bold ?? BOLD };
    case 'italic':
      return { ...style, style: 'italic' };
    case 'mark':
      return { ...style, ...options.mark?.(inline.key, inline.value) };
    default:
      return style;
  }
}

function append(target: TextRun[], text: RichText, style: RunStyle, options: RunsOptions): void {
  for (const inline of text) {
    switch (inline.kind) {
      case 'text': {
        // Empty text would produce a run that draws nothing and still counts as one.
        if (inline.value === '') break;
        const produced = run(inline.value, style);
        if (absorbedByPrevious(target, produced, inline.range)) break;
        // Where it came from, so W_TEXT_OVERFLOW can point at the directive rather than at
        // a node id. Kept outside the IR; see `text/origin.ts`.
        rememberOrigin(produced, inline.range);
        target.push(produced);
        break;
      }
      case 'break':
        target.push({ kind: 'break' });
        break;
      default:
        append(target, inline.children, styled(inline, style, options), options);
        break;
    }
  }
}

export function runsOf(text: RichText, base: RunStyle, options: RunsOptions = {}): TextRun[] {
  const runs: TextRun[] = [];
  append(runs, text, base, options);
  return runs;
}
