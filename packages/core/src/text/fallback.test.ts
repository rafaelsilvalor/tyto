import { describe, expect, it } from 'vitest';

import type { Face, FaceCache } from './face.js';
import { SYMBOL_FACE, coverRuns, fallbackChain } from './fallback.js';
import { measureText } from './layout.js';
import type { FontFace } from '../ports/font-source.js';
import type { TextNode, TextRun, TextSpan } from '../scene/nodes.js';

/**
 * The symbol chain (TYTO-484, ADR 0168), against faces whose coverage and widths are
 * arithmetic: the brand face draws ASCII at half an em, the symbol face draws the Greek and
 * math blocks at a full em, the text face draws Latin-1 and the super/subscripts at 0.6 em.
 * The real faces' coverage is measured in `@tyto/raster`'s text-metrics suite.
 */

function face(width: number, has: (codePoint: number) => boolean): Face {
  return { advance: (text) => [...text].length * width, contentHeight: 1.2, has };
}

const BRAND = face(0.5, (codePoint) => codePoint < 128);
// Greek, arrows and the math operators; like Noto Sans Math, no superscript digits and no `·`.
const SYMBOLS = face(
  1,
  (codePoint) =>
    (codePoint >= 0x370 && codePoint < 0x400) || (codePoint >= 0x2190 && codePoint < 0x2300),
);
const TEXT = face(
  0.6,
  (codePoint) => codePoint < 256 || (codePoint >= 0x2070 && codePoint < 0x20a0),
);

function cacheOf(entries: Record<string, Face>): FaceCache {
  return {
    get: (asked: FontFace) =>
      entries[`${asked.family}|${String(asked.weight)}|${asked.style}`] ??
      entries[asked.family === 'Brand' ? 'Brand' : ''],
  };
}

/** The host: every face of the chain is there. */
const HOST = cacheOf({
  Brand: BRAND,
  'Noto Sans Math|400|normal': SYMBOLS,
  'Source Sans 3|400|normal': TEXT,
  'Source Sans 3|700|normal': TEXT,
  'Source Sans 3|400|italic': TEXT,
});

function span(text: string, overrides: Partial<TextSpan> = {}): TextSpan {
  return {
    kind: 'text',
    text,
    font: { family: 'Brand', source: 'system' },
    size: 10,
    weight: 400,
    style: 'normal',
    color: { kind: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
    ...overrides,
  };
}

function node(runs: readonly TextRun[], box: TextNode['box'] = {}): Omit<TextNode, 'id'> {
  return {
    kind: 'text',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
    opacity: 1,
    blend: 'normal',
    visible: true,
    clip: false,
    effects: [],
    box,
    runs: [...runs],
    align: 'left',
    valign: 'top',
    lineHeight: 1.5,
    letterSpacing: 0,
    overflow: 'clip',
  };
}

function texts(runs: readonly TextRun[]): string[] {
  return runs.map((run) => (run.kind === 'text' ? `${run.font.family}:${run.text}` : '|'));
}

describe('the symbol chain', () => {
  it('splits a run where its face stops drawing, and names the face in the span', () => {
    const { runs, missing } = coverRuns([span('Δv = a·Δt')], HOST);

    expect(texts(runs)).toEqual([
      'Noto Sans Math:Δ',
      'Brand:v = a',
      'Source Sans 3:·',
      'Noto Sans Math:Δ',
      'Brand:t',
    ]);
    expect(missing).toEqual([]);
    const symbol = runs[0] as TextSpan;
    expect(symbol.font).toEqual({ family: 'Noto Sans Math', source: 'bundled' });
    expect({ weight: symbol.weight, style: symbol.style }).toEqual({
      weight: 400,
      style: 'normal',
    });
  });

  it('measures the split text at the widths the chain draws, not at the brand face', () => {
    // Δ is a full em in the symbol face; the brand face would have measured it at half.
    const measured = measureText(node([span('Δv')]), HOST);

    expect(measured?.width).toBe(10 + 5);
  });

  it('draws super and subscripts in Source Sans 3, at the nearest weight it ships', () => {
    expect(fallbackChain({ weight: 500, style: 'italic' })[1]).toEqual({
      family: 'Source Sans 3',
      weight: 400,
      style: 'italic',
    });
    expect(fallbackChain({ weight: 600, style: 'normal' })[1]?.weight).toBe(700);
    expect(fallbackChain({ weight: 900, style: 'normal' })[0]).toEqual(SYMBOL_FACE);

    const { runs } = coverRuns([span('x² + v₀', { weight: 700 })], HOST);
    expect(texts(runs)).toEqual(['Brand:x', 'Source Sans 3:²', 'Brand: + v', 'Source Sans 3:₀']);
    expect((runs[1] as TextSpan).weight).toBe(700);
  });

  it('keeps a character no face draws in the run, and reports it once', () => {
    const run = span('☃ and ☃');
    const { runs, missing } = coverRuns([run], HOST);

    expect(missing).toEqual(['☃']);
    // Nothing split, so the very same object: its origin and identity survive.
    expect(runs[0]).toBe(run);
    expect(measureText(node([run]), HOST)?.missing).toEqual(['☃']);
  });

  it('leaves a combining mark on the glyph it sits on', () => {
    const { runs } = coverRuns([span('x̂ = Δ̂')], HOST);

    expect(texts(runs)).toEqual(['Brand:x̂ = ', 'Noto Sans Math:Δ̂']);
  });

  it('falls back only to faces the cache answers: a guest that declared none splits nothing', () => {
    // A code template's plugin process measures only the faces its manifest lists under
    // `faces:` (ADR 0048); with the brand face alone, Δ stays in it and is reported.
    const guest = cacheOf({ Brand: BRAND });
    const { runs, missing } = coverRuns([span('Δv')], guest);

    expect(texts(runs)).toEqual(['Brand:Δv']);
    expect(missing).toEqual(['Δ']);
  });

  it('agrees with the host once the guest declares the chain', () => {
    const guest = cacheOf({
      Brand: BRAND,
      'Noto Sans Math|400|normal': SYMBOLS,
      'Source Sans 3|400|normal': TEXT,
    });
    const sample = node([span('∇·E = ρ/ε₀ and Δv = a·Δt')], { w: 80 });

    expect(measureText(sample, guest)).toEqual(measureText(sample, HOST));
  });
});

describe('a word the chain split', () => {
  it('still breaks only at a space', () => {
    // `aaΔbb` is three spans after the split. 5 + 5 + 10 + 5 + 5 = 30px; the box holds
    // `cc ` (15px) and not `cc aaΔbb` (45px), so the whole word moves down. Breaking at a
    // span boundary would have left `aa` behind and started the next line with `Δbb`.
    const measured = measureText(node([span('cc aaΔbb')], { w: 30 }), HOST);
    const lines: string[] = [''];
    for (const run of measured?.runs ?? []) {
      if (run.kind === 'break') lines.push('');
      else lines[lines.length - 1] += run.text;
    }

    expect(lines).toEqual(['cc', 'aaΔbb']);
  });
});
