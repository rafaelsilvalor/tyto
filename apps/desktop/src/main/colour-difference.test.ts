import { describe, expect, it } from 'vitest';

import { closestPair, colourDifference, labDifference, type Lab } from './colour-difference.js';

/**
 * The formula is checked against the published test data of Sharma, Wu and Dalal, "The
 * CIEDE2000 color-difference formula" (2005), table 1: pairs that exercise the hue wrap, the
 * blue rotation term and a grey with no chroma, each to the four decimals the paper prints.
 */
const SHARMA_PAIRS: readonly (readonly [Lab, Lab, number])[] = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
];

describe('the colour difference (CIEDE2000)', () => {
  it.each(SHARMA_PAIRS)('reads %j and %j %s apart', (one, two, expected) => {
    expect(labDifference(one, two)).toBeCloseTo(expected, 4);
    expect(labDifference(two, one)).toBeCloseTo(expected, 4);
  });

  it('reads a colour 0 from itself', () => {
    expect(colourDifference('#ff79c6', '#ff79c6')).toBe(0);
  });

  it('names the closest pair of a set', () => {
    expect(
      closestPair({ red: '#ff0000', blue: '#0000ff', pink: '#ff79c6', orange: '#ff1100' }),
    ).toMatchObject({ names: ['red', 'orange'] });
  });
});
