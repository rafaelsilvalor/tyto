import { describe, expect, it } from 'vitest';

import { ENUMERATION_CAP, balance } from './balance.js';
import { pieces } from './breaks.js';

import type { BalanceRequest } from './balance.js';

/**
 * A stand-in measure: every character is 1 wide at the reference size of 1, spaces included.
 * The rules under test are about which breaks win, so a monospaced width is all they need.
 */
function request(text: string, overrides: Partial<BalanceRequest> = {}): BalanceRequest {
  const split = pieces(text);
  return {
    pieces: split,
    forced: new Set(),
    widthOf: (from, to) => split.slice(from, to).join(' ').length,
    reference: 1,
    box: { w: 30, h: 30 },
    lineHeight: 1,
    sizes: { floor: 1, ceiling: 1, step: 1 },
    ...overrides,
  };
}

/** The lines a setting draws, as strings. */
function linesOf(text: string, starts: readonly number[]): string[] {
  const split = pieces(text);
  return starts.map((start, line) =>
    split.slice(start, starts[line + 1] ?? split.length).join(' '),
  );
}

describe('balancing the lines', () => {
  it('evens the lines out rather than filling the first one', () => {
    // Greedy at 30 would give `aaaa bbbb cccc dddd eeee ffff` / `ggg`.
    const text = 'aaaa bbbb cccc dddd eeee ffff ggg';
    const setting = balance(request(text, { box: { w: 30, h: 2 } }))!;

    expect(linesOf(text, setting.starts)).toEqual(['aaaa bbbb cccc', 'dddd eeee ffff ggg']);
    expect(setting.overflow).toBe(0);
  });

  it('uses no more lines than it needs', () => {
    const setting = balance(request('aaaa bbbb', { box: { w: 30, h: 5 } }))!;
    expect(setting.starts).toEqual([0]);
  });

  it('takes the largest size that fits, never above the ceiling', () => {
    const text = 'aaaa bbbb'; // 9 wide at size 1
    const fits = balance(
      request(text, { box: { w: 40, h: 4 }, sizes: { floor: 1, ceiling: 8, step: 0.5 } }),
    )!;
    // At 4 the one line is 36 + 1 of slack wide; at 4.5 one line is taller than the box.
    expect(fits.size).toBe(4);
    expect(fits.overflow).toBe(0);
  });
});

describe('a line never ends on a function word when a better break exists', () => {
  const text = 'Prefeitura Municipal de São Miguel do Araguaia';

  it('breaks before `de`, not after it', () => {
    const setting = balance(request(text, { box: { w: 30, h: 2 } }))!;
    const lines = linesOf(text, setting.starts);

    for (const line of lines.slice(0, -1)) expect(line).not.toMatch(/ (de|do)$/u);
    expect(lines).toEqual(['Prefeitura Municipal', 'de São Miguel do Araguaia']);
  });

  it('prefers a clean break at a smaller size to an awkward one at a larger size', () => {
    // `aaaaaaaa de` / `bbbbbbbbbbbb` fits at size 2; the clean `aaaaaaaa` / `de bbbbbbbbbbbb`
    // only at 1.5.
    const awkward = 'aaaaaaaa de bbbbbbbbbbbb';
    const setting = balance(
      request(awkward, { box: { w: 25, h: 4 }, sizes: { floor: 1, ceiling: 3, step: 0.5 } }),
    )!;

    expect(linesOf(awkward, setting.starts)).toEqual(['aaaaaaaa', 'de bbbbbbbbbbbb']);
    expect(setting.size).toBe(1.5);
  });

  it('ends a line on one when nothing else fits', () => {
    // Only `aaaa de` / `bbbbbb` fits an 8-wide box in two lines.
    const setting = balance(request('aaaa de bbbbbb', { box: { w: 8, h: 2 } }))!;
    expect(linesOf('aaaa de bbbbbb', setting.starts)).toEqual(['aaaa de', 'bbbbbb']);
    expect(setting.overflow).toBe(0);
  });
});

describe('what cannot fit', () => {
  it('is set at the floor and says by how much it overflows, instead of being cut', () => {
    const text = 'aaaa bbbb cccc dddd eeee';
    const setting = balance(
      request(text, { box: { w: 10, h: 2 }, sizes: { floor: 1, ceiling: 4, step: 1 } }),
    )!;

    expect(setting.size).toBe(1);
    expect(setting.overflow).toBeGreaterThan(0);
    // Every piece is still drawn.
    expect(linesOf(text, setting.starts).join(' ')).toBe(text);
  });

  it('answers nothing when nothing can measure, or there is nothing to set', () => {
    expect(balance(request('aaaa', { widthOf: () => undefined }))).toBeUndefined();
    expect(balance(request(''))).toBeUndefined();
  });
});

describe('the author’s own break', () => {
  it('is always taken, and counts against no rule', () => {
    const text = 'aaaa de bbbb cccc';
    const setting = balance(request(text, { forced: new Set([2]), box: { w: 30, h: 3 } }))!;
    expect(linesOf(text, setting.starts)).toEqual(['aaaa de', 'bbbb cccc']);
  });
});

describe('a text past the enumeration cap', () => {
  it('is broken greedily, in one pass, and still fits', () => {
    const words = Array.from({ length: 40 }, (_, index) => `w${String(index).padStart(2, '0')}`);
    const text = words.join(' ');
    let calls = 0;
    const base = request(text, { box: { w: 40, h: 40 } });
    const setting = balance({
      ...base,
      widthOf: (from, to) => {
        calls += 1;
        return base.widthOf(from, to);
      },
    })!;

    expect(words.length).toBeGreaterThan(ENUMERATION_CAP);
    expect(setting.overflow).toBe(0);
    // Greedy: every line but the last is as full as 40 allows (10 words of 3 and 9 spaces).
    expect(linesOf(text, setting.starts).map((line) => line.split(' ').length)).toEqual([
      10, 10, 10, 10,
    ]);
    // Linear in the pieces, not 2^39.
    expect(calls).toBeLessThan(words.length * 4);
  });
});
