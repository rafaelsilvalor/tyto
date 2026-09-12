import { describe, expect, it } from 'vitest';

import type { Face, FaceCache } from './face.js';
import { MINIMUM_SHRINK, measureText } from './layout.js';
import type { TextNode, TextRun, TextSpan } from '../scene/nodes.js';

/**
 * The wrapping and shrinking, against a face whose widths are arithmetic.
 *
 * `core` is pure and opens no files (ADR 0010), so its own tests cannot load the bundled
 * `.ttf` — and should not want to. What is under test here is the algorithm: where a line
 * breaks, what letter spacing costs, when a shrink stops. Half an em per character makes
 * every expected number something a reader can verify in their head, which a real face
 * emphatically does not.
 *
 * The other half — that fontkit's widths are the widths Chromium uses — is measured in
 * `packages/raster/src/text-metrics.visual.test.ts`, where there is a browser to disagree
 * with. Neither test can stand in for the other: this one would pass against a font parser
 * that was wrong about every glyph, and that one cannot tell a wrapping bug from a metrics
 * bug.
 */

/** Every character is half an em wide, so a 10px run is 5px a character. */
const EVEN: Face = {
  advance: (text) => text.length * 0.5,
  contentHeight: 1.2,
};

const faces: FaceCache = {
  get: (face) => (face.family === 'Test' ? EVEN : undefined),
};

function span(text: string, overrides: Partial<TextSpan> = {}): TextSpan {
  return {
    kind: 'text',
    text,
    font: { family: 'Test', source: 'bundled' },
    size: 10,
    weight: 400,
    style: 'normal',
    color: { kind: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
    ...overrides,
  };
}

function node(runs: readonly TextRun[], overrides: Partial<TextNode> = {}): TextNode {
  return {
    kind: 'text',
    id: 'copy',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
    opacity: 1,
    blend: 'normal',
    visible: true,
    clip: false,
    effects: [],
    box: {},
    runs: [...runs],
    align: 'left',
    valign: 'top',
    lineHeight: 1.5,
    letterSpacing: 0,
    overflow: 'clip',
    ...overrides,
  };
}

/** The text of each line, which is what a break decision actually produces. */
function linesOf(runs: readonly TextRun[]): string[] {
  const lines: string[] = [''];
  for (const run of runs) {
    if (run.kind === 'break') lines.push('');
    else lines[lines.length - 1] += run.text;
  }
  return lines;
}

describe('where a line ends', () => {
  it('keeps one line when the box is wide enough', () => {
    const measured = measureText(node([span('ab cd')], { box: { w: 100 } }), faces);

    expect(measured?.lines).toBe(1);
    // 5 characters at 5px each, spaces included.
    expect(measured?.width).toBe(25);
  });

  it('breaks after the last word that fits', () => {
    // "one two three" is 13 characters, 65px. A 45px box fits "one two" (35px) and not
    // "one two three".
    const measured = measureText(node([span('one two three')], { box: { w: 45 } }), faces);

    expect(linesOf(measured?.runs ?? [])).toEqual(['one two', 'three']);
  });

  it('does not count the spaces that end a line', () => {
    // "aaa bbb" is 35px; at exactly 35px it fits, and the space before "bbb" is what would
    // push it over if trailing space counted.
    const measured = measureText(node([span('aaa bbb')], { box: { w: 35 } }), faces);

    expect(measured?.lines).toBe(1);
    expect(measured?.width).toBe(35);
  });

  it('leaves a word longer than its box alone rather than looping', () => {
    const measured = measureText(node([span('unbreakable')], { box: { w: 10 } }), faces);

    expect(measured?.lines).toBe(1);
    expect(linesOf(measured?.runs ?? [])).toEqual(['unbreakable']);
  });

  it('keeps the breaks the brief wrote, and adds to them', () => {
    const measured = measureText(
      node([span('one two'), { kind: 'break' }, span('three four')], { box: { w: 35 } }),
      faces,
    );

    // The author's break survives; each half then wraps on its own.
    expect(linesOf(measured?.runs ?? [])).toEqual(['one two', 'three', 'four']);
  });

  it('keeps an empty line, because an author asks for one', () => {
    const measured = measureText(
      node([span('a'), { kind: 'break' }, { kind: 'break' }, span('b')]),
      faces,
    );

    expect(linesOf(measured?.runs ?? [])).toEqual(['a', '', 'b']);
  });

  it('wraps across a run boundary without merging the runs', () => {
    const measured = measureText(
      node([span('bold '), span('and thin', { weight: 700 })], { box: { w: 45 } }),
      faces,
    );

    expect(linesOf(measured?.runs ?? [])).toEqual(['bold and', 'thin']);
    const weights = (measured?.runs ?? [])
      .filter((run): run is TextSpan => run.kind === 'text')
      .map((run) => run.weight);
    expect(weights).toEqual([400, 700, 700]);
  });
});

describe('letter spacing', () => {
  it('adds a step after every character, the last one included', () => {
    const measured = measureText(node([span('abc')], { letterSpacing: 2 }), faces);

    // 3 × 5px of glyph plus 3 × 2px of tracking.
    expect(measured?.width).toBe(21);
  });

  it('can be what pushes a line over', () => {
    const tight = measureText(node([span('aa bb')], { box: { w: 25 } }), faces);
    const tracked = measureText(node([span('aa bb')], { box: { w: 25 }, letterSpacing: 1 }), faces);

    expect(tight?.lines).toBe(1);
    expect(tracked?.lines).toBe(2);
  });
});

describe('height', () => {
  it('is the line count times the leading of the largest run', () => {
    const measured = measureText(
      node([span('a'), { kind: 'break' }, span('b', { size: 20 })], { lineHeight: 1.5 }),
      faces,
    );

    // Two lines at 1.5 × 20 — the node's leading comes from its biggest type, not from
    // each line's own, because that is what a block's strut is (docs/ir-schema.md).
    expect(measured?.height).toBe(60);
  });
});

describe('overflow', () => {
  it('reports how far past the box a clipped text runs', () => {
    // Three lines at 15px of leading is 45px in a 30px box.
    const measured = measureText(
      node([span('one two three')], { box: { w: 25, h: 30 }, overflow: 'clip' }),
      faces,
    );

    expect(measured?.lines).toBe(3);
    expect(measured?.overflow).toBe(15);
    expect(measured?.scale).toBe(1);
  });

  it('shrinks until it fits, and says it did', () => {
    const measured = measureText(
      node([span('one two three')], { box: { w: 25, h: 30 }, overflow: 'shrink' }),
      faces,
    );

    expect(measured?.overflow).toBe(0);
    expect(measured?.scale).toBeLessThan(1);
    // The runs come back at the size that fits, not at the size that was asked for.
    const sizes = (measured?.runs ?? [])
      .filter((run): run is TextSpan => run.kind === 'text')
      .map((run) => run.size);
    expect(Math.max(...sizes)).toBeLessThan(10);
  });

  it('stops at the floor and reports what is left rather than shrinking to nothing', () => {
    const measured = measureText(
      node([span('one two three four five six')], { box: { w: 25, h: 2 }, overflow: 'shrink' }),
      faces,
    );

    expect(measured?.scale).toBe(MINIMUM_SHRINK);
    expect(measured?.overflow).toBeGreaterThan(0);
  });

  it('leaves a growing text alone, since its box is whatever it needs', () => {
    const measured = measureText(
      node([span('one two three')], { box: { w: 25 }, overflow: 'grow' }),
      faces,
    );

    // No `box.h`, so there is nothing to overflow.
    expect(measured?.overflow).toBe(0);
    expect(measured?.scale).toBe(1);
  });
});

describe('a face nothing can measure', () => {
  it('gives up on the whole node rather than half-measuring it', () => {
    expect(
      measureText(node([span('a', { font: { family: 'Absent', source: 'bundled' } })]), faces),
    ).toBeUndefined();
  });

  it('gives up when only one run of several is missing', () => {
    const measured = measureText(
      node([span('here'), span('gone', { font: { family: 'Absent', source: 'bundled' } })]),
      faces,
    );

    expect(measured).toBeUndefined();
  });

  it('gives up on a node with no text at all', () => {
    expect(measureText(node([{ kind: 'break' }]), faces)).toBeUndefined();
  });
});
