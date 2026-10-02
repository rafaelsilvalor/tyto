/**
 * The tokens of the one-image table (TYTO-218): values, no logic.
 *
 * ## Where the numbers come from
 *
 * The maintainer's standalone generator (`gerador-tabela-instagram_6.html`, outside the
 * repository) and the art he approved from it for MCA-66477: its page padding, paper, zebra,
 * radius, cell gaps, header and band styles, and handle. What the generator left to a slider
 * — the body size, the title size, the column widths — is not a token here: `table.ts`
 * decides it from the brief by measuring, and only its floors and ceilings live below.
 *
 * Every size that scales with the body is written in `em`, a multiple of the body size, as
 * the generator writes it, so the table keeps its proportions at whatever size it fits at.
 */

/* ------------------------------------------------------------------------- colour -- */

/** The paper. */
export const PAPER = '#fbfbfb';

/**
 * Body text. Black and not the generator's `#1a1a1a`: the MCA card asks for it outright —
 * the grey "is getting blurry in the post".
 */
export const INK = '#000000';

/** Every other body row's cells. The rows between are drawn on the paper. */
export const ZEBRA = '#f2f2f4';

/** Words on an accent field: the header row and a band. */
export const ON_ACCENT = '#ffffff';

/** The handle at the foot: a quiet grey, so it signs without competing. */
export const HANDLE_INK = '#8c8ca1';

/* --------------------------------------------------------------------------- page -- */

/** Paper around everything. */
export const PAGE = { top: 64, side: 64, bottom: 56 } as const;

/** The owl's row: the mark's height, and the room the row takes. */
export const BRAND_ROW = { owl: 92, height: 96 } as const;

/** The handle's row at the foot, its words standing on the row's bottom. */
export const HANDLE = { size: 19, tracking: 0.28, height: 60 } as const;

/* ------------------------------------------------------------------------- title -- */

export const TITLE = {
  /** Line box, as a multiple of the size: tight, as display type is set. */
  lineHeight: 1.06,
  tracking: -0.01,
  /** The most lines the title may take before it is set smaller. */
  maxLines: 3,
  /** The smallest the title is set, whatever the table needs. */
  floor: 40,
  ceiling: 96,
  /**
   * The title is never more than this many times the body size, so a short table does not
   * sit under a shouting title. 62 over 22: the approved MCA-66477 art.
   */
  perBody: 62 / 22,
  /** Room on each side of the title, inside the page's. */
  inset: 20,
  /** Title → table. */
  gap: 20,
} as const;

/* ------------------------------------------------------------------------- table -- */

export const BODY = {
  /** The readable floor: below it the table is drawn anyway, and reported (ADR 0058). */
  floor: 16,
  ceiling: 34,
  /** The fit loop's resolution, in px. */
  step: 0.5,
  lineHeight: 1.25,
  /** Padding inside a cell, in em. */
  padding: { block: 0.8, inline: 0.5 },
} as const;

/** The header row: the body's size, uppercase and tracked out. */
export const HEADER = { tracking: 0.05, lineHeight: 1.2, block: 1.06 } as const;

/** A band across the whole table: bold, uppercase, tracked, a little less tall. */
export const BAND = { tracking: 0.04, block: 0.94, inline: 0.6 } as const;

/** Cell geometry, in px. */
export const CELL = { radius: 4, gapX: 6, gapY: 5 } as const;

/**
 * The sizes used when nothing can measure (no faces in this compile): the approved art's,
 * with equal columns and every cell shrinking into its box.
 */
export const UNMEASURED = { body: 22, title: 62 } as const;

/**
 * The size widths are measured at once and then scaled: a run's advance is linear in its
 * size, so one measurement per string serves every size the fit loop tries.
 */
export const REFERENCE_SIZE = 100;
