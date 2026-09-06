import type { Size, Transform } from './primitives.js';

/**
 * The 2D affine matrix that carries a node's `Transform` down the tree.
 *
 * A `Transform` is what a template author writes — x, y, rotation, scale, anchor. It
 * cannot be composed: two nested rotations around different anchors are not a third
 * rotation around a third anchor. A matrix can, so `walk()` accumulates matrices and
 * hands each visitor the one that maps its node's own coordinates onto the frame.
 *
 * The layout is `[a c e; b d f]`, the same six numbers and the same order as SVG's
 * `matrix(...)` and the Canvas `setTransform` — the two places these values are going.
 */
export interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const identityMatrix: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * `outer × inner`: the matrix that applies `inner` first and then `outer`.
 *
 * The argument names say which is which, because the operation does not commute and
 * `multiply(parent, child)` is the only order a tree walk ever wants.
 */
export function multiplyMatrix(outer: Matrix, inner: Matrix): Matrix {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function applyMatrix(matrix: Matrix, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * A node's own transform as a matrix.
 *
 * `box` is the node's own box, which is what `Transform.anchor` is normalised against:
 * an anchor of `{x: 0.5, y: 0.5}` on a 100×20 rect means the point (50, 10). Rotation is
 * clockwise, matching the degrees a designer states and SVG's `rotate()` in a y-down
 * space.
 *
 * The composition is translate → rotate → scale about the anchor, so scaling a rotated
 * node stretches it along its own axes rather than the frame's.
 */
export function transformMatrix(transform: Transform, box: Size): Matrix {
  const radians = transform.rotation * DEGREES_TO_RADIANS;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const linear = {
    a: cos * transform.scaleX,
    b: sin * transform.scaleX,
    c: -sin * transform.scaleY,
    d: cos * transform.scaleY,
  };

  const anchorX = transform.anchor.x * box.w;
  const anchorY = transform.anchor.y * box.h;

  // Rotate and scale about the anchor: move it to the origin, apply, move it back — and
  // only then translate. Folded into e and f rather than built from three matrices.
  return {
    ...linear,
    e: transform.x + anchorX - (linear.a * anchorX + linear.c * anchorY),
    f: transform.y + anchorY - (linear.b * anchorX + linear.d * anchorY),
  };
}
