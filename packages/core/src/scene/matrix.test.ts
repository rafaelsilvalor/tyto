import { describe, expect, it } from 'vitest';

import {
  applyMatrix,
  identityMatrix,
  invertMatrix,
  multiplyMatrix,
  transformMatrix,
} from './matrix.js';
import { identityTransform } from './primitives.js';
import type { Matrix, Point } from './matrix.js';

/**
 * Rotation goes through `Math.cos`, so `cos(90°)` is 6.1e-17 and not 0, and `-sin(0)` is
 * `-0`. Nothing here rounds that away — an exporter formats numbers, the IR does not — so
 * the assertions compare component by component to six decimals instead.
 */
function expectPoint(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

function expectMatrix(actual: Matrix, expected: Matrix): void {
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
    expect(actual[key], `component ${key}`).toBeCloseTo(expected[key], 6);
  }
}

const box = { w: 100, h: 20 };

describe('multiplyMatrix', () => {
  it('applies the inner matrix first', () => {
    const scale = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const translate = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 5 };

    // Scaling a translation scales the translation too; translating a scale does not.
    expectPoint(applyMatrix(multiplyMatrix(scale, translate), { x: 1, y: 1 }), { x: 22, y: 12 });
    expectPoint(applyMatrix(multiplyMatrix(translate, scale), { x: 1, y: 1 }), { x: 12, y: 7 });
  });

  it('leaves a matrix alone on either side of the identity', () => {
    const matrix = { a: 2, b: 3, c: 4, d: 5, e: 6, f: 7 };

    expect(multiplyMatrix(identityMatrix, matrix)).toEqual(matrix);
    expect(multiplyMatrix(matrix, identityMatrix)).toEqual(matrix);
  });
});

describe('transformMatrix', () => {
  it('turns the default transform into the identity', () => {
    expectMatrix(transformMatrix(identityTransform, box), identityMatrix);
  });

  it('translates by x and y', () => {
    const matrix = transformMatrix({ ...identityTransform, x: 10, y: 20 }, box);
    expectPoint(applyMatrix(matrix, { x: 0, y: 0 }), { x: 10, y: 20 });
  });

  it('rotates clockwise, the direction a designer states degrees in', () => {
    const matrix = transformMatrix({ ...identityTransform, rotation: 90 }, box);
    // With y pointing down, a point to the right of the origin ends up below it.
    expectPoint(applyMatrix(matrix, { x: 10, y: 0 }), { x: 0, y: 10 });
  });

  it('rotates about the anchor, not about the node origin', () => {
    const centre = transformMatrix(
      { ...identityTransform, rotation: 180, anchor: { x: 0.5, y: 0.5 } },
      box,
    );

    // Half a turn about the middle of a 100×20 box swaps the two opposite corners.
    expectPoint(applyMatrix(centre, { x: 0, y: 0 }), { x: 100, y: 20 });
    expectPoint(applyMatrix(centre, { x: 100, y: 20 }), { x: 0, y: 0 });
    expectPoint(applyMatrix(centre, { x: 50, y: 10 }), { x: 50, y: 10 });
  });

  it('scales about the anchor as well', () => {
    const matrix = transformMatrix(
      { ...identityTransform, scaleX: 2, scaleY: 2, anchor: { x: 0.5, y: 0.5 } },
      box,
    );

    expectPoint(applyMatrix(matrix, { x: 50, y: 10 }), { x: 50, y: 10 });
    expectPoint(applyMatrix(matrix, { x: 0, y: 0 }), { x: -50, y: -10 });
  });

  it('scales along the node axes, not the frame axes, when the node is rotated', () => {
    const matrix = transformMatrix({ ...identityTransform, rotation: 90, scaleX: 3 }, box);

    // The node's own x axis points down after the rotation, so scaleX stretches downwards.
    expectPoint(applyMatrix(matrix, { x: 10, y: 0 }), { x: 0, y: 30 });
    expectPoint(applyMatrix(matrix, { x: 0, y: 10 }), { x: -10, y: 0 });
  });
});

describe('invertMatrix', () => {
  const box = { w: 100, h: 20 };
  const placed = transformMatrix(
    { ...identityTransform, x: 40, y: -12, rotation: 30, scaleX: 2, scaleY: 0.5 },
    box,
  );

  it('undoes a transform, whichever side it is applied from', () => {
    const inverse = invertMatrix(placed);
    expect(inverse).toBeDefined();
    if (inverse === undefined) return;

    expectMatrix(multiplyMatrix(placed, inverse), identityMatrix);
    expectMatrix(multiplyMatrix(inverse, placed), identityMatrix);
  });

  it('takes a point back where it came from', () => {
    const inverse = invertMatrix(placed);
    if (inverse === undefined) throw new Error('no inverse');

    expectPoint(applyMatrix(inverse, applyMatrix(placed, { x: 7, y: 3 })), { x: 7, y: 3 });
  });

  it('expresses one node in another’s coordinates, which is what a CSS mask needs', () => {
    const masked = transformMatrix({ ...identityTransform, x: 20, y: 130 }, box);
    const mask = transformMatrix({ ...identityTransform, x: 20, y: 130 }, box);
    const inverse = invertMatrix(masked);
    if (inverse === undefined) throw new Error('no inverse');

    // Two nodes at the same place: inside one, the other sits at the origin.
    expectMatrix(multiplyMatrix(inverse, mask), identityMatrix);
  });

  it('has no answer for a node scaled to nothing', () => {
    expect(invertMatrix(transformMatrix({ ...identityTransform, scaleX: 0 }, box))).toBeUndefined();
  });
});
