import { run } from './values.js';
import { linearReading } from '../text/formula.js';
import { originOf, rememberOrigin } from '../text/origin.js';
import { unionRanges } from '../source/range.js';
import type { SourceRange } from '../source/range.js';
import type { ColorChannels, RunBoxOptions } from './values.js';
import type { Inline, RichText } from '../brief/ast.js';
import type { RunBox, TextRun, TextSpan } from '../scene/nodes.js';
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
  /**
   * A filled box behind the text (ADR 0231). A highlight that names one boxes the words it
   * wraps, and the exporter breaks the lines, so the box follows wherever they land.
   */
  readonly box?: RunBoxOptions;
}

export interface RunsOptions {
  /**
   * What `**bold**` does to the runs it wraps. A number is a weight, as it always was; a
   * partial style can change the colour too (TYTO-554), and a style that names no weight still
   * takes 700, because bold that drew no heavier would not read as bold. Nothing at all is 700.
   */
  readonly bold?: number | Partial<RunStyle>;
  /** What `*italic*` does to the runs it wraps; it is always italic, whatever else it changes. */
  readonly italic?: Partial<RunStyle>;
  /** What `{key:value}` does to the runs it wraps; `undefined` leaves them alone. */
  readonly mark?: (key: string, value: string) => Partial<RunStyle> | undefined;
  /**
   * The px a paragraph adds between its lines and the next paragraph's (ADR 0205): a blank
   * line in the brief's text. Absent, 0 or less is none, and a paragraph boundary is then the
   * plain `LineBreak` it was before paragraphs existed.
   */
  readonly paragraphSpacing?: number;
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

/**
 * Two boxes draw the same when every field matches. Two neighbouring runs with the same box
 * merge into one box, which is what a designer drawing one word set on a colour means.
 */
function sameBox(a: RunBox | undefined, b: RunBox | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.padding.x === b.padding.x &&
    a.padding.over === b.padding.over &&
    a.padding.under === b.padding.under &&
    a.radius === b.radius &&
    samePaint(a.paint, b.paint)
  );
}

/** Every field a `TextSpan` has except `text`: what "these two would draw the same" means. */
const sameStyle = (a: TextSpan, b: TextSpan) =>
  a.size === b.size &&
  a.weight === b.weight &&
  a.style === b.style &&
  a.decoration === b.decoration &&
  sameFont(a.font, b.font) &&
  samePaint(a.color, b.color) &&
  sameBox(a.box, b.box);

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
      return typeof options.bold === 'object'
        ? { ...style, weight: BOLD, ...options.bold }
        : { ...style, weight: options.bold ?? BOLD };
    case 'italic':
      return { ...style, ...options.italic, style: 'italic' };
    case 'mark':
      return { ...style, ...options.mark?.(inline.key, inline.value) };
    default:
      return style;
  }
}

/** A paragraph boundary carries its room only when the template gave it some. */
function breakOf(inline: Inline & { kind: 'break' }, spacing: number | undefined): TextRun {
  return inline.paragraph === true &&
    spacing !== undefined &&
    Number.isFinite(spacing) &&
    spacing > 0
    ? { kind: 'break', space: spacing }
    : { kind: 'break' };
}

/**
 * A formula takes the style around it, bold, italic and marks included, so
 * `{cor:roxo}$x^2${/}` colours the whole formula (ADR 0206 decision 16). It is never merged
 * with a neighbour: it is a run of its own kind, laid out by `measureText`.
 */
function formulaOf(inline: Inline & { kind: 'formula' }, style: RunStyle): TextRun {
  // `run` turns the style's colour into a `Paint` exactly as it does for a span.
  const { font, size, weight, style: slant, color } = run(inline.source, style);
  const produced: TextRun = {
    kind: 'formula',
    text: linearReading(inline.math),
    math: [...inline.math],
    font,
    size,
    weight,
    style: slant,
    color,
  };
  rememberOrigin(produced, inline.range);
  return produced;
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
        target.push(breakOf(inline, options.paragraphSpacing));
        break;
      case 'formula':
        target.push(formulaOf(inline, style));
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
