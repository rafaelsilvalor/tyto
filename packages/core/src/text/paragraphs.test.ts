import { describe, expect, it } from 'vitest';

import type { Face, FaceCache } from './face.js';
import { measureText } from './layout.js';
import type { RichText } from '../brief/ast.js';
import { textRunSchema } from '../scene/nodes.js';
import type { TextNode, TextRun, TextSpan } from '../scene/nodes.js';
import { sourceRange } from '../source/range.js';
import { runsOf } from '../template/runs.js';

/**
 * A paragraph boundary from the brief to the measured runs (TYTO-557, ADR 0205).
 *
 * A blank line between two lines of a brief is a `Break` marked `paragraph`; the template says
 * how much room it takes (`paragraphSpacing`), and only a space above 0 reaches the Scene, as a
 * `LineBreak` with `space`. Layout adds that space to the height and keeps it through a wrap and
 * a shrink. The face is the arithmetic one `layout.test.ts` uses: half an em a character.
 */

const EVEN: Face = { advance: (text) => text.length * 0.5, contentHeight: 1.2 };
const faces: FaceCache = { get: (face) => (face.family === 'Test' ? EVEN : undefined) };

const at = sourceRange(0, 0);

/** `Um`, a paragraph boundary, `Dois`, as the parser gives it for `Um⏎⏎Dois`. */
const PARAGRAPHS: RichText = [
  { kind: 'text', value: 'Um', range: at },
  { kind: 'break', paragraph: true, range: at },
  { kind: 'text', value: 'Dois', range: at },
];

const style = { font: { family: 'Test', source: 'bundled' as const }, size: 10, color: '#000' };

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

function span(text: string): TextSpan {
  return runsOf([{ kind: 'text', value: text, range: at }], style)[0] as TextSpan;
}

describe('runsOf and a paragraph boundary', () => {
  it('writes the plain break it always wrote when the template gives no spacing', () => {
    expect(runsOf(PARAGRAPHS, style)[1]).toEqual({ kind: 'break' });
    expect(runsOf(PARAGRAPHS, style, { paragraphSpacing: 0 })[1]).toEqual({ kind: 'break' });
    expect(runsOf(PARAGRAPHS, style, { paragraphSpacing: -4 })[1]).toEqual({ kind: 'break' });
  });

  it('gives the boundary the template’s spacing, and an ordinary break none', () => {
    const text: RichText = [...PARAGRAPHS, { kind: 'break', range: at }, ...PARAGRAPHS];
    const breaks = runsOf(text, style, { paragraphSpacing: 24 }).filter(
      (run) => run.kind === 'break',
    );
    expect(breaks).toEqual([
      { kind: 'break', space: 24 },
      { kind: 'break' },
      { kind: 'break', space: 24 },
    ]);
  });
});

describe('the IR’s paragraph boundary', () => {
  it('takes a positive space and refuses 0, a negative and a non-finite one', () => {
    expect(textRunSchema.safeParse({ kind: 'break', space: 24 }).success).toBe(true);
    expect(textRunSchema.safeParse({ kind: 'break' }).success).toBe(true);
    for (const space of [0, -1, Number.POSITIVE_INFINITY]) {
      expect(textRunSchema.safeParse({ kind: 'break', space }).success, String(space)).toBe(false);
    }
  });
});

describe('measureText and a paragraph boundary', () => {
  const plain = node([span('Um'), { kind: 'break' }, span('Dois')]);
  const spaced = node([span('Um'), { kind: 'break', space: 24 }, span('Dois')]);

  it('adds the space to the height and nothing else', () => {
    const before = measureText(plain, faces);
    const after = measureText(spaced, faces);
    // Two lines at 1.5 × 10 px, then the paragraph's 24 px on top.
    expect(before?.height).toBe(30);
    expect(after?.height).toBe(54);
    expect(after?.lines).toBe(before?.lines);
    expect(after?.width).toBe(before?.width);
  });

  it('gives the space back on the break it came on, not on a wrap', () => {
    // 30 px wide is six characters at 5 px: `Um um um` wraps after the second word.
    const laid = measureText(
      node([span('Um um um'), { kind: 'break', space: 24 }, span('Dois')], { box: { w: 30 } }),
      faces,
    );
    expect(laid?.runs.filter((run) => run.kind === 'break')).toEqual([
      { kind: 'break' },
      { kind: 'break', space: 24 },
    ]);
    expect(laid?.height).toBe(3 * 15 + 24);
  });

  it('shrinks the space with the text', () => {
    // 54 px of text in a 27 px box: half the size fits, and half the space with it.
    const laid = measureText(node(spaced.runs, { box: { h: 27 }, overflow: 'shrink' }), faces);
    expect(laid?.scale).toBe(0.5);
    expect(laid?.height).toBe(27);
    expect(laid?.runs[1]).toEqual({ kind: 'break', space: 12 });
  });

  it('keeps the space of a boundary that opens the text', () => {
    const laid = measureText(node([{ kind: 'break', space: 24 }, span('Dois')]), faces);
    expect(laid?.height).toBe(2 * 15 + 24);
    expect(laid?.runs[0]).toEqual({ kind: 'break', space: 24 });
  });
});
