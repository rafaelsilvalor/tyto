/**
 * `banner-roxo` — roxo's product banner (TYTO-210): one text over a fixed
 * background, in 1200×628, 600×600 and 345×146.
 *
 * The piece is drawn by `_casa/banner.ts`; this template is its boxes, measured from
 * the maintainer's three references of 2026-10-03 (the agency text): the text's centre, the
 * room the white area leaves it, and its size there. The reference sizes are the ceilings, so
 * a short name is drawn as large as the reference draws a long one and never larger.
 */

import { ROXO } from '../_casa/brands.js';
import { productBanner } from '../_casa/banner.js';

import type { BannerLayout } from '../_casa/banner.js';
import type { TemplateBuild } from '@tyto/core';

/** The reference's line pitch over its size, the same in all three: 65.5 / 55.5, 59 / 49.8. */
const LINE_HEIGHT = 1.18;

export const LAYOUTS: Readonly<Record<string, BannerLayout>> = {
  // Under the owl, between the hairline on the left and the lime ring on the right.
  banner: {
    box: { x: 260, y: 332, w: 680, h: 200 },
    sizes: { floor: 40, ceiling: 55.5, step: 0.5 },
    lineHeight: LINE_HEIGHT,
  },
  // The middle of the square, between the lime wave and the logo.
  'banner-1x1': {
    box: { x: 30, y: 210, w: 540, h: 180 },
    sizes: { floor: 36, ceiling: 50, step: 0.5 },
    lineHeight: LINE_HEIGHT,
  },
  // Right of the owl, in the white area before the purple shapes.
  'banner-345x146': {
    box: { x: 129, y: 40, w: 196, h: 66 },
    sizes: { floor: 13, ceiling: 18.5, step: 0.25 },
    lineHeight: LINE_HEIGHT,
  },
};

export const build: TemplateBuild = productBanner({ ink: ROXO.accent, layouts: LAYOUTS });
