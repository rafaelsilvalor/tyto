import { describe, expect, it } from 'vitest';

import { withBoxMetrics } from './box-metrics.js';
import type { Face, FaceCache } from './face.js';
import { originOf, rememberOrigin } from './origin.js';
import type { TextNode, TextSpan } from '../scene/nodes.js';
import { sourceRange } from '../source/range.js';

const MEASURED: Face = {
  advance: (text) => text.length * 0.5,
  contentHeight: 1.326,
  ascent: 1,
  descent: 0.326,
  capHeight: 0.66,
};
/** A face that reads but declares no cap height. */
const CAPLESS: Face = { advance: () => 0, contentHeight: 1.2, ascent: 1, descent: 0.2 };

const faces: FaceCache = {
  get: (face) =>
    face.family === 'Measured' ? MEASURED : face.family === 'Capless' ? CAPLESS : undefined,
};

const BOX = {
  paint: { kind: 'solid', color: { r: 200, g: 0, b: 0, a: 1 } },
  padding: { x: 17, over: 16, under: 15 },
} as const;

function span(family: string, boxed = true): TextSpan {
  return {
    kind: 'text',
    text: 'VAGAS',
    font: { family, source: 'bundled' },
    size: 60,
    weight: 700,
    style: 'normal',
    color: { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } },
    ...(boxed ? { box: BOX } : {}),
  };
}

function node(runs: TextSpan[]): TextNode {
  return {
    kind: 'text',
    id: 'sign-off',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
    opacity: 1,
    blend: 'normal',
    visible: true,
    clip: false,
    effects: [],
    box: {},
    runs,
    align: 'left',
    valign: 'top',
    lineHeight: 1.5,
    letterSpacing: 0,
    overflow: 'clip',
  };
}

const boxOf = (text: TextNode, index: number) => {
  const run = text.runs[index];
  return run?.kind === 'text' ? run.box : undefined;
};

describe("a boxed run's face metrics (ADR 0231)", () => {
  it("writes the face's ascent, descent and cap height into the box, in em", () => {
    expect(boxOf(withBoxMetrics(node([span('Measured')]), faces), 0)?.metrics).toEqual({
      ascent: 1,
      descent: 0.326,
      capHeight: 0.66,
    });
  });

  it('leaves the box without metrics when the face cannot be read or has no cap height', () => {
    expect(boxOf(withBoxMetrics(node([span('Unknown')]), faces), 0)).toEqual(BOX);
    expect(boxOf(withBoxMetrics(node([span('Capless')]), faces), 0)).toEqual(BOX);
  });

  it('returns a node with no box untouched, and keeps where a boxed run came from', () => {
    const plain = node([span('Measured', false)]);
    expect(withBoxMetrics(plain, faces)).toBe(plain);

    const boxed = span('Measured');
    rememberOrigin(boxed, sourceRange(3, 9));
    const [written] = withBoxMetrics(node([boxed]), faces).runs;
    expect(written === undefined ? undefined : originOf(written)).toEqual(sourceRange(3, 9));
  });
});
