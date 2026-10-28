/**
 * The house's marks: geometry every brand of the house draws, in no colour.
 *
 * Each holds a `d` and the box it was drawn in, and the fill is decided where the mark is
 * placed ("Geometry in, colour out", `docs/template-conventions.md`). That is what lets one
 * logo be azul's blue, ocre's ochre, vinho's wine and roxo's purple without four copies of it.
 *
 * The brand's own logo and signature are not here: a brand kit supplies them (ADR 0063), and
 * the placeholders below stand in where none is installed (ADR 0065).
 */

import type { Mark } from '@tyto/template-kit';

/**
 * What stands where the brand's logo goes when no brand kit supplies one (ADR 0065).
 *
 * Invented for this repository and traced from nothing: a rounded rectangle with a round
 * hole near its top, so it reads as "a mark goes here" and not as anybody's mark. Its box is
 * the box the house's logo was drawn in, so every layout that sizes the logo by height places
 * the stand-in in exactly the room the logo takes, and a kit's logo of another shape is what
 * moves a neighbour, never the placeholder.
 */
export const PLACEHOLDER_LOGO: Mark = {
  box: { w: 186.09, h: 376.79 },
  d:
    // The rectangle, its corners rounded by quarter arcs.
    'M24,0H162.09A24,24,0,0,1,186.09,24V352.79A24,24,0,0,1,162.09,376.79' +
    'H24A24,24,0,0,1,0,352.79V24A24,24,0,0,1,24,0Z' +
    // The hole: a circle as two half arcs, punched out by the even-odd rule.
    'M51.05,120A42,42,0,1,0,135.05,120A42,42,0,1,0,51.05,120Z',
  fillRule: 'evenodd',
};

/**
 * What stands where the brand's signature goes when no brand kit supplies one (ADR 0065).
 *
 * Shaped like an account's handle, an at sign and one word, so a layout measured on one is
 * exercised by a line of about the same length. Provisional: the maintainer chooses the words.
 */
export const PLACEHOLDER_SIGNATURE = '@assinatura';

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
