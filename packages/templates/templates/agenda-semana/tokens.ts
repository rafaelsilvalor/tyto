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
 * **Both are drawn here rather than lifted from the brand files.** The Estratégia owl and
 * arrow were measured for TYTO-167 — 6 subpaths and 1486 characters for the owl, 70 for
 * the arrow — but the source SVGs are not in this repository, so what follows is geometry
 * written for this card. Swapping in the real artwork is changing `d` and `box` on these
 * two constants and nothing else: no call site names a coordinate.
 */

import { font } from '@tyto/core/template';

import type { FontRef } from '@tyto/core';

/* ------------------------------------------------------------------------- colour -- */

/** The paper. Light, because the artwork's chrome is blue and its pills are grey. */
export const PAPER = '#f2f5fa';

/** The brand blue: the owl, the arrow, the discipline headings, the date pills. */
export const INK = '#12306b';

/** The grey pill that holds a session's title and professor. */
export const PILL = '#e2e8f2';

/** Type on the grey pill. Darker than `INK` so the pill does not read as a second button. */
export const PILL_INK = '#1f2a3d';

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
  cover: 88,
  coverStory: 104,
  discipline: 48,
  sessionTitle: 30,
  professor: 26,
  date: 28,
  handle: 30,
} as const;

/* ------------------------------------------------------------------------- spacing -- */

/** The gutter every format measures from. */
export const MARGIN = 80;

/** How far apart the pieces of a slide sit. */
export const GAP = {
  /** Between the date pill and the grey pill of one session. */
  row: 20,
  /** Between two sessions. */
  sessions: 16,
  /** Between a discipline's heading and its first session. */
  heading: 24,
  /** Between the cover block and the discipline below it. */
  cover: 48,
} as const;

/** Corner radius shared by both pills, so they read as one family. */
export const RADIUS = 16;

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
 * The owl: one silhouette with two eyes and a beak punched out of it.
 *
 * The brand file draws one of its subpaths three times, invisibly, because the fill is
 * opaque over itself. This one does not, which is the state the brand file should arrive
 * in: the duplicates are dropped on the way in, before anybody applies opacity and sees
 * them.
 */
export const OWL: Mark = {
  box: { w: 120, h: 150 },
  d:
    // The silhouette, with the ear tufts cut into the outline rather than laid over it.
    // Under `evenodd` an overlap is a hole, so a tuft drawn as its own triangle on top of
    // the head would punch the head out where the two met.
    'M60 12C74 12 86 20 92 32L106 8L100 44C110 54 116 68 116 88' +
    'C116 122 91 146 60 146C29 146 4 122 4 88C4 68 10 54 20 44' +
    'L14 8L28 32C34 20 46 12 60 12Z' +
    // Each eye is two subpaths: the ring is a hole in the body, the pupil is a hole in the
    // ring, because `evenodd` fills where the crossing count is odd.
    'M27 70a15 15 0 1 0 30 0a15 15 0 1 0-30 0' +
    'M36 70a6 6 0 1 0 12 0a6 6 0 1 0-12 0' +
    'M63 70a15 15 0 1 0 30 0a15 15 0 1 0-30 0' +
    'M72 70a6 6 0 1 0 12 0a6 6 0 1 0-12 0' +
    'M60 90L67 104L53 104Z',
  fillRule: 'evenodd',
};

/** The footer arrow: one shape, one colour, pointing at the handle beside it. */
export const ARROW: Mark = {
  box: { w: 24, h: 24 },
  d: 'M2 11h15.2l-5.6-5.6L13 4l8 8-8 8-1.4-1.4 5.6-5.6H2z',
  fillRule: 'nonzero',
};

/** The account every slide signs off with. Brand chrome, so the brief never sets it. */
export const HANDLE = '@estrategia.saude';
