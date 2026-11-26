import { group, lineBreak, rect, run, solid, text } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { at, block, inset, row, sized, stack } from './blocks.js';
import { CAP_TEXT_PARAMETERS, DEFAULT_METRICS, capOffset, capText, plainRuns } from './cap-text.js';
import { parameterValues } from './parameters.js';

import type { Block } from './blocks.js';
import type { TextRun } from '@tyto/core';
import type { NodeDraft, TextDraft } from '@tyto/core/template';

/**
 * Text placed by its capitals (TYTO-793), checked against the code it replaces.
 *
 * The oracle below is `capOffset`, `textAt` and `textRuns` as tyto-template-voce-conhece and
 * tyto-template-questao-estrategica have them on origin/main (2026-11-26): their bodies are the
 * same, so one copy stands for both, verbatim but for the face and weights a template supplies.
 * A capital-placed block, put where the template's text would be, must draw the same node at the
 * same place, and its anchor must say where the template computes the last baseline:
 * `capTop + (lines − 1) × size × lineHeight + size × CAP_HEIGHT`.
 */

/* --------------------------------------------------------------- the oracle, verbatim -- */

const FACE = { family: 'CircularXX', source: 'system' } as const;
const LIGHT = 300;
const ASCENT = 0.75;
const DESCENT = 0.25;
const CAP_HEIGHT = 0.709;

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

function oracleCapOffset(size: number, lineHeight: number): number {
  return size * ((lineHeight - (ASCENT + DESCENT)) / 2 + (ASCENT - CAP_HEIGHT));
}

function textAt(name: string, words: string, placed: Placed): TextDraft {
  const style = { font: FACE, size: placed.size, weight: placed.weight, color: placed.color };
  const [first = '', ...others] = words.split('\n');
  return textRuns(
    name,
    [run(first, style), ...others.flatMap((line) => [lineBreak(), run(line, style)])],
    placed,
  );
}

function textRuns(
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
    transform: { x: placed.x, y: placed.capTop - oracleCapOffset(placed.size, lineHeight) },
  });
}

/** The foot the templates compute for a text of `count` lines (questao's `linesPiece`). */
const oracleBaseline = (capTop: number, count: number, size: number, lineHeight: number) =>
  capTop + (count - 1) * size * lineHeight + size * CAP_HEIGHT;

/* ----------------------------------------------------------------------- the checks -- */

const SIZES = [12, 29.98, 38.9, 51.06, 96];
const LINE_HEIGHTS = [1, 38 / 32, 38.68 / 29.98, 1.5];
const LINES = [1, 2, 5];

const words = (count: number) =>
  Array.from({ length: count }, (_, index) => `Linha ${index + 1}`).join('\n');

/** A block's draft, its offsets folded into its transform, as the scene would read it. */
function placedNode(draft: NodeDraft): TextDraft & { transform: { x: number; y: number } } {
  return draft as never;
}

describe('a text placed by its capitals', () => {
  const cases = SIZES.flatMap((size) =>
    LINE_HEIGHTS.flatMap((lineHeight) => LINES.map((count) => [size, lineHeight, count] as const)),
  );

  it.each(cases)(
    'draws %s px at %s with %s lines exactly where the templates did, and knows its baseline',
    (size, lineHeight, count) => {
      const style = { font: FACE, size, weight: 700, color: '#123456' };
      const capTop = 573.7;
      const x = 443;
      const expected = textAt('words', words(count), {
        x,
        capTop,
        size,
        weight: 700,
        color: '#123456',
        lineHeight,
        width: 600,
      });

      const drawn = capText(
        plainRuns(words(count), style),
        { width: 600, height: Infinity },
        { size, lineHeight },
        { name: 'words' },
      );
      const node = placedNode(at(x, capTop - drawn.anchor!.capTop, drawn));

      expect(node.transform.x).toBeCloseTo(expected.transform.x, 9);
      expect(node.transform.y).toBeCloseTo(expected.transform.y, 9);
      expect({ ...node, transform: undefined }).toEqual({ ...expected, transform: undefined });
      expect(capTop - drawn.anchor!.capTop + drawn.anchor!.baseline).toBeCloseTo(
        oracleBaseline(capTop, count, size, lineHeight),
        9,
      );
      expect(drawn.height).toBeCloseTo(count * size * lineHeight, 9);
    },
  );

  it('takes another face’s metrics as data, as informativo keeps them per family', () => {
    // informativo's Newsreader, from its METRICS table: ascent and descent do not add up to 1.
    const newsreader = { ascent: 0.735, descent: 0.265, capHeight: 0.67 };
    const roboto = { ascent: 0.928, descent: 0.244, capHeight: 0.711 };
    const informativo = (m: typeof roboto, size: number, lineHeight: number) =>
      size * ((lineHeight - (m.ascent + m.descent)) / 2 + (m.ascent - m.capHeight));

    for (const metrics of [newsreader, roboto]) {
      expect(capOffset(40, 1.2, metrics)).toBeCloseTo(informativo(metrics, 40, 1.2), 12);
      const drawn = capText(
        plainRuns('Uma', { font: FACE, size: 40, weight: 400, color: '#000000' }),
        { width: Infinity, height: Infinity },
        { size: 40, lineHeight: 1.2 },
        { metrics },
      );
      expect(drawn.anchor?.capTop).toBeCloseTo(informativo(metrics, 40, 1.2), 12);
      expect(drawn.anchor?.baseline).toBeCloseTo(
        informativo(metrics, 40, 1.2) + 40 * metrics.capHeight,
        12,
      );
    }
  });

  it('counts its lines by measuring when it can, and by its own breaks when it cannot', () => {
    const runs = plainRuns('a\nb', { font: FACE, size: 10, weight: 400, color: '#000000' });
    const area = { width: 100, height: Infinity };

    expect(capText(runs, area, { size: 10 }).height).toBe(20);
    expect(
      capText(runs, area, { size: 10 }, { measure: () => ({ lines: 4 }) as never }).height,
    ).toBe(40);
    expect(capText(runs, area, { size: 10 }, { lines: 3 }).height).toBe(30);
  });

  it('declares its numbers, with today’s values as defaults', () => {
    expect(parameterValues(CAP_TEXT_PARAMETERS)).toEqual({
      size: 32,
      lineHeight: 1,
      letterSpacing: 0,
      align: 'left',
    });
    expect(capOffset(32, 1)).toBeCloseTo(32 * (ASCENT - CAP_HEIGHT), 12);
    expect(DEFAULT_METRICS).toEqual({ ascent: ASCENT, descent: DESCENT, capHeight: CAP_HEIGHT });
  });
});

/* ------------------------------------------------------- arrangements pass it on -- */

const shape = (w: number, h: number): Block =>
  sized(rect({ size: { w, h }, fill: solid('#000000') }));
const words10 = (count: number) =>
  capText(
    plainRuns(words(count), { font: FACE, size: 10, weight: 400, color: '#000000' }),
    { width: 100, height: Infinity },
    { size: 10, lineHeight: 1.5 },
  );

describe('the anchor through arrangements (ADR 0230 decision 2)', () => {
  it('is the first child’s capitals and the last child’s baseline in a stack', () => {
    const first = words10(2);
    const last = words10(3);
    const drawn = stack({ items: [first, shape(100, 40), last], gap: 7 });
    const lastTop = first.height + 7 + 40 + 7;

    expect(drawn.anchor).toEqual({
      capTop: first.anchor!.capTop,
      baseline: lastTop + last.anchor!.baseline,
    });
  });

  it('reads a child with no words by its box’s edges', () => {
    const drawn = stack({ items: [shape(100, 40), words10(1)], gap: 5 });
    const tail = stack({ items: [words10(1), shape(100, 40)], gap: 5 });

    expect(drawn.anchor?.capTop).toBe(0);
    expect(tail.anchor?.baseline).toBe(words10(1).height + 5 + 40);
  });

  it('leaves the anchor out where no child has words, so old blocks read as before', () => {
    const drawn = stack({ items: [shape(10, 10), block(10, 10, group({ children: [] }))] });

    expect('anchor' in drawn).toBe(false);
    expect('anchor' in row({ items: [shape(10, 10)] })).toBe(false);
    expect('anchor' in inset({ item: shape(10, 10), padding: 4 })).toBe(false);
  });

  it('moves with the child where a row centres it across, and with an inset’s top padding', () => {
    const small = words10(1);
    const across = row({ items: [shape(20, 100), small], align: 'center' });
    const room = (100 - small.height) / 2;

    expect(across.anchor).toEqual({ capTop: 0, baseline: room + small.anchor!.baseline });
    expect(inset({ item: small, padding: [12, 0, 3, 0] }).anchor).toEqual({
      capTop: 12 + small.anchor!.capTop,
      baseline: 12 + small.anchor!.baseline,
    });
  });
});
