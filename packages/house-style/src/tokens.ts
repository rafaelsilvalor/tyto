/**
 * The tokens roxo, ocre and vinho share: values, no logic.
 *
 * The three brands draw the weekly mock-exam agenda (TYTO-200) in one look and differ only in
 * their accent and their sign-off, which live in `brands.ts`. Everything here is the same for
 * all three, so it is a constant a designer changes once.
 *
 * ## Where the numbers come from
 *
 * Measured in the pixels of the maintainer's annotated references of 2026-09-28 — the ocre
 * story and grid, scaled from a 738-wide export to 1080, so each is good to a pixel or two —
 * and font sizes solved from those widths against CircularXX itself. The vinho and roxo
 * references were drawn less strictly (their middle is not centred); where they disagree
 * with ocre, ocre wins, as the maintainer named it the reference.
 */

import { systemFont } from '@tyto/core/template';

import type { FontRef } from '@tyto/core';

/* ------------------------------------------------------------------------- colour -- */

/** The paper. */
export const PAPER = '#ffffff';

/** The title: a mid grey, so the accent is kept for what changes week to week. */
export const TITLE_INK = '#7c7c7c';

/** The grey row that holds one mock exam. */
export const ROW = '#e7e7e7';

/** Type on the grey row. */
export const ROW_INK = '#393939';

/** Type on an accent field — the schedule band. */
export const ON_ACCENT = '#ffffff';

/* --------------------------------------------------------------------------- type -- */

/**
 * CircularXX, read from the rendering machine (ADR 0037) as azul's is: a commercial face
 * the repository cannot carry. CI draws the bundled substitute and says so.
 */
export const FACE: FontRef = systemFont('CircularXX');

/** The signature. */
export const LIGHT = 300;
/** A mock exam's name. */
export const BOOK = 400;
/** The title, the call to comment, roxo's story note. */
export const BOLD = 700;
/** The day and the schedule. */
export const BLACK = 900;

/** Sizes, named by what they are. */
export const TYPE = {
  title: 81,
  day: 55,
  schedule: 29,
  exam: 25,
  cta: 29,
  note: 32,
  signature: 28,
} as const;

/** The signature is tracked out, as azul's is, so the signature reads quieter. */
export const SIGNATURE_TRACKING = 7;

/* ------------------------------------------------------------------------- spacing -- */

/**
 * The least room beside the middle: the title wraps and the call to comment stops before it
 * (the maintainer, 2026-09-29: 112). The logo and the sign-off no longer stand on it; they
 * share the middle's left edge (`compose.ts`).
 */
export const MARGIN = 112;

/** Paper above the logo. */
export const EDGE = { top: 75 } as const;

/** How tall the chrome's marks are drawn. */
export const CHROME = { logo: 60 } as const;

/**
 * The room between the middle and whatever stands below it — the signature, or roxo's note.
 * The maintainer's "gap de segurança": the bottom area begins here, and its words sit at
 * its top.
 */
export const SAFETY = 64;

/** The title block over the table. */
export const TITLE = {
  /** A line's box, as a multiple of the size: one line and its leading. */
  lineHeight: 1.2,
  /** Between the title and the first day. */
  gap: 74,
} as const;

/** The table of days and mock exams. */
export const TABLE = {
  /**
   * How wide the rows, bands and headings are: `width` at least, and as wide as the slide's
   * longest exam needs, up to `maxWidth` — past it the name wraps (the maintainer,
   * 2026-09-29). Every row of a slide shares the one width. `maxWidth` is the room between
   * the two 112 gutters, a multiple of 8 as he asked.
   */
  width: 700,
  maxWidth: 856,
  /** The day heading's box: one line of it and its leading. */
  heading: 66,
  /** Day heading → its band. */
  headingGap: 20,
  /** One day's last row → the next day's heading. */
  groupGap: 28,
  /** The schedule band under a day. */
  band: { height: 80, radius: 4, gap: 4 },
  /** A mock exam's row: never shorter than `height`, and `rowGap` from the next. */
  row: { height: 116, gap: 4, line: 30 },
  /** Room between a band's or a row's ends and its words. */
  padding: 29,
} as const;

/** The grid's call to comment: an outlined pill, then the balloon. */
export const CTA = {
  /** The last row → the pill. */
  gap: 104,
  height: 56,
  stroke: 3,
  padding: 22,
  balloon: 37,
  balloonGap: 19,
} as const;

/** The box the signature and the note are laid out in: one line and its leading. */
export const SIGN_OFF_BOX = 40;
