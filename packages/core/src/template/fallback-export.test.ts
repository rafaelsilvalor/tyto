import { describe, expect, it } from 'vitest';

import * as sdk from './index.js';
import { fallbackChain } from '../text/fallback.js';

/**
 * TYTO-619, ADR 0168: a template's faces test lists the chain's faces beside its own, because
 * only listed faces cross to its plugin's process. Before the export it rewrote the chain's rule
 * by hand, and a change to the chain would have left every such test agreeing with the old one.
 */
describe('the symbol fallback chain in the template SDK', () => {
  it('is the chain layout uses, not a copy of it', () => {
    expect(sdk.fallbackChain).toBe(fallbackChain);
  });

  it('answers the faces a run of a weight and style falls back to', () => {
    expect(sdk.fallbackChain({ weight: 600, style: 'italic' })).toEqual([
      { family: 'Noto Sans Math', weight: 400, style: 'normal' },
      { family: 'Source Sans 3', weight: 700, style: 'italic' },
    ]);
  });
});
