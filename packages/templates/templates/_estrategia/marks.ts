/**
 * The Estratégia house's marks: geometry every brand of the house draws, in no colour.
 *
 * Each holds a `d` and the box it was drawn in, and the fill is decided where the mark is
 * placed ("Geometry in, colour out", `docs/template-conventions.md`). That is what lets one
 * owl be Saúde's blue, Carreira Jurídica's ochre, OAB's wine and Concursos' purple without
 * four copies of it.
 *
 * The brand files themselves are not in this repository; their geometry is, and swapping a
 * mark is changing its `d` and `box` here and nothing else.
 */

import type { Mark } from '@tyto/template-kit';

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
