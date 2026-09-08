import type { Color, Fit, GradientStop, Matrix, Paint, UnitPoint } from '@tyto/core';

/**
 * IR leaves as CSS text (`docs/ir-schema.md`, Exporter mapping).
 *
 * Nothing here decides anything: it is the vocabulary of the IR spelled the way a browser
 * spells it, so that the visitor next door reads as a list of what maps to what rather
 * than as string building. The one judgement in the file is `cssNumber`, and it is here
 * because a snapshot is a diff — `rotate(90deg)` on a matrix leaves `6.123233995736766e-17`
 * where a reader expects `0`, and a number that long in a committed file is noise nobody
 * can review.
 */

/**
 * Four decimals, then the shortest form of what survives.
 *
 * Four is a sub-micron at the sizes these scenes use (1080px canvases), and it is what
 * turns the cosine of 90° into `0`. `Number()` drops the trailing zeros `toFixed` adds,
 * and `|| 0` folds `-0`, which is a real product of `-sin(0)` and reads as a typo.
 */
export function cssNumber(value: number): string {
  return String(Number(value.toFixed(4)) || 0);
}

export function cssLength(value: number): string {
  return `${cssNumber(value)}px`;
}

/** A percentage of a unit value: `0.5` is `50%`. */
export function cssPercent(unit: number): string {
  return `${cssNumber(unit * 100)}%`;
}

function hex(channel: number): string {
  return channel.toString(16).padStart(2, '0');
}

/**
 * `#rrggbb` while it is opaque, `rgba(…)` once it is not.
 *
 * Both are exact; the choice is for whoever reads the snapshot, where a wall of
 * `rgba(255, 255, 255, 1)` hides the one colour that has an alpha.
 */
export function cssColor(color: Color): string {
  if (color.a === 1) return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
  return `rgba(${String(color.r)}, ${String(color.g)}, ${String(color.b)}, ${cssNumber(color.a)})`;
}

export function cssMatrix(matrix: Matrix): string {
  const parts = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
  return `matrix(${parts.map(cssNumber).join(', ')})`;
}

/** True for the matrix that changes nothing, which is most of them; it is not emitted. */
export function isIdentity(matrix: Matrix): boolean {
  return (
    matrix.a === 1 &&
    matrix.b === 0 &&
    matrix.c === 0 &&
    matrix.d === 1 &&
    matrix.e === 0 &&
    matrix.f === 0
  );
}

function stopList(stops: readonly GradientStop[]): string {
  return stops.map((item) => `${cssColor(item.color)} ${cssPercent(item.offset)}`).join(', ');
}

/**
 * The two gradients, which line up with CSS exactly.
 *
 * `angle` is degrees clockwise from up in the IR and `Ndeg` is degrees clockwise from up
 * in CSS, so the number passes through. The radial's `radius` is a fraction of the node's
 * box on both axes — the same reading SVG's `objectBoundingBox` units give it, which is
 * what keeps this exporter and `export-svg` drawing the same ellipse.
 */
export function cssGradient(paint: Paint): string | undefined {
  if (paint.kind === 'linear-gradient') {
    return `linear-gradient(${cssNumber(paint.angle)}deg, ${stopList(paint.stops)})`;
  }
  if (paint.kind === 'radial-gradient') {
    const size = `${cssPercent(paint.radius)} ${cssPercent(paint.radius)}`;
    const at = `${cssPercent(paint.center.x)} ${cssPercent(paint.center.y)}`;
    return `radial-gradient(ellipse ${size} at ${at}, ${stopList(paint.stops)})`;
  }
  return undefined;
}

/** `background-size` for a paint that is an image, and `object-fit` for an `<img>`. */
export function cssBackgroundSize(fit: Fit): string {
  return fit === 'fill' ? '100% 100%' : fit;
}

export function cssObjectPosition(position: UnitPoint): string {
  return `${cssPercent(position.x)} ${cssPercent(position.y)}`;
}

/** `[tl, tr, br, bl]`, the order `border-radius` already takes. */
export function cssRadius(radius: readonly [number, number, number, number]): string | undefined {
  if (radius.every((corner) => corner === 0)) return undefined;
  return radius.map(cssLength).join(' ');
}
