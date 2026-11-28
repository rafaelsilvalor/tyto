import { rect } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import {
  oldIcon,
  oldInset,
  oldMark,
  oldRow,
  oldSpaceByWeight,
  oldStack,
} from './arrangement-before.fixture.js';
import {
  type Align,
  type Block,
  INSET_PARAMETERS,
  ROW_PARAMETERS,
  STACK_PARAMETERS,
  inset,
  insetIn,
  row,
  rowIn,
  stack,
  stackIn,
} from './blocks.js';
import { BLOCK_COLUMN_PARAMETERS, blockColumn } from './column.js';
import { ARROW_ICON, HEART_ICON, ICON_PARAMETERS, icon, iconIn } from './icons.js';
import { MARK_PARAMETERS, mark, markIn } from './mark.js';
import { parameterValues } from './parameters.js';
import { spaceByWeight, weightedSpacing } from './rhythm.js';

/*
 * TYTO-891, the arrangement family: each older form is now a wrapper over an area-taking form,
 * and must draw what it drew. The oracle is the older code itself, copied verbatim from
 * origin/main into `arrangement-before.fixture.ts`; every wrapper, and every new form at its
 * defaults over an unbounded area, is compared to it whole (`toEqual`).
 */

const UNBOUNDED = { width: Infinity, height: Infinity };

/** Blocks of every kind an arrangement meets: plain, fractional, with words (an anchor). */
function box(width: number, height: number, name: string): Block {
  return { width, height, draft: rect({ name, size: { w: width, h: height } }) };
}
const worded = (width: number, height: number, capTop: number, baseline: number, name: string) => ({
  ...box(width, height, name),
  anchor: { capTop, baseline },
});
const ITEMS: readonly (readonly Block[])[] = [
  [],
  [box(100, 40, 'a')],
  [box(100, 40, 'a'), box(60.5, 20.25, 'b'), box(80, 10 / 3, 'c')],
  [worded(300, 48, 9.6, 43.6, 'title'), box(200, 2, 'rule'), worded(250, 96, 7.2, 89.1, 'body')],
  [box(10, 10, 'a'), worded(40.3, 33.3, 1.1, 30.7, 'w')],
  // Sizes whose sums round differently by grouping: a + (b + c) is not (a + b) + c here.
  [box(1, 0.1, 'p'), box(1, 0.2, 'q'), box(1, 0.3, 'r'), box(1, 0.7, 's')],
];
const GAPS = [undefined, 0, 12, 0.1, 0.3, 1 / 3, -4];
const ALIGNS: readonly (Align | undefined)[] = [undefined, 'start', 'center', 'end'];
const NAMES = [undefined, 'pilha'];

/** A new form's block without what it adds: the shape the older form returned. */
function withoutOverflow(drawn: Block & { readonly overflow: number }): Block {
  const { overflow, ...rest } = drawn;
  expect(overflow).toBe(0);
  return rest;
}

describe('the older arrangement forms draw what they drew', () => {
  it('stack: the wrapper and stackIn at its defaults equal the older stack', () => {
    let compared = 0;
    for (const items of ITEMS) {
      for (const gap of GAPS) {
        for (const align of ALIGNS) {
          for (const name of NAMES) {
            const options = {
              items,
              ...(gap === undefined ? {} : { gap }),
              ...(align === undefined ? {} : { align }),
              ...(name === undefined ? {} : { name }),
            };
            const before = oldStack(options);
            expect(stack(options)).toEqual(before);
            const given = {
              ...(gap === undefined ? {} : { gap }),
              ...(align === undefined ? {} : { align }),
            };
            expect(
              withoutOverflow(stackIn(UNBOUNDED, items, given, name === undefined ? {} : { name })),
            ).toEqual(before);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(ITEMS.length * GAPS.length * ALIGNS.length * NAMES.length);
  });

  it('row: the wrapper and rowIn at its defaults equal the older row', () => {
    for (const items of ITEMS) {
      for (const gap of GAPS) {
        for (const align of ALIGNS) {
          const options = {
            items,
            ...(gap === undefined ? {} : { gap }),
            ...(align === undefined ? {} : { align }),
            name: 'linha',
          };
          const before = oldRow(options);
          expect(row(options)).toEqual(before);
          const given = {
            ...(gap === undefined ? {} : { gap }),
            ...(align === undefined ? {} : { align }),
          };
          expect(withoutOverflow(rowIn(UNBOUNDED, items, given, { name: 'linha' }))).toEqual(
            before,
          );
        }
      }
    }
  });

  it('inset: the wrapper and insetIn equal the older inset', () => {
    const paddings = [0, 8, 2.5, [1, 2, 3, 4], [0, 0.1, 10 / 3, -2]] as const;
    for (const item of [box(100, 40, 'a'), worded(300, 48, 9.6, 43.6, 'title')]) {
      for (const padding of paddings) {
        const before = oldInset({ item, padding });
        expect(inset({ item, padding })).toEqual(before);
        const [top, right, bottom, left] =
          typeof padding === 'number' ? [padding, padding, padding, padding] : padding;
        expect(withoutOverflow(insetIn(UNBOUNDED, item, { top, right, bottom, left }))).toEqual(
          before,
        );
      }
    }
  });

  it('mark and icon: the wrappers and the area forms equal the older ones', () => {
    const owl = { box: { w: 120, h: 80 }, d: 'M0 0H120V80H0Z', fillRule: 'nonzero' as const };
    for (const height of [24, 63, 10 / 3]) {
      const before = oldMark(owl, height, '#123456', 'logo');
      expect(mark(owl, height, '#123456', 'logo')).toEqual(before);
      expect(
        withoutOverflow(markIn(owl, { width: Infinity, height }, '#123456', {}, { name: 'logo' })),
      ).toEqual(before);
      for (const shape of [HEART_ICON, ARROW_ICON]) {
        const old = oldIcon(shape, height, '#123456', 'icone');
        expect(icon(shape, height, '#123456', 'icone')).toEqual(old);
        expect(
          withoutOverflow(iconIn(shape, UNBOUNDED, '#123456', { height }, { name: 'icone' })),
        ).toEqual(old);
      }
    }
  });

  it('spaceByWeight: the deprecated wrapper spaces and throws as it did', () => {
    const spacing = { top: 300, bottom: 1200, heights: [120.5, 300, 77], weights: [1, 2, 2.5, 0] };
    expect(spaceByWeight(spacing)).toEqual(oldSpaceByWeight(spacing));
    const tight = { ...spacing, bottom: 500 };
    expect(spaceByWeight(tight)).toEqual(oldSpaceByWeight(tight));
    const wrong = { ...spacing, weights: [1, 2] };
    expect(() => oldSpaceByWeight(wrong)).toThrow(RangeError);
    expect(() => spaceByWeight(wrong)).toThrow('spaceByWeight takes 4 weights for 3 blocks, got 2');
  });
});

describe('the area-taking forms', () => {
  it('weightedSpacing returns a mismatch instead of throwing', () => {
    const spacing = { top: 0, bottom: 100, heights: [10, 20], weights: [1, 1, 1] };
    expect(weightedSpacing(spacing)).toEqual({
      ok: true,
      value: oldSpaceByWeight(spacing),
      diagnostics: [],
    });
    expect(weightedSpacing({ ...spacing, weights: [1] })).toEqual({
      ok: false,
      error: { expected: 3, got: 1 },
    });
  });

  it('stack: an item may state its own gap above it', () => {
    const drawn = stackIn(
      UNBOUNDED,
      [box(10, 10, 'a'), { item: box(10, 10, 'b'), gapAbove: 30 }, box(10, 10, 'c')],
      {
        gap: 5,
      },
    );
    expect(drawn.height).toBe(10 + 30 + 10 + 5 + 10);
  });

  it('stack: measured from the capitals, a gap runs from a baseline to the next capitals', () => {
    const title = worded(300, 48, 9.6, 43.6, 'title');
    const body = worded(250, 96, 7.2, 89.1, 'body');
    const drawn = stackIn(UNBOUNDED, [title, body], { gap: 40, measureFrom: 'capitals' });
    const [, placed] = (drawn.draft as { children: readonly { transform: { y: number } }[] })
      .children;
    // The body's capitals 40 px under the title's baseline.
    expect(placed!.transform.y + body.anchor.capTop).toBeCloseTo(title.anchor.baseline + 40, 12);
    expect(drawn.anchor).toEqual({
      capTop: 9.6,
      baseline: placed!.transform.y + body.anchor.baseline,
    });
  });

  it('stack, row and inset report how far they run past a bounded area', () => {
    expect(stackIn({ width: 200, height: 50 }, [box(10, 40, 'a'), box(10, 40, 'b')]).overflow).toBe(
      30,
    );
    expect(rowIn({ width: 15, height: 50 }, [box(10, 40, 'a'), box(10, 40, 'b')]).overflow).toBe(5);
    expect(insetIn({ width: 100, height: 45 }, box(10, 40, 'a'), { top: 10 }).overflow).toBe(5);
  });

  it('stack aligns across a bounded width, as wide as the area', () => {
    const drawn = stackIn({ width: 200, height: Infinity }, [box(100, 10, 'a')], { align: 'end' });
    expect(drawn.width).toBe(200);
    expect((drawn.draft as GroupLike).children[0]!.transform.x).toBe(100);
  });

  it('a mark takes the area’s height unless it is given one', () => {
    const owl = { box: { w: 120, h: 80 }, d: 'M0 0H120V80H0Z', fillRule: 'nonzero' as const };
    expect(markIn(owl, { width: Infinity, height: 40 }, '#000000').height).toBe(40);
    expect(markIn(owl, { width: Infinity, height: 40 }, '#000000', { height: 20 }).height).toBe(20);
    expect(markIn(owl, UNBOUNDED, '#000000').height).toBe(24);
    expect(markIn(owl, { width: 30, height: 40 }, '#000000').overflow).toBe(30);
  });

  it('blockColumn: measured from the capitals, the gap is from a baseline to the next capitals', () => {
    const title = worded(300, 48, 9.6, 43.6, 'title');
    const body = worded(250, 96, 7.2, 89.1, 'body');
    const column = (measureFrom: 'box' | 'capitals') =>
      blockColumn(
        { width: 400, height: Infinity },
        {
          entries: [
            { name: 'title', build: () => title },
            { name: 'body', build: () => body },
          ],
          parameters: { gap: 40, measureFrom },
        },
      );
    const capitals = column('capitals');
    const boxes = column('box');
    const bodyTop = (laid: ReturnType<typeof column>) =>
      laid.placed.find((each) => each.name === 'body')!.top;
    expect(bodyTop(boxes)).toBe(48 + 40);
    expect(bodyTop(capitals) + body.anchor.capTop).toBeCloseTo(title.anchor.baseline + 40, 12);
  });

  it('take the older forms’ values as defaults', () => {
    expect(parameterValues(STACK_PARAMETERS)).toEqual({
      gap: 0,
      align: 'start',
      measureFrom: 'box',
    });
    expect(parameterValues(ROW_PARAMETERS)).toEqual({ gap: 0, align: 'start' });
    expect(parameterValues(INSET_PARAMETERS)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(parameterValues(MARK_PARAMETERS)).toEqual({ height: 24 });
    expect(parameterValues(ICON_PARAMETERS)).toEqual({ height: 24 });
    expect(parameterValues(BLOCK_COLUMN_PARAMETERS)).toMatchObject({ measureFrom: 'box' });
  });
});

interface GroupLike {
  readonly children: readonly { readonly transform: { readonly x: number; readonly y: number } }[];
}
