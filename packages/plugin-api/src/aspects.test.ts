import { describe, expect, it } from 'vitest';

import { aspectOf, aspectsText } from './index.js';

/** A plugin reads an image's shape from here (ADR 0215), so the re-export is the contract. */
describe('the shapes a plugin reads through the plugin API', () => {
  it('are the delivery check’s words', () => {
    expect(aspectOf(1080, 1350)).toBe('4:5');
    expect(aspectOf(4000, 1000)).toBe('wide');
    expect(aspectOf(undefined, 1)).toBe('?');
    expect(aspectsText(new Map([['4:5', 2]]))).toBe('4:5:2');
  });
});
