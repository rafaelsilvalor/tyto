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

import { systemFont } from '@tyto/core/template';

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
 * The brand's face, CircularXX, in the three weights the maintainer named (TYTO-182).
 *
 * A commercial face: Estratégia holds the licence and the repository is public, so it is
 * read from the rendering machine (ADR 0037) and never committed. A machine without it
 * draws the bundled Source Sans 3 at the nearest weight and says so with
 * `W_FONT_SUBSTITUTED` — which is what CI, having no CircularXX, always does.
 */
export const FACE: FontRef = systemFont('CircularXX');

/** The professor and the handle. */
export const LIGHT = 300;
/** The discipline heading, the date and the session title. */
export const MEDIUM = 500;
/** The cover words. */
export const BLACK = 900;

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
 * The owl, from the brand file `Corujas/SVG/White.svg` (supplied 2026-09-23).
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
    'M137.7,144.78c19.18,0,34.73-15.55,34.73-34.73,0-14.19-8.53-26.38-20.73-31.77-4.92,1.31-9.76,2.8-14.02,4.48-12.76,5.03-24.05,10.18-32.09,14.04-1.69,4.08-2.63,8.55-2.63,13.25,0,19.18,15.55,34.73,34.73,34.73h0ZM137.7,102.33c4.26,0,7.72,3.46,7.72,7.72s-3.46,7.72-7.72,7.72-7.72-3.46-7.72-7.72,3.46-7.72,7.72-7.72Z' +
    // The beak.
    'M93.07,153.61l9.62-13.14c1.43-2.65.95-5.93-1.18-8.06l-8.44-8.44-8.48,8.48c-2.11,2.11-2.58,5.35-1.17,7.98l9.65,13.19h0Z' +
    // The left eye.
    'M48.97,82.76c-3.91-1.7-8.75-3.22-13.84-4.56-12.3,5.35-20.91,17.59-20.91,31.85,0,19.18,15.55,34.73,34.73,34.73s34.73-15.55,34.73-34.73c0-4.48-.88-8.75-2.42-12.68-7.4-3.5-18.2-8.48-32.29-14.61ZM48.96,117.77c-4.26,0-7.72-3.46-7.72-7.72s3.46-7.72,7.72-7.72,7.72,3.46,7.72,7.72-3.46,7.72-7.72,7.72Z' +
    // The left wing.
    'M58.67,317.78c23.87-25.05,38.71-62.83,38.71-98.15,0-5.46-1.17-17.1-1.17-17.1l-3.15.06c-4.23,0-8.39-.31-12.47-.84C39.54,196.33,6.82,164.55,0,123.96v222.43c7.36-.23,14.46-1.57,21.26-3.86,13.93-6.08,26.54-14.5,37.41-24.74h0Z' +
    // The body's lower half, once.
    'M102.68,202.04c.79,6.12,1.18,11.88,1.18,17.59,0,31.91-10.99,64.93-30.14,90.59-20.03,26.82-46.13,41.87-73.72,42.66v23.91c109.78-18.27,184.42-80.24,186.08-252.61-2.26,13.22-7.24,25.5-14.38,36.23-15.24,22.9-40.22,38.72-69.02,41.64h0Z' +
    // The head and brow.
    'M93.06,0C51.1,0,15.17,28.14.03,64.62c0,0,18.87,2.38,35.1,6.65,5.09,1.34,9.93,2.86,13.84,4.56,14.09,6.13,24.89,11.11,32.29,14.61,7.77,3.68,11.78,5.72,11.78,5.72,0,0,4.75-2.54,12.56-6.29,8.04-3.86,19.33-9.01,32.09-14.04,4.26-1.68,9.1-3.17,14.02-4.48,16.68-4.44,34.38-6.74,34.38-6.74C170.94,28.14,135.01,0,93.06,0Z',
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
export const HANDLE = '@estrategia.saude';
