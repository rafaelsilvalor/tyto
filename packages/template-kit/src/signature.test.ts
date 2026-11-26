import { lineBreak, run, solid, text, vector } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { at, sealed } from './index.js';
import { parameterValues } from './parameters.js';
import { arrowShape } from './shapes.js';
import {
  CAROUSEL_FOOTER_PARAMETERS,
  SIGNATURE_LINE_PARAMETERS,
  carouselFooter,
  signatureLine,
} from './signature.js';

import type { AssetRef, TextRun } from '@tyto/core';
import type { GroupDraft, NodeDraft, TextDraft } from '@tyto/core/template';

/*
 * The oracles: the signature as four template repositories draw it on their origin/main,
 * code copied verbatim. Each repository's helpers keep their bodies and take its name as a
 * prefix (`ecTextAt`, `questaoTextAt`…), and `signatureOf(context.brand)` is the neutral `SIGN`.
 * They share one face, one metrics table and one `Placed` shape, which are the same in each.
 */

const SIGN = '@conta.exemplo';
const SLIDE_WIDTH = 1080;
const FACE = { family: 'CircularXX', source: 'system' } as const;
const LIGHT = 300;
const REGULAR = 400;
const ASCENT = 0.75;
const DESCENT = 0.25;
const CAP_HEIGHT = 0.709;

function capOffset(size: number, lineHeight: number): number {
  return size * ((lineHeight - (ASCENT + DESCENT)) / 2 + (ASCENT - CAP_HEIGHT));
}

interface Box {
  readonly x: number;
  readonly capTop: number;
  readonly lineHeight?: number;
  readonly width?: number;
  readonly align?: 'left' | 'center';
  readonly letterSpacing?: number;
}

interface Placed extends Box {
  readonly size: number;
  readonly weight: number;
  readonly color: string;
}

/* concursos-abertos-ec (5cd97b1): the signature in `build` :244, `textAt` :877, `arrow`. */

const EC_SIGNATURE = { size: 24, capTop: 1271, letterSpacing: 9.6 } as const;
const EC_ARROW = { x: 798, y: 1269, w: 186, h: 26, shaft: { top: 9, h: 8 }, head: 15 } as const;

function ecSignature(color: string, lift: number): TextDraft {
  return ecTextAt('assinatura', SIGN, {
    x: 0,
    capTop: EC_SIGNATURE.capTop - lift,
    size: EC_SIGNATURE.size,
    weight: LIGHT,
    color,
    width: SLIDE_WIDTH,
    align: 'center',
    letterSpacing: EC_SIGNATURE.letterSpacing,
  });
}

function ecArrow(color: string): NodeDraft {
  const { w, h, shaft, head } = EC_ARROW;
  const neck = w - head;
  const d = `M0 ${shaft.top}H${neck}V0L${w} ${h / 2}L${neck} ${h}V${shaft.top + shaft.h}H0Z`;
  return vector({
    name: 'seta',
    geometry: { kind: 'path', d, fillRule: 'nonzero' },
    size: { w, h },
    fill: solid(color),
    transform: { x: EC_ARROW.x, y: EC_ARROW.y },
  });
}

function ecTextAt(name: string, words: string, placed: Placed): TextDraft {
  const style = { font: FACE, size: placed.size, weight: placed.weight, color: placed.color };
  const [first = '', ...others] = words.split('\n');
  return ecTextRuns(
    name,
    [run(first, style), ...others.flatMap((line) => [lineBreak(), run(line, style)])],
    placed,
  );
}

function ecTextRuns(
  name: string,
  runs: readonly TextRun[],
  placed: Box & { readonly size: number },
): TextDraft {
  const lineHeight = placed.lineHeight ?? 1;
  const [head, ...tail] = runs;
  const empty = run('', { font: FACE, size: placed.size, weight: LIGHT, color: '#000000' });
  return text({
    name,
    runs: [head ?? empty, ...tail],
    ...(placed.width === undefined ? {} : { box: { w: placed.width } }),
    align: placed.align ?? 'left',
    lineHeight,
    letterSpacing: placed.letterSpacing ?? 0,
    overflow: 'grow',
    transform: { x: placed.x, y: placed.capTop - capOffset(placed.size, lineHeight) },
  });
}

/* questao-estrategica (38ae3a5): the cover's signature :386, `textAt` :1700, `textRuns`. */

function questaoCoverSignature(color: string, lift: number): TextDraft {
  return questaoTextAt('assinatura', SIGN, {
    x: 0,
    capTop: 1277 - lift,
    size: 14.58,
    weight: REGULAR,
    color,
    width: SLIDE_WIDTH,
    align: 'center',
    letterSpacing: 6.42,
  });
}

function questaoTextAt(name: string, words: string, placed: Placed): TextDraft {
  const style = { font: FACE, size: placed.size, weight: placed.weight, color: placed.color };
  const [first = '', ...others] = words.split('\n');
  return questaoTextRuns(
    name,
    [run(first, style), ...others.flatMap((line) => [lineBreak(), run(line, style)])],
    placed,
  );
}

function questaoTextRuns(
  name: string,
  runs: readonly TextRun[],
  placed: Box & { readonly size: number },
): TextDraft {
  const lineHeight = placed.lineHeight ?? 1;
  const [head, ...tail] = runs;
  const empty = run('', { font: FACE, size: placed.size, weight: REGULAR, color: '#000000' });
  return text({
    name,
    runs: [head ?? empty, ...tail],
    ...(placed.width === undefined ? {} : { box: { w: placed.width } }),
    align: placed.align ?? 'left',
    lineHeight,
    letterSpacing: placed.letterSpacing ?? 0,
    transform: { x: placed.x, y: placed.capTop - capOffset(placed.size, lineHeight) },
  });
}

/*
 * voce-conhece (1e1fabb) `footSignature` :1058, the same body as questao-engenharia's :424
 * (compared by diff), with its `textAt` and `textRuns`.
 */

const VOCE_SIGNATURE = { size: 25.66, letterSpacing: 25.66 * 0.2 } as const;
const BODY_SIGNATURE_TOP = 1262.5;

function voceFootSignature(capTop: number, color: string): TextDraft {
  return voceTextAt('assinatura', SIGN, {
    x: 0,
    capTop,
    size: VOCE_SIGNATURE.size,
    weight: LIGHT,
    color,
    width: SLIDE_WIDTH,
    align: 'center',
    letterSpacing: VOCE_SIGNATURE.letterSpacing,
  });
}

function voceTextAt(name: string, words: string, placed: Placed): TextDraft {
  const style = { font: FACE, size: placed.size, weight: placed.weight, color: placed.color };
  const [first = '', ...others] = words.split('\n');
  return voceTextRuns(
    name,
    [run(first, style), ...others.flatMap((line) => [lineBreak(), run(line, style)])],
    placed,
  );
}

function voceTextRuns(
  name: string,
  runs: readonly TextRun[],
  placed: Box & { readonly size: number },
): TextDraft {
  const lineHeight = placed.lineHeight ?? 1;
  const [head, ...tail] = runs;
  const empty = run('', { font: FACE, size: placed.size, weight: LIGHT, color: '#000000' });
  return text({
    name,
    runs: [head ?? empty, ...tail],
    ...(placed.width === undefined ? {} : { box: { w: placed.width } }),
    align: placed.align ?? 'left',
    lineHeight,
    letterSpacing: placed.letterSpacing ?? 0,
    transform: { x: placed.x, y: placed.capTop - capOffset(placed.size, lineHeight) },
  });
}

/* concursos-abertos (b56819c): `signature` :846 by its baseline, `textAt` :875. */

const ABERTOS_SIGNATURE = { size: 24.4, letterSpacing: 4.9, baseline: 1232.8, centre: 539.55 };

function abertosSignature(color: string, baseline: number): NodeDraft {
  return abertosTextAt('assinatura', SIGN, {
    x: 0,
    capTop: baseline - CAP_HEIGHT * ABERTOS_SIGNATURE.size,
    size: ABERTOS_SIGNATURE.size,
    weight: LIGHT,
    color,
    width: 2 * ABERTOS_SIGNATURE.centre,
    align: 'center',
    letterSpacing: ABERTOS_SIGNATURE.letterSpacing,
  });
}

function abertosTextAt(name: string, words: string, placed: Placed): NodeDraft {
  const lineHeight = placed.lineHeight ?? 1;
  const style = { font: FACE, size: placed.size, weight: placed.weight, color: placed.color };
  const [first = '', ...others] = words.split('\n');
  return text({
    name,
    runs: [run(first, style), ...others.flatMap((line) => [lineBreak(), run(line, style)])],
    ...(placed.width === undefined ? {} : { box: { w: placed.width } }),
    align: placed.align ?? 'left',
    lineHeight,
    letterSpacing: placed.letterSpacing ?? 0,
    overflow: 'grow',
    transform: { x: placed.x, y: placed.capTop - capOffset(placed.size, lineHeight) },
  });
}

/* ------------------------------------------------------------------------- helpers -- */

const INK = '#1a2b3c';
const SEAL: AssetRef = { id: 'selo', source: 'file', path: './selo.png', hash: 'sha256-0' };

/** A node with its transform's position rounded off: the oracle and the kit add in other orders. */
function expectSameNode(kit: NodeDraft, oracle: NodeDraft): void {
  const { transform: kitAt, ...kitRest } = kit;
  const { transform: oracleAt, ...oracleRest } = oracle;
  expect(kitRest).toEqual(oracleRest);
  expect({ ...kitAt, x: 0, y: 0 }).toEqual({ ...oracleAt, x: 0, y: 0 });
  expect(Math.abs(kitAt.x - oracleAt.x)).toBeLessThan(1e-9);
  expect(Math.abs(kitAt.y - oracleAt.y)).toBeLessThan(1e-9);
}

/** The footer's children where `at(0, 0, …)` puts them. */
function footerChildren(draft: NodeDraft): readonly NodeDraft[] {
  return (at(0, 0, { width: 0, height: 0, draft }) as GroupDraft).children;
}

/* --------------------------------------------------------------------------- tests -- */

describe('the signature line', () => {
  it('draws concursos-abertos-ec’s signature, grown, by its capitals', () => {
    for (const lift of [0, 120]) {
      const line = signatureLine(
        SIGN,
        { width: SLIDE_WIDTH, height: Infinity },
        { font: FACE, weight: LIGHT, color: INK },
        { size: 24, letterSpacing: 9.6 },
        { name: 'assinatura', text: { overflow: 'grow' } },
      );
      const placed = at(0, EC_SIGNATURE.capTop - lift - line.anchor!.capTop, line);
      expectSameNode(placed, ecSignature(INK, lift));
    }
  });

  it('draws questao-estrategica’s cover signature, Regular 14.58', () => {
    const line = signatureLine(
      SIGN,
      { width: SLIDE_WIDTH, height: Infinity },
      { font: FACE, weight: REGULAR, color: INK },
      { size: 14.58, letterSpacing: 6.42 },
      { name: 'assinatura' },
    );
    expectSameNode(at(0, 1277 - line.anchor!.capTop, line), questaoCoverSignature(INK, 0));
  });

  it('draws voce-conhece’s and questao-engenharia’s foot signature, tracked 0.2 em', () => {
    const line = signatureLine(
      SIGN,
      { width: SLIDE_WIDTH, height: Infinity },
      { font: FACE, weight: LIGHT, color: INK },
      { size: 25.66, letterSpacing: 25.66 * 0.2 },
      { name: 'assinatura' },
    );
    expectSameNode(
      at(0, BODY_SIGNATURE_TOP - line.anchor!.capTop, line),
      voceFootSignature(BODY_SIGNATURE_TOP, INK),
    );
  });

  it('draws concursos-abertos’ signature by its baseline, in a 1079.1 px line', () => {
    const line = signatureLine(
      SIGN,
      { width: 2 * ABERTOS_SIGNATURE.centre, height: Infinity },
      { font: FACE, weight: LIGHT, color: INK },
      { size: 24.4, letterSpacing: 4.9 },
      { name: 'assinatura', text: { overflow: 'grow' } },
    );
    const baseline = ABERTOS_SIGNATURE.baseline;
    expectSameNode(at(0, baseline - line.anchor!.baseline, line), abertosSignature(INK, baseline));
  });

  it('is one line tall, its anchor at its capitals and its baseline', () => {
    const line = signatureLine(
      SIGN,
      { width: 400, height: Infinity },
      { font: FACE, weight: LIGHT, color: INK },
      { size: 20, lineHeight: 1.2 },
    );
    expect(line.height).toBe(24);
    expect(line.anchor!.capTop).toBeCloseTo(capOffset(20, 1.2), 12);
    expect(line.anchor!.baseline).toBeCloseTo(capOffset(20, 1.2) + 20 * CAP_HEIGHT, 12);
    expect(line.draft.name).toBe('signature');
  });

  it('takes neutral defaults', () => {
    expect(parameterValues(SIGNATURE_LINE_PARAMETERS)).toEqual({
      size: 24,
      letterSpacing: 0,
      lineHeight: 1,
      align: 'center',
    });
  });
});

describe('the carousel footer', () => {
  /** ec's footer by parameters: its signature 79 px over the foot, its arrow 55 over and 96 in. */
  const EC_FOOTER = { signatureFromFoot: 79, trailingFromFoot: 55, trailingInset: 96 };

  function ecFooter(page: { readonly w: number; readonly h: number }, next: boolean) {
    const signature = signatureLine(
      SIGN,
      { width: SLIDE_WIDTH, height: Infinity },
      { font: FACE, weight: LIGHT, color: INK },
      { size: 24, letterSpacing: 9.6 },
      { name: 'assinatura', text: { overflow: 'grow' } },
    );
    const arrow = arrowShape(
      { w: 186, h: 26 },
      solid(INK),
      { shaft: 8, headRatio: 0.58 },
      { name: 'seta' },
    );
    return carouselFooter(
      { width: page.w, height: page.h },
      { signature, ...(next ? { trailing: arrow } : {}) },
      EC_FOOTER,
    );
  }

  it('draws concursos-abertos-ec’s signature and arrow where its slide does', () => {
    const footer = ecFooter({ w: 1080, h: 1350 }, true);
    const [signature, arrow] = footerChildren(footer.draft);
    expectSameNode(signature!, ecSignature(INK, 0));
    expect(arrow).toEqual(ecArrow(INK));
  });

  it('is a layer as large as the page it is given', () => {
    const footer = ecFooter({ w: 1080, h: 1350 }, false);
    expect([footer.width, footer.height]).toEqual([1080, 1350]);
    expect(footerChildren(footer.draft)).toHaveLength(1);
  });

  it('rises by exactly the seal’s height on the page `sealed` returns', () => {
    const bare = sealed({ w: 1080, h: 1350 }, undefined);
    const withSeal = sealed({ w: 1080, h: 1350 }, { asset: SEAL, height: 100 });
    const low = footerChildren(ecFooter(bare.size, true).draft);
    const high = footerChildren(ecFooter(withSeal.size, true).draft);
    expect(high).toHaveLength(2);
    for (const [index, node] of high.entries()) {
      expect(Math.abs(low[index]!.transform.y - 100 - node.transform.y)).toBeLessThan(1e-9);
      expect(node.transform.x).toBe(low[index]!.transform.x);
    }
    // ec's own signature on its sealed slide is the kit's, within float rounding.
    expectSameNode(high[0]!, ecSignature(INK, 100));
  });

  it('stands a leading piece on the foot at the left', () => {
    const signature = signatureLine(
      SIGN,
      { width: 1080, height: Infinity },
      { font: FACE, weight: LIGHT, color: INK },
    );
    const number = arrowShape({ w: 40, h: 20 }, solid(INK));
    const footer = carouselFooter({ width: 1080, height: 1350 }, { signature, leading: number });
    const [leading] = footerChildren(footer.draft);
    expect(leading!.transform).toMatchObject({ x: 64, y: 1350 - 48 - 20 });
  });

  it('takes neutral defaults', () => {
    expect(parameterValues(CAROUSEL_FOOTER_PARAMETERS)).toEqual({
      signatureFromFoot: 72,
      leadingFromFoot: 48,
      leadingInset: 64,
      trailingFromFoot: 48,
      trailingInset: 64,
    });
  });
});
