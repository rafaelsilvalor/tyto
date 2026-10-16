import { describe, expect, it } from 'vitest';

import { dropIndexAt } from './tab-drag.js';

describe('the gap a dragged tab lands in (TYTO-288)', () => {
  // Three tabs whose middles are at 50, 150 and 250.
  const midpoints = [50, 150, 250];

  it('is before a tab while the pointer is left of its middle', () => {
    expect(dropIndexAt(midpoints, 0)).toBe(0);
    expect(dropIndexAt(midpoints, 49)).toBe(0);
    expect(dropIndexAt(midpoints, 149)).toBe(1);
  });

  it('is after a tab once the pointer is past its middle', () => {
    expect(dropIndexAt(midpoints, 51)).toBe(1);
    expect(dropIndexAt(midpoints, 151)).toBe(2);
    expect(dropIndexAt(midpoints, 251)).toBe(3);
    expect(dropIndexAt(midpoints, 9999)).toBe(3);
  });

  it('is the only gap of an empty strip', () => {
    expect(dropIndexAt([], 120)).toBe(0);
  });
});
