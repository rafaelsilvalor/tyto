import { run, text } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { at } from './blocks.js';
import { parameterValues } from './parameters.js';
import { SLIDE_COUNTER_PARAMETERS, slideCounter } from './slide-counter.js';

import type { TextRun } from '@tyto/core';
import type { NodeDraft, TextDraft } from '@tyto/core/template';

/*
 * The oracle: questao-estrategica's `slideNumber` on its origin/main (38ae3a5, src/template.ts
 * :1605) with its `textRuns` and `capOffset`, code copied verbatim. `context` is stood in for by
 * the artwork it reads.
 */

const FACE = { family: 'CircularXX', source: 'system' } as const;
const REGULAR = 400;
const BOLD = 700;
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

function textRuns(
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

function slideNumber(
  context: { readonly artwork: { readonly index: number; readonly count: number } },
  placed: { readonly capTop: number; readonly current: string; readonly total: string },
): NodeDraft {
  const pad = (value: number) => String(value).padStart(2, '0');
  const size = 29.34;
  const style = { font: FACE, size, weight: REGULAR };
  return textRuns(
    'numero',
    [
      run(pad(context.artwork.index + 1), { ...style, weight: BOLD, color: placed.current }),
      run(' I ', { ...style, color: placed.current }),
      run(pad(context.artwork.count), { ...style, color: placed.total }),
    ],
    { x: 82, capTop: placed.capTop, size, lineHeight: 1, letterSpacing: -1.17 },
  );
}

const STYLE = {
  font: FACE,
  currentWeight: BOLD,
  otherWeight: REGULAR,
  current: '#1a2b3c',
  total: '#8899aa',
};
const UNBOUNDED = { width: Infinity, height: Infinity };

function questaoCounter(artwork: { index: number; count: number }, capTop: number): NodeDraft {
  const counter = slideCounter(
    artwork,
    UNBOUNDED,
    STYLE,
    { size: 29.34, letterSpacing: -1.17 },
    { name: 'numero' },
  );
  return at(82, capTop - counter.anchor!.capTop, counter);
}

describe('the slide counter', () => {
  it.each([
    [0, 4, 1162],
    [2, 4, 1162],
    [8, 10, 1100],
    [0, 1, 1162],
  ])('draws questao-estrategica’s number for slide %i of %i exactly', (index, count, capTop) => {
    const artwork = { index, count };
    const kit = questaoCounter(artwork, capTop);
    const oracle = slideNumber({ artwork }, { capTop, current: STYLE.current, total: STYLE.total });
    expect(kit).toEqual(oracle);
  });

  it('reads 01 I 04 for the first of four, the first number bold', () => {
    const counter = slideCounter({ index: 0, count: 4 }, UNBOUNDED, STYLE);
    const runs = (counter.draft as TextDraft).runs as readonly TextRun[];
    expect(runs.map((each) => (each.kind === 'text' ? each.text : ''))).toEqual([
      '01',
      ' I ',
      '04',
    ]);
    expect(runs.map((each) => (each.kind === 'text' ? each.weight : 0))).toEqual([
      BOLD,
      REGULAR,
      REGULAR,
    ]);
  });

  it('pads to the digits it is given, and takes another separator', () => {
    const counter = slideCounter(
      { index: 6, count: 12 },
      UNBOUNDED,
      STYLE,
      { digits: 3 },
      { separator: ' / ' },
    );
    const runs = (counter.draft as TextDraft).runs as readonly TextRun[];
    expect(runs.map((each) => (each.kind === 'text' ? each.text : ''))).toEqual([
      '007',
      ' / ',
      '012',
    ]);
  });

  it('is one line, its anchor at its capitals', () => {
    const counter = slideCounter({ index: 0, count: 4 }, UNBOUNDED, STYLE, { size: 20 });
    expect(counter.height).toBe(20);
    expect(counter.anchor!.capTop).toBeCloseTo(capOffset(20, 1), 12);
  });

  it('takes neutral defaults', () => {
    expect(parameterValues(SLIDE_COUNTER_PARAMETERS)).toEqual({
      size: 28,
      letterSpacing: 0,
      lineHeight: 1,
      digits: 2,
    });
  });
});
