/**
 * `banner-teste` — the pack's test code template (TYTO-436): one text over a flat background,
 * in 1200×628, 600×600 and 345×146.
 *
 * It is here for what only a code template exercises: a build function compiled into the
 * application (ADR 0005), a folder read through `context.files` (ADR 0062), text measured and
 * balanced, a brand kit's logo and wordmark (ADR 0065, ADR 0066). The piece is drawn by
 * `house-style/src/banner.ts`, the same one the house's banner draws from its own repository;
 * the boxes are that banner's, so the tests that check them kept their geometry when the
 * production banner left, and the backgrounds are invented: a pale field and a darker band.
 */

import { productBanner } from '@tyto/house-style';

import type { TemplateBuild } from '@tyto/core';
import type { BannerLayout } from '@tyto/house-style';

/** A line's pitch over its size. */
const LINE_HEIGHT = 1.18;

/** The text's colour, dark on the pale field. */
export const INK = '#2b2d42';

/** The logo's and the wordmark's two tones; a one-shape logo is all `primary`. */
const MARK_INKS = { primary: '#4c30a6', secondary: '#7560ef' } as const;

export const LAYOUTS: Readonly<Record<string, BannerLayout>> = {
  banner: {
    box: { x: 260, y: 332, w: 680, h: 200 },
    sizes: { floor: 40, ceiling: 55.5, step: 0.5 },
    lineHeight: LINE_HEIGHT,
    logo: { x: 555, y: 56, w: 91, h: 184 },
  },
  'banner-1x1': {
    box: { x: 30, y: 210, w: 540, h: 180 },
    sizes: { floor: 36, ceiling: 50, step: 0.5 },
    lineHeight: LINE_HEIGHT,
    logo: { x: 184, y: 507, w: 31, h: 60 },
    wordmark: { x: 226, y: 513, w: 188, h: 49 },
  },
  'banner-345x146': {
    box: { x: 129, y: 40, w: 196, h: 66 },
    sizes: { floor: 13, ceiling: 18.5, step: 0.25 },
    lineHeight: LINE_HEIGHT,
    logo: { x: 61, y: 38, w: 35, h: 71 },
  },
};

export const build: TemplateBuild = productBanner({
  ink: INK,
  markInks: MARK_INKS,
  layouts: LAYOUTS,
});
