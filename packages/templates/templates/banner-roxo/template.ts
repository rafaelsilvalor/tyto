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

/**
 * The logo's colour: the darker of the two purples the backgrounds had it painted in, read off
 * their pixels. The kit's mark is one colour, so one of the two had to be chosen.
 */
const LOGO_INK = '#4c30a6';

/*
 * What the backgrounds held before the logo was painted out of them (TYTO-225), measured on
 * their pixels, for a kit that draws the art as it was (TYTO-230). Boxes are x, y, w, h.
 *
 * | format         | logo box          | wordmark box       |
 * | -------------- | ----------------- | ------------------ |
 * | banner         | 555, 56, 91, 184  | none               |
 * | banner-1x1     | 184, 507, 31, 60  | 226, 513, 188, 49  |
 * | banner-345x146 | 61, 38, 35, 71    | none               |
 *
 * Two tones, `#7560ef` and `#4c30a6`. In every format the lighter one reaches the logo box's
 * edges and the darker one sits inside it: dark within 555, 94, 85, 132 / 184, 519, 28, 44 /
 * 61, 52, 33, 52, by format in the order above. The wordmark's first line is the darker tone
 * (227, 513, 187, 39) and its second the lighter (226, 549, 77, 13).
 */

export const LAYOUTS: Readonly<Record<string, BannerLayout>> = {
  // Under the logo, between the hairline on the left and the lime ring on the right.
  banner: {
    box: { x: 260, y: 332, w: 680, h: 200 },
    sizes: { floor: 40, ceiling: 55.5, step: 0.5 },
    lineHeight: LINE_HEIGHT,
    logo: { x: 555, y: 56, w: 91, h: 184 },
  },
  // The middle of the square, between the lime wave and the logo.
  'banner-1x1': {
    box: { x: 30, y: 210, w: 540, h: 180 },
    sizes: { floor: 36, ceiling: 50, step: 0.5 },
    lineHeight: LINE_HEIGHT,
    logo: { x: 184, y: 507, w: 31, h: 60 },
  },
  // Right of the logo, in the white area before the purple shapes.
  'banner-345x146': {
    box: { x: 129, y: 40, w: 196, h: 66 },
    sizes: { floor: 13, ceiling: 18.5, step: 0.25 },
    lineHeight: LINE_HEIGHT,
    logo: { x: 61, y: 38, w: 35, h: 71 },
  },
};

export const build: TemplateBuild = productBanner({
  ink: ROXO.accent,
  logoInk: LOGO_INK,
  layouts: LAYOUTS,
});
