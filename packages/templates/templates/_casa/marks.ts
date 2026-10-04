/**
 * The house's marks: geometry every brand of the house draws, in no colour.
 *
 * Each holds a `d` and the box it was drawn in, and the fill is decided where the mark is
 * placed ("Geometry in, colour out", `docs/template-conventions.md`). That is what lets one
 * owl be azul's blue, ocre's ochre, vinho's wine and roxo's purple without
 * four copies of it.
 *
 * The brand files themselves are not in this repository; their geometry is, and swapping a
 * mark is changing its `d` and `box` here and nothing else.
 */

import type { Mark } from '@tyto/template-kit';

/**
 * The owl, from the house's brand file `White.svg` (supplied 2026-09-23).
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
 * The speech balloon beside the grid's call to comment, from the brand file `balloom.svg`
 * (supplied 2026-09-28 for TYTO-200), its `#212121` dropped — geometry in, colour out.
 *
 * One subpath: a circle with its tail to the bottom right.
 */
export const BALLOON: Mark = {
  box: { w: 459.16, h: 459.16 },
  d:
    'M0,229.58c0,126.79,102.79,229.58,229.58,229.58,50.15,0,96.55-16.08,134.31-43.37,' +
    '13.33-9.63,87.41,18,87.41,18,0,0-32.97-72.72-25.59-84.83,21.22-34.79,33.44-75.66,' +
    '33.44-119.39C459.16,102.79,356.37,0,229.58,0S0,102.79,0,229.58Z',
  fillRule: 'nonzero',
};
