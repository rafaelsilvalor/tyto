/**
 * Layer 1 of `docs/template-conventions.md`: values, no logic.
 *
 * Everything here is a constant a designer changes without reading the rest of the
 * template. Colours, the type scale, the two marks' geometry, and the margins the
 * composition measures from.
 *
 * ## Geometry in, colour out
 *
 * `OWL` and `ARROW` hold a `d` and the box it was drawn in, and neither holds a colour.
 * The fill is decided where the mark is placed, which is what lets the same owl be blue on
 * paper and white on a dark panel without a second copy of the geometry.
 *
 * **Both are lifted from the brand files**, supplied by the maintainer for TYTO-173. The
 * files themselves are not in this repository; the geometry is, and swapping it again is
 * changing `d` and `box` on these two constants and nothing else: no call site names a
 * coordinate.
 */

import { font } from '@tyto/core/template';

import type { FontRef } from '@tyto/core';

/* ------------------------------------------------------------------------- colour -- */

// Read by eye off the reference slide of 2026-09-22, not off a brand file, which is not in
// this repository. Provisional in the same way the two marks below are.

/** The paper. White, as the published slide is. */
export const PAPER = '#ffffff';

/** The brand blue: the owl, the arrow, the discipline headings, the date pills. */
export const INK = '#009fe3';

/** The cover words. A dark grey, so the blue is kept for what changes week to week. */
export const COVER_INK = '#4a4a4a';

/** The grey pill that holds a session's title and professor. */
export const PILL = '#dddddd';

/** Type on the grey pill. */
export const PILL_INK = '#3c3c3c';

/** Type on a blue field — the date pill, the footer handle. */
export const ON_INK = '#ffffff';

/* --------------------------------------------------------------------------- type -- */

/**
 * One face, two weights.
 *
 * `@tyto/fonts` ships Source Sans 3 in Regular and Bold only, so nothing here asks for an
 * italic or for a third weight: a face that is not on disk is an export that refuses.
 */
export const FACE: FontRef = font('Source Sans 3');

export const REGULAR = 400;
export const BOLD = 700;

/** Sizes, named by what they are rather than by how big they are. */
export const TYPE = {
  cover: 72,
  discipline: 64,
  sessionTitle: 22,
  professor: 22,
  date: 26,
  handle: 26,
} as const;

/* ------------------------------------------------------------------------- spacing -- */

// The spacing below was read off the maintainer's annotated reference of 2026-09-23, in
// pixels of a 1089-wide export, so each is good to a few pixels rather than exact.

/** The side gutter, left and right. */
export const MARGIN = 70;

/** Paper above the header band and below the footer band. */
export const EDGE = { top: 60, bottom: 26 } as const;

/** The two chrome bands: the owl sits in the header, the handle and arrow in the footer. */
export const BAND = { header: 74, footer: 92 } as const;

/** How far apart the pieces of a slide sit. */
export const GAP = {
  /** Between two sessions of one discipline — the published slide's 4 px. */
  sessions: 4,
  /**
   * Between a discipline's heading box and its first session. The box is taller than the
   * letters, so this is about 20 px less than the ~36 px the eye measures to the glyphs.
   */
  heading: 16,
  /** Between the cover words and the first discipline heading below them. */
  cover: 24,
  /**
   * Between the last session of one discipline and the heading of the next — about 36 px
   * to the glyphs once the heading box's own leading above the letters is counted.
   */
  disciplines: 24,
} as const;

/** Corner radius shared by both pills: half their height, so their ends are round. */
export const RADIUS = 43;

/* ------------------------------------------------------------------------ geometry -- */

/** A mark: the box its `d` was drawn in, and the `d` itself. No colour (see above). */
export interface Mark {
  readonly box: { readonly w: number; readonly h: number };
  readonly d: string;
  /**
   * `evenodd` when the shape has holes punched by inner subpaths.
   *
   * Winding order would do it under `nonzero`, but a hole that depends on the direction a
   * subpath happens to run is a hole that closes the first time somebody redraws it.
   */
  readonly fillRule: 'nonzero' | 'evenodd';
}

/**
 * The owl, from the brand file `Marks/SVG/White.svg` (supplied 2026-09-23).
 *
 * Its six distinct subpaths are joined into one `d`, in the file's order. The file draws the
 * body's lower half three times, invisibly, because the fill is opaque over itself; the two
 * repeats are dropped here, before anybody applies opacity and sees them. The file's white
 * fill is dropped too — geometry in, colour out.
 *
 * `nonzero`, as the file is drawn: the pupils are holes by winding direction, and no two of
 * the joined subpaths overlap, so joining them changes nothing a fill rule decides.
 */
export const OWL: Mark = {
  box: { w: 186.09, h: 376.79 },
  d:
    // The right eye, its pupil punched out by winding.
    'M0,0h1v1h-1ZM0,0h1v1h-1Z' +
    // The beak.
    'M0,0h1v1h-1Z' +
    // The left eye.
    'M0,0h1v1h-1ZM0,0h1v1h-1Z' +
    // The left wing.
    'M0,0h1v1h-1Z' +
    // The body's lower half, once.
    'M0,0h1v1h-1Z' +
    // The head and brow.
    'M0,0h1v1h-1Z',
  fillRule: 'nonzero',
};

/**
 * The footer arrow, from the brand file `seta.svg` (supplied 2026-09-23), colour dropped.
 *
 * The head is the file's; the shaft is longer. The published slide draws the same head on
 * a tail about six times the arrow's height, and the file's tail is barely more than one.
 * The shaft is the `H0` run, so lengthening it moves the head right by the same amount and
 * leaves every other coordinate as the file has it.
 */
const ARROW_SHAFT = 2130;
const ARROW_HEAD = 230.92;

export const ARROW: Mark = {
  box: { w: ARROW_SHAFT + ARROW_HEAD, h: 377.81 },
  d:
    `M${ARROW_SHAFT},377.81v-134.18H0v-108.75h${ARROW_SHAFT}` +
    `V0l${ARROW_HEAD},189.26-${ARROW_HEAD},188.55Z`,
  fillRule: 'nonzero',
};

/** The account every slide signs off with. Brand chrome, so the brief never sets it. */
export const HANDLE = '@assinatura';
