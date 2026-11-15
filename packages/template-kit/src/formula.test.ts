import { type Face, type FaceCache, type FormulaRun, type TextRun, measureText } from '@tyto/core';
import { lineBreak, run, text } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { orphanOf, rebreak, spaceByWeight } from './rhythm.js';

/**
 * A line holding a stacked fraction is taller (TYTO-678, ADR 0206), and the kit's rhythm reads
 * the height `measure` gives, so it spaces that block by its real height with no rule of its
 * own. The face is arithmetic, as in core's formula tests: half an em a character, 0.8 up and
 * 0.2 down, ink 0.7 em tall on the baseline. At 10 px with a 1.5 line the strut is 10 above the
 * baseline and 5 below, and `1/40` reaches 11 above and 6 below: the line is 17, not 15.
 */
const EVEN: Face = {
  advance: (characters) => [...characters].length * 0.5,
  contentHeight: 1,
  ascent: 0.8,
  descent: 0.2,
  ink: (characters) => (characters.trim() === '' ? undefined : { ascent: 0.7, descent: 0 }),
  has: () => true,
};
const faces: FaceCache = { get: (face) => (face.family === 'Test' ? EVEN : undefined) };

const FONT = { family: 'Test', source: 'bundled' } as const;
const STYLE = { font: FONT, size: 10, color: '#000000' } as const;

const fraction: FormulaRun = {
  kind: 'formula',
  text: '1/40',
  math: [
    {
      kind: 'fraction',
      numerator: [{ kind: 'text', text: '1' }],
      denominator: [{ kind: 'text', text: '40' }],
    },
  ],
  font: FONT,
  size: 10,
  weight: 400,
  style: 'normal',
  color: { kind: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
};

const heightOf = (first: TextRun, ...rest: TextRun[]): number =>
  measureText(text({ runs: [first, ...rest], lineHeight: 1.5 }), faces)?.height ?? 0;

describe('the rhythm around a formula', () => {
  it('spaces a block holding a fraction by its taller line', () => {
    const heights = [heightOf(run('Answer', STYLE)), heightOf(run('F = ', STYLE), fraction)];
    expect(heights).toEqual([15, 17]);

    const spaced = spaceByWeight({ top: 0, bottom: 100, heights, weights: [1, 1, 1] });
    // 68 px of room in three equal gaps, the last one under a block 17 tall.
    expect(spaced.unit).toBeCloseTo(68 / 3, 9);
    expect((spaced.tops[1] ?? 0) + 17 + spaced.unit).toBeCloseTo(100, 9);
  });

  it('never splits a formula when it breaks a paragraph earlier', () => {
    const written = [run('one ', STYLE), fraction, run(' end', STYLE)];
    const laid = [run('one ', STYLE), fraction, lineBreak(), run('end', STYLE)];

    expect(orphanOf(written, laid)).toBe('end');
    const rebroken = rebreak(written, laid) ?? [];
    expect(rebroken.map((item) => (item.kind === 'text' ? item.text : item.kind))).toEqual([
      'one',
      'break',
      'formula',
      ' end',
    ]);
  });
});
