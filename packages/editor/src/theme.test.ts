import { describe, expect, it } from 'vitest';

import { palette, themeTokens } from './theme.js';

/**
 * What can be said about the theme without a browser.
 *
 * jsdom resolves no `var()`, so whether a colour shows is a question for the window, and
 * whether each name the editor reads is one the host defines is the desktop's
 * `e2e/renderer-tokens.test.ts`. The translucent active line of TYTO-246 moved there with its
 * colours. What is left here is the shape of the contract: every field is one custom property,
 * and the list a host is given is every property the editor reads.
 */

// Read through the bundler, not `node:fs`: this package is DOM-only (ADR 0010).
const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true });

describe('the palette (TYTO-96)', () => {
  it('reads every colour from a --tyto- custom property and writes none of its own', () => {
    for (const value of Object.values(palette)) {
      expect(value).toMatch(/^var\(--tyto-[a-z0-9-]+\)$/);
    }
  });

  it('hands the host every property it reads, the mono face included', () => {
    const fromPalette = Object.values(palette).map((value) => value.slice(4, -1));
    expect(new Set(themeTokens)).toEqual(new Set([...fromPalette, '--tyto-font-mono']));
  });

  it('reads no custom property anywhere else in the package', () => {
    // A `var(--tyto-…)` written outside `theme.ts` would not be in `themeTokens`, and the
    // desktop could not hold its token file to it.
    const readers = Object.entries(sources)
      .filter(([name]) => !name.endsWith('.test.ts') && !name.endsWith('.d.ts'))
      .filter(([, text]) => text.includes('--tyto-'))
      .map(([name]) => name);
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(readers).toEqual(['./theme.ts']);
  });
});
