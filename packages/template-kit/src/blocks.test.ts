import type { GroupDraft, NodeDraft } from '@tyto/core/template';
import { rect } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { at, block, inset, row, sized, stack } from './blocks.js';

/**
 * What these tests are for.
 *
 * The card asks for arrangement that resolves to absolute coordinates before the IR sees
 * anything, so the thing worth asserting is arithmetic: where each child lands, and what
 * the arrangement reports about itself afterwards. A helper that placed children correctly
 * and lied about its own height would compose wrong one level up and nowhere else, which
 * is why every case below checks both.
 *
 * Nothing here renders. `parseScene` is the validator and `frame()` assigns the ids; a
 * block is upstream of both, and a test that drew something would be testing them.
 */

/** A square of a stated size, which is all most of these cases need. */
function square(size: number) {
  return sized(rect({ size: { w: size, h: size } }));
}

function childrenOf(draft: NodeDraft): readonly NodeDraft[] {
  expect(draft.kind).toBe('group');
  return (draft as GroupDraft).children;
}

function positionsOf(draft: NodeDraft): readonly { x: number; y: number }[] {
  return childrenOf(draft).map((child) => ({ x: child.transform.x, y: child.transform.y }));
}

describe('stack', () => {
  it('places each child below the last and charges the gap between neighbours only', () => {
    const stacked = stack({ gap: 10, items: [square(40), square(30), square(20)] });

    expect(positionsOf(stacked.draft)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 0, y: 90 },
    ]);
    // 40 + 10 + 30 + 10 + 20, and no gap hanging off the bottom.
    expect(stacked.height).toBe(110);
    expect(stacked.width).toBe(40);
  });

  it('is nothing when it holds nothing', () => {
    const empty = stack({ gap: 10, items: [] });

    expect(childrenOf(empty.draft)).toHaveLength(0);
    expect(empty).toMatchObject({ width: 0, height: 0 });
  });

  it('is exactly its child when it holds one, whatever the gap says', () => {
    const single = stack({ gap: 64, items: [square(40)] });

    expect(single).toMatchObject({ width: 40, height: 40 });
  });

  it('centres and end-aligns a narrower child across its width', () => {
    const items = [square(40), square(20)];

    expect(positionsOf(stack({ align: 'center', items }).draft)[1]).toEqual({ x: 10, y: 40 });
    expect(positionsOf(stack({ align: 'end', items }).draft)[1]).toEqual({ x: 20, y: 40 });
  });
});

describe('row', () => {
  it('places each child right of the last and reports the tallest as its height', () => {
    const lined = row({ gap: 8, items: [square(40), square(24)] });

    expect(positionsOf(lined.draft)).toEqual([
      { x: 0, y: 0 },
      { x: 48, y: 0 },
    ]);
    expect(lined).toMatchObject({ width: 72, height: 40 });
  });

  it('centres a shorter child across its height', () => {
    const lined = row({ align: 'center', items: [square(40), square(20)] });

    expect(positionsOf(lined.draft)[1]).toEqual({ x: 40, y: 10 });
  });
});

describe('placement', () => {
  /**
   * The promise the module's header makes, and the one most likely to be broken by a later
   * edit: a helper adds to what a node already carries rather than overwriting it. A node
   * nudged by hand keeps its nudge wherever it is put.
   */
  it('adds to a coordinate the child already carried', () => {
    const nudged = sized(rect({ size: { w: 10, h: 10 }, transform: { x: 4, y: 3 } }));

    const stacked = stack({ items: [square(20), nudged] });

    expect(positionsOf(stacked.draft)[1]).toEqual({ x: 4, y: 23 });
  });

  it('leaves the rest of a transform alone', () => {
    const turned = sized(rect({ size: { w: 10, h: 10 }, transform: { rotation: 45, scaleX: 2 } }));

    const placed = at(100, 200, turned);

    expect(placed.transform).toMatchObject({ x: 100, y: 200, rotation: 45, scaleX: 2 });
  });

  it('moves a block to where the frame wants it', () => {
    const placed = at(64, 128, stack({ gap: 4, items: [square(10), square(10)] }));

    expect(placed.transform).toMatchObject({ x: 64, y: 128 });
    // The children stay relative: only the arrangement moved.
    expect(positionsOf(placed)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 14 },
    ]);
  });
});

describe('inset', () => {
  it('grows by its padding and pushes its child in', () => {
    const padded = inset({ padding: [4, 8, 12, 16], item: square(20) });

    expect(padded).toMatchObject({ width: 44, height: 36 });
    expect(positionsOf(padded.draft)).toEqual([{ x: 16, y: 4 }]);
  });

  it('takes one number for all four sides', () => {
    const padded = inset({ padding: 6, item: square(20) });

    expect(padded).toMatchObject({ width: 32, height: 32 });
    expect(positionsOf(padded.draft)).toEqual([{ x: 6, y: 6 }]);
  });
});

describe('composition', () => {
  /**
   * The reason a helper returns a `Block` instead of a draft. If an arrangement did not
   * report its own size, the caller would have to restate it to nest one inside another,
   * and the restated number is the one that goes stale.
   */
  it('nests a row inside a stack without anybody restating a size', () => {
    const line = row({ gap: 8, items: [square(24), square(24)] });
    const page = stack({ gap: 16, items: [square(40), line, square(12)] });

    expect(line).toMatchObject({ width: 56, height: 24 });
    expect(positionsOf(page.draft)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 56 },
      { x: 0, y: 96 },
    ]);
    expect(page).toMatchObject({ width: 56, height: 108 });
  });

  it('keeps a hand-stated size for a node that cannot answer for itself', () => {
    // A group has no box in the IR and a text's box dimensions are optional, so neither
    // can reach `sized`. `block` is where the author supplies what the IR cannot.
    const stated = block(200, 48, rect({ size: { w: 200, h: 48 } }));

    expect(stack({ items: [stated, square(10)] })).toMatchObject({ width: 200, height: 58 });
  });
});
