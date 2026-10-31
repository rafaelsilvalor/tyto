import type { Effect } from '@tyto/core';

import type { ShapeRegion } from './svg-shapes.js';
import { cssNumber } from './values.js';

/**
 * A shadow with a spread, as an SVG `<filter>` the stylesheet points at (ADR 0156).
 *
 * CSS `drop-shadow()` has no spread and `box-shadow` follows the border box rather than
 * what the node paints — wrong for a path, a glyph, an image with alpha, a group, and
 * for anything under a translucent fill. So the document carries the primitive chain
 * `export-svg` draws a spread with, in the same order and with the same numbers, and the
 * CSS filter list names it with `url(#…)` where `drop-shadow()` would have been: the two
 * exports then draw one picture, because they run one filter.
 *
 * The region is in user space and covers the frame as the node sees it. The default
 * region is a margin around the element's box, and a group's element is a 0×0 box — the
 * region would be empty and the shadow would vanish with everything else the group draws.
 */
export function spreadShadowFilter(
  effect: Extract<Effect, { kind: 'shadow' }>,
  id: string,
  region: ShapeRegion,
): string {
  const color = effect.color;
  const flood = `#${[color.r, color.g, color.b].map(hex).join('')}`;

  // `feMorphology` takes no negative radius, so a negative spread erodes instead.
  const primitives = [
    `<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="alpha"/>`,
    `<feMorphology in="alpha" operator="${effect.spread > 0 ? 'dilate' : 'erode'}" radius="${cssNumber(Math.abs(effect.spread))}" result="grown"/>`,
    `<feOffset in="grown" dx="${cssNumber(effect.x)}" dy="${cssNumber(effect.y)}" result="moved"/>`,
    // The IR's blur is the standard deviation, as `drop-shadow()` reads it in Chromium,
    // so the spread and the plain shadow blur alike (ADR 0156, 2026-10-31 note).
    `<feGaussianBlur in="moved" stdDeviation="${cssNumber(effect.blur)}" result="blurred"/>`,
    `<feFlood flood-color="${flood}" flood-opacity="${cssNumber(color.a)}" result="flooded"/>`,
    `<feComposite in="flooded" in2="blurred" operator="in" result="shadow"/>`,
    `<feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>`,
  ];

  // Filters interpolate in linearRGB by default, and `feMerge` hands the source back through
  // that round trip at 8 bits a channel, which shifts the shape's own colour (#081c3d
  // came back #0d1c3d). In sRGB the source passes through untouched (TYTO-501).
  return `<filter id="${id}" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" x="${cssNumber(region.x)}" y="${cssNumber(region.y)}" width="${cssNumber(region.w)}" height="${cssNumber(region.h)}">${primitives.join('')}</filter>`;
}

function hex(channel: number): string {
  return channel.toString(16).padStart(2, '0');
}
