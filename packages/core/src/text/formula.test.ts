import { describe, expect, it } from 'vitest';

import type { Face, FaceCache } from './face.js';
import { layoutFormula, linearReading } from './formula.js';
import { measureText } from './layout.js';
import type { FormulaRun, MathItem, TextNode, TextRun, TextSpan } from '../scene/nodes.js';
import { textRunSchema } from '../scene/nodes.js';
import { parseScene } from '../scene/scene.js';

/**
 * A formula laid out in core (TYTO-678, ADR 0206), against arithmetic faces.
 *
 * Half an em a character, an ascent of 0.8 and a descent of 0.2, and ink 0.7 em tall sitting
 * on the baseline, like a digit. At 10px every number below is one a reader can redo by hand:
 * the axis at 2.5, a rule 0.6 thick from 2.8 to 2.2 above the baseline, 1.2 of clearance on
 * either side of it and 1 of overhang.
 */
const EVEN: Face = {
  advance: (text) => [...text].length * 0.5,
  contentHeight: 1,
  ascent: 0.8,
  descent: 0.2,
  ink: (text) => (text.trim() === '' ? undefined : { ascent: 0.7, descent: 0 }),
  has: () => true,
};
const faces: FaceCache = { get: (face) => (face.family === 'Test' ? EVEN : undefined) };

const FONT = { family: 'Test', source: 'bundled' as const };
const BLACK = { kind: 'solid' as const, color: { r: 0, g: 0, b: 0, a: 1 } };

function span(text: string): TextSpan {
  return { kind: 'text', text, font: FONT, size: 10, weight: 400, style: 'normal', color: BLACK };
}

function formula(math: readonly MathItem[]): FormulaRun {
  return {
    kind: 'formula',
    text: linearReading(math),
    math: [...math],
    font: FONT,
    size: 10,
    weight: 400,
    style: 'normal',
    color: BLACK,
  };
}

const text = (value: string): MathItem => ({ kind: 'text', text: value });
const ONE_OVER_FORTY: MathItem = {
  kind: 'fraction',
  numerator: [text('1')],
  denominator: [text('40')],
};

function node(runs: readonly TextRun[], overrides: Partial<TextNode> = {}): TextNode {
  return {
    kind: 'text',
    id: 'answer',
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

function formulasOf(runs: readonly TextRun[]): FormulaRun[] {
  return runs.filter((run): run is FormulaRun => run.kind === 'formula');
}

describe('layoutFormula', () => {
  it('stacks a fraction centred on a rule at the math axis, with fixed clearances', () => {
    const laid = layoutFormula(formula([ONE_OVER_FORTY]), faces);

    expect(laid).toEqual({
      width: 12,
      ascent: 11,
      descent: 6,
      glyphs: [
        { text: '1', font: FONT, size: 10, weight: 400, style: 'normal', x: 3.5, y: -4 },
        { text: '40', font: FONT, size: 10, weight: 400, style: 'normal', x: 1, y: 6 },
      ],
      rules: [{ x: 0, y: -2.8, width: 12, thickness: 0.6 }],
      missing: [],
    });
  });

  it('sets a superscript smaller and raised, a subscript smaller and lowered', () => {
    const raised = layoutFormula(
      formula([text('10'), { kind: 'scripts', superscript: [text('3')] }]),
      faces,
    );
    expect(raised?.glyphs.map(({ text: t, size, x, y }) => ({ t, size, x, y }))).toEqual([
      { t: '10', size: 10, x: 0, y: 0 },
      { t: '3', size: 7, x: 10, y: -4 },
    ]);
    expect(raised?.width).toBe(13.5);

    const both = layoutFormula(
      formula([text('x'), { kind: 'scripts', superscript: [text('2')], subscript: [text('i')] }]),
      faces,
    );
    expect(both?.glyphs.map(({ y }) => y)).toEqual([0, -4.5, 2.5]);
  });

  it('places text word by word and draws no space, so no exporter can drop one (TYTO-734)', () => {
    // `F = ` before a fraction and ` = 25 Hz` after it, as a brief writes them inside `$…$`.
    const laid = layoutFormula(formula([text('F = '), ONE_OVER_FORTY, text(' = 25  Hz')]), faces);

    expect(laid?.glyphs.map(({ text: t, x, y }) => ({ t, x, y }))).toEqual([
      { t: 'F', x: 0, y: 0 },
      { t: '=', x: 10, y: 0 },
      { t: '1', x: 23.5, y: -4 },
      { t: '40', x: 21, y: 6 },
      // The fraction ends at 32; its leading space moves ` = ` on by half an em.
      { t: '=', x: 37, y: 0 },
      { t: '25', x: 47, y: 0 },
      // Two spaces written are two spaces of room.
      { t: 'Hz', x: 67, y: 0 },
    ]);
    expect(laid?.width).toBe(77);
  });

  it('is undefined when the formula face is not available', () => {
    expect(
      layoutFormula(
        { ...formula([text('x')]), font: { family: 'Nope', source: 'bundled' } },
        faces,
      ),
    ).toBe(undefined);
  });
});

describe('a formula in a line', () => {
  it('makes its line taller by how far its box reaches past the strut', () => {
    // Leading 15 over a face 8 up and 2 down: half of the 5 px of leading, truncated, goes
    // above, so the strut is 10 above the baseline and 5 below. The fraction reaches 11 above
    // and 6 below, so the line grows by 1 and 1.
    const measured = measureText(
      node([span('F = '), formula([ONE_OVER_FORTY]), span(' = 25')]),
      faces,
    );

    expect(measured?.height).toBe(17);
    expect(formulasOf(measured?.runs ?? [])[0]?.layout).toMatchObject({
      offset: 20,
      lineWidth: 57,
      above: 1,
      below: 1,
    });
  });

  it('never breaks inside, and grows only the line that holds it', () => {
    const measured = measureText(
      node([span('aa ('), formula([ONE_OVER_FORTY]), span(') bb')], { box: { w: 32 } }),
      faces,
    );

    expect(measured?.lines).toBe(3);
    expect(measured?.runs.map((run) => run.kind)).toEqual([
      'text',
      'break',
      'text',
      'formula',
      'text',
      'break',
      'text',
    ]);
    expect(measured?.height).toBe(3 * 15 + 2);
    expect(formulasOf(measured?.runs ?? [])[0]?.layout).toMatchObject({ offset: 5, lineWidth: 22 });
  });

  it('measures a node that holds only a formula, with the formula as its strut', () => {
    const measured = measureText(node([formula([ONE_OVER_FORTY])]), faces);
    expect(measured?.height).toBe(17);
    expect(measured?.width).toBe(12);
  });

  it('scales with a shrink, and the scaled layout is the one in the IR', () => {
    const measured = measureText(
      node([formula([ONE_OVER_FORTY])], { box: { h: 13 }, overflow: 'shrink' }),
      faces,
    );
    const run = formulasOf(measured?.runs ?? [])[0];
    expect(measured?.scale).toBeLessThan(1);
    expect(run?.size).toBe(Math.round(10 * (measured?.scale ?? 1) * 1000) / 1000);
    expect(run?.layout?.width).toBeLessThan(12);
    expect(measured?.height).toBeLessThanOrEqual(13);
  });

  it('writes a layout the IR schema accepts', () => {
    const measured = measureText(node([formula([ONE_OVER_FORTY])]), faces);
    for (const run of measured?.runs ?? []) expect(textRunSchema.safeParse(run).success).toBe(true);
  });
});

describe('linearReading', () => {
  it('reads a formula as one line, a part longer than one character in parentheses', () => {
    expect(
      linearReading([
        text('F = '),
        {
          kind: 'fraction',
          numerator: [text('1')],
          denominator: [text('40·10'), { kind: 'scripts', superscript: [text('−3')] }],
        },
        text(' = 25 Hz'),
      ]),
    ).toBe('F = 1/(40·10^(−3)) = 25 Hz');
  });
});

describe('a formula in the Scene', () => {
  const scene = (runs: readonly TextRun[], fonts = [FONT]): unknown => ({
    version: 1,
    fonts,
    assets: [],
    artworks: [
      {
        id: 'a',
        frames: [{ format: 'feed', size: { w: 100, h: 100 }, children: [node(runs)] }],
      },
    ],
  });

  it('is not an empty text, and every face its pieces name must be declared', () => {
    const laid = formulasOf(measureText(node([formula([ONE_OVER_FORTY])]), faces)?.runs ?? [])[0];
    if (laid?.layout === undefined) throw new Error('expected a laid-out formula');
    expect(parseScene(scene([laid])).ok).toBe(true);

    const symbol = { family: 'Symbol', source: 'bundled' as const };
    const glyphs = laid.layout.glyphs.map((glyph) => ({ ...glyph, font: symbol }));
    const result = parseScene(scene([{ ...laid, layout: { ...laid.layout, glyphs } }]));
    expect(result.ok ? [] : result.error.map((problem) => problem.code)).toEqual([
      'E_SCENE_FONT_NOT_DECLARED',
    ]);
  });

  it('refuses scripts with neither a superscript nor a subscript', () => {
    expect(textRunSchema.safeParse(formula([{ kind: 'scripts' }])).success).toBe(false);
  });
});
