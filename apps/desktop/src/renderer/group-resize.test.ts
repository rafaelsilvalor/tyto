import { describe, expect, it } from 'vitest';

import { focusGroup, groupList, groupsOf, splitGroup } from './editor-groups.js';
import {
  GROUP_MINIMUM,
  KEYBOARD_STEP,
  SPLITTER_THICKNESS,
  equalShares,
  footprintOf,
  keyboardDelta,
  minimumOf,
  resizedShares,
  separatorBounds,
  separatorValue,
} from './group-resize.js';

const MINIMUM = { before: GROUP_MINIMUM.row, after: GROUP_MINIMUM.row };

describe('resizedShares', () => {
  it('moves the line by the pointer’s distance, as a share of the pair', () => {
    // 900 px split in halves; the line dragged 150 px left lands at one third.
    const shares = resizedShares([0.5, 0.5], 0, { before: 450, after: 450 }, -150, MINIMUM);
    expect(shares[0]).toBeCloseTo(1 / 3, 10);
    expect(shares[1]).toBeCloseTo(2 / 3, 10);
  });

  it('changes only the two neighbours of the line, and keeps what they held together', () => {
    const shares = resizedShares([0.5, 0.25, 0.25], 1, { before: 250, after: 250 }, 50, MINIMUM);
    expect(shares[0]).toBe(0.5);
    expect(shares[1]).toBeCloseTo(0.3, 10);
    expect(shares[2]).toBeCloseTo(0.2, 10);
    expect((shares[1] ?? 0) + (shares[2] ?? 0)).toBeCloseTo(0.5, 10);
  });

  it('stops each neighbour at its minimum, on both sides', () => {
    const pair = { before: 450, after: 450 };
    const left = resizedShares([0.5, 0.5], 0, pair, -1000, MINIMUM);
    expect((left[0] ?? 0) * 900).toBeCloseTo(GROUP_MINIMUM.row, 6);
    const right = resizedShares([0.5, 0.5], 0, pair, 1000, MINIMUM);
    expect((right[1] ?? 0) * 900).toBeCloseTo(GROUP_MINIMUM.row, 6);
  });

  it('leaves a pair too small to give both their minimum as it is', () => {
    expect(resizedShares([0.5, 0.5], 0, { before: 100, after: 100 }, 40, MINIMUM)).toEqual([
      0.5, 0.5,
    ]);
  });

  it('leaves the shares alone for an unmeasured pair or a line that is not there', () => {
    expect(resizedShares([0.5, 0.5], 0, { before: 0, after: 0 }, 40, MINIMUM)).toEqual([0.5, 0.5]);
    expect(resizedShares([0.5, 0.5], 1, { before: 450, after: 450 }, 40, MINIMUM)).toEqual([
      0.5, 0.5,
    ]);
  });
});

describe('minimumOf', () => {
  it('is a group’s minimum along each axis', () => {
    const group = groupsOf(['a'], 'a').root;
    expect(minimumOf(group, 'row')).toBe(GROUP_MINIMUM.row);
    expect(minimumOf(group, 'column')).toBe(GROUP_MINIMUM.column);
  });

  it('adds children up along a split’s own axis and takes the largest across it', () => {
    const column = splitGroup(groupsOf(['a'], 'a'), 'column').root;
    expect(minimumOf(column, 'column')).toBe(2 * GROUP_MINIMUM.column);
    expect(minimumOf(column, 'row')).toBe(GROUP_MINIMUM.row);
  });
});

describe('footprintOf (TYTO-299)', () => {
  it('is a group’s minimum, with no line, for a lone group', () => {
    const group = groupsOf(['a'], 'a').root;
    expect(footprintOf(group, 'row')).toBe(GROUP_MINIMUM.row);
    expect(footprintOf(group, 'column')).toBe(GROUP_MINIMUM.column);
  });

  it('adds a line between each pair along the split’s axis, and none across it', () => {
    const three = splitGroup(splitGroup(groupsOf(['a'], 'a'), 'row'), 'row').root;
    expect(footprintOf(three, 'row')).toBe(3 * GROUP_MINIMUM.row + 2 * SPLITTER_THICKNESS);
    expect(footprintOf(three, 'column')).toBe(GROUP_MINIMUM.column);
  });

  it('measures the card’s scene: a column of two beside one group, 321 by 193', () => {
    // Split right, then the left group down: row [column [a, a], a].
    const right = splitGroup(groupsOf(['a'], 'a'), 'row');
    const scene = splitGroup(focusGroup(right, groupList(right)[0]?.id ?? ''), 'column');
    expect(scene.root.kind === 'split' && scene.root.children[0]?.kind).toBe('split');
    expect(footprintOf(scene.root, 'row')).toBe(2 * GROUP_MINIMUM.row + SPLITTER_THICKNESS);
    expect(footprintOf(scene.root, 'column')).toBe(2 * GROUP_MINIMUM.column + SPLITTER_THICKNESS);
    // The drag's minimum has no lines in it: one line apart from the footprint per axis.
    expect(minimumOf(scene.root, 'row')).toBe(2 * GROUP_MINIMUM.row);
  });
});

describe('equalShares', () => {
  it('gives every child the same share', () => {
    expect(equalShares(2)).toEqual([0.5, 0.5]);
    expect(equalShares(4)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(equalShares(0)).toEqual([]);
  });
});

describe('keyboardDelta', () => {
  it('moves a line between groups side by side with left and right only', () => {
    expect(keyboardDelta('ArrowLeft', 'row')).toBe(-KEYBOARD_STEP);
    expect(keyboardDelta('ArrowRight', 'row')).toBe(KEYBOARD_STEP);
    expect(keyboardDelta('ArrowUp', 'row')).toBeUndefined();
  });

  it('moves a line between stacked groups with up and down only', () => {
    expect(keyboardDelta('ArrowUp', 'column')).toBe(-KEYBOARD_STEP);
    expect(keyboardDelta('ArrowDown', 'column')).toBe(KEYBOARD_STEP);
    expect(keyboardDelta('ArrowRight', 'column')).toBeUndefined();
    expect(keyboardDelta('Enter', 'column')).toBeUndefined();
  });
});

describe('the separator’s values', () => {
  it('names the share before the line as a percentage of its pair', () => {
    expect(separatorValue([0.5, 0.5], 0)).toBe(50);
    expect(separatorValue([1 / 3, 2 / 3], 0)).toBe(33);
    expect(separatorValue([0.5, 0.1, 0.4], 1)).toBe(20);
  });

  it('bounds the line where the minimums stop it, and 0-100 before any layout', () => {
    expect(separatorBounds({ before: 400, after: 400 }, MINIMUM)).toEqual({ min: 20, max: 80 });
    expect(separatorBounds({ before: 0, after: 0 }, MINIMUM)).toEqual({ min: 0, max: 100 });
  });
});
