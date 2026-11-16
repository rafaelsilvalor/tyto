import type { FormulaRun, Scene, TextNode, TextRun } from '@tyto/core';
import { exportHtml } from '@tyto/export-html';
import { exportSvg } from '@tyto/export-svg';
import { bundledFont } from '@tyto/fonts';
import { describe, expect, it } from 'vitest';

import { compileFormulaBrief, readFormulaBrief } from './__fixtures__/formula-brief.js';

/**
 * A formula written in a brief, end to end (TYTO-734, ADR 0206): the reference brief through
 * `parseBrief` → `resolve` → `compile` → both exporters. The pixels are the visual suite's
 * (`raster.visual.test.ts`); this checks what each stage hands the next.
 */

function answerOf(scene: Scene): TextNode {
  const node = scene.artworks[0]?.frames[0]?.children.find(
    (child): child is TextNode => child.kind === 'text',
  );
  if (node === undefined) throw new Error('The reference brief drew no text.');
  return node;
}

function formulasOf(runs: readonly TextRun[]): FormulaRun[] {
  return runs.filter((run): run is FormulaRun => run.kind === 'formula');
}

async function sceneOf(brief: string): Promise<{ scene: Scene; codes: string[] }> {
  const compiled = await compileFormulaBrief(brief);
  if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
  return { scene: compiled.value, codes: compiled.diagnostics.map((item) => item.code) };
}

const REFERENCE = readFormulaBrief();

describe('the reference brief', () => {
  it('compiles to a laid-out stacked fraction, with nothing reported against a formula', async () => {
    const { scene, codes } = await sceneOf(REFERENCE);
    // Filtered by code: the bundled face draws every character here, and the whole list is
    // not this test's to pin (AGENTS.md › Tests).
    expect(codes.filter((code) => code.startsWith('E_'))).toEqual([]);

    const [reference, energy, velocity] = formulasOf(answerOf(scene).runs);
    expect(reference?.text).toBe('F = 1/(40·10^(-3)) = 25 Hz');
    expect(reference?.math[1]?.kind).toBe('fraction');
    expect(reference?.layout?.rules).toHaveLength(1);
    // The numerator sits above the rule and the denominator below it: stacked, not inline.
    const rule = reference?.layout?.rules[0];
    const one = reference?.layout?.glyphs.find((glyph) => glyph.text === '1');
    const forty = reference?.layout?.glyphs.find((glyph) => glyph.text.startsWith('40'));
    expect(one?.y).toBeLessThan(rule?.y ?? Number.NEGATIVE_INFINITY);
    expect(forty?.y).toBeGreaterThan(rule?.y ?? Number.POSITIVE_INFINITY);

    expect(energy?.text).toBe('E = mc^2');
    expect(velocity?.text).toBe('v_0^2');
  });

  it('keeps money as text: R$ 50 and R$ 60 open no formula', async () => {
    const { scene } = await sceneOf(REFERENCE);
    const spans = answerOf(scene)
      .runs.filter((run) => run.kind === 'text')
      .map((run) => run.text);
    expect(spans).toContain('de R$ 50 a R$ 60, ');
  });

  it('draws the fraction in HTML and in SVG: a rule and the pieces at the IR’s places', async () => {
    const { scene } = await sceneOf(REFERENCE);
    const [reference] = formulasOf(answerOf(scene).runs);
    const rule = reference?.layout?.rules[0];
    if (rule === undefined) throw new Error('The reference formula has no rule.');

    const html = exportHtml(scene, { resources: { font: bundledFont } });
    const svg = exportSvg(scene, { resources: { font: bundledFont } });
    if (!html.ok || !svg.ok) throw new Error('An exporter refused the reference scene.');
    const [htmlFrame] = html.value;
    const [svgFrame] = svg.value;

    // The same rule in both: the width core measured, the thickness of ADR 0206 decision 10.
    const width = String(rule.width);
    for (const markup of [htmlFrame?.html ?? '', svgFrame?.svg ?? '']) {
      expect(markup).toMatch(new RegExp(`<rect[^>]*width="${width.replace('.', '\\.')}"`, 'u'));
      expect(markup).toContain('>1</text>');
      expect(markup).toContain('>40·10</text>');
      // The source never reaches the output: an exporter draws the placed pieces.
      expect(markup).not.toContain('\\frac');
    }
  });
});

describe('an error inside a formula', () => {
  const BROKEN = REFERENCE.replace('\\frac', '\\sqrt');

  it('points at the characters at fault, and the formula is drawn as its source', async () => {
    const compiled = await compileFormulaBrief(BROKEN);
    if (!compiled.ok) throw new Error('A formula error must not cost the artwork.');
    const errors = compiled.diagnostics.filter((item) => item.code === 'E_FORMULA_COMMAND');
    expect(errors).toHaveLength(1);
    const range = errors[0]?.range;
    expect(range === undefined ? '' : BROKEN.slice(range.start, range.end)).toBe('\\sqrt');

    const spans = answerOf(compiled.value)
      .runs.filter((run) => run.kind === 'text')
      .map((run) => run.text)
      .join('');
    // As text it is wider than the box and wraps, and the space it wraps at is not drawn.
    expect(spans.replaceAll(' ', '')).toContain('$F=\\sqrt{1}{40·10^{-3}}=25\\Hz$');
  });
});
