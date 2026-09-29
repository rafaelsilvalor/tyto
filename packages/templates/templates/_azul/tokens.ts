/**
 * Azul's tokens: values, no logic.
 *
 * Everything here is a constant a designer changes without reading the rest of a template.
 * Colours, the type scale, the slide's frame, the chrome's sizes and the two marks' geometry.
 * Shared by every Azul template through `presets.ts` and `parts.ts`, which is why it sits
 * beside them in `_azul/` rather than inside one template (ADR 0047). The folder
 * has no `manifest.yaml`, so the template registry skips it.
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
import type { Mark } from '@tyto/template-kit';

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
 * A commercial face: Casa holds the licence and the repository is public, so it is
 * read from the rendering machine (ADR 0037) and never committed. A machine without it
 * draws the bundled Source Sans 3 at the nearest weight and says so with
 * `W_FONT_SUBSTITUTED` — which is what CI, having no CircularXX, always does.
 */
export const FACE: FontRef = systemFont('CircularXX');

/** The professor and the handle. */
export const LIGHT = 300;
/** The discipline heading, the date and the session title. */
export const MEDIUM = 500;
/** The approved list's kicker, its ranks and its names. */
export const BOLD = 700;
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

/** The rows of a pill table (`presets.ts`): the badge, the grey pill's padding and lines. */
export const TABLE = {
  /** The blue badge on the left of a row — a date or a rank. Its height is the row minimum. */
  badge: { w: 220, h: 86 },
  /** Room between the grey pill's edge and the words inside it. */
  padding: { top: 12, bottom: 12, left: 32, right: 32 },
  /** Between two stacked lines inside the grey pill. */
  lineGap: 4,
  /** A line's height when its words fit on one line — the published single-line row. */
  line: { title: 30, professor: 28 },
  /** A group heading's box — a discipline's name. Taller than its letters. */
  heading: 78,
} as const;

/** The chrome every slide carries: the owl on top, the handle and the arrow at the foot. */
export const CHROME = {
  /** How tall the owl is drawn. */
  owl: 64,
  /** How tall the footer arrow is drawn. */
  arrow: 26,
  /** The handle is tracked out, so the signature reads quieter than the agenda above it. */
  handleTracking: 4,
} as const;

/** The block on a carousel's first slide: an optional illustration over the cover words. */
/**
 * The approved list (`aprovados`), measured on the maintainer's reference of 2026-09-27 in
 * pixels of a 1080 × 1350 export. Font sizes are read from glyph heights, so they are good to
 * a point or two; the boxes are good to a pixel or two.
 */
export const APPROVED = {
  /** The emblem over the words: 205 × 147 as published; `contain` keeps any other ratio. */
  emblem: { w: 205, h: 147 },
  type: { kicker: 23.5, subtitle: 23.5, exam: 76, specialty: 46, rank: 17, name: 16 },
  /** Boxes: one line of each piece and its leading. */
  box: { kicker: 30, subtitle: 30, exam: 84, specialty: 58 },
  /** The rule between the subtitle and the exam's name. */
  rule: { w: 531, h: 3 },
  gap: {
    /** Emblem → kicker, kicker → subtitle, subtitle → rule, rule → exam, to the glyphs. */
    kicker: 12,
    subtitle: 17,
    rule: 15,
    exam: 19,
    /** The exam's name → the first specialty heading. */
    table: 28,
    /** A specialty heading's box → its first row. */
    heading: 23,
    /** One specialty's last row → the next heading's box. */
    groups: 44,
    /** Between two rows. */
    rows: 5,
  },
  /**
   * The rows: as wide as each list's longest name, and no wider than `max` — past it a name
   * wraps (the maintainer, 2026-09-27). Each list is centred on its own.
   */
  table: { max: 800 },
  badge: { w: 92, h: 39, radius: 19.5 },
  /** The name's line inside the grey pill, and the room before it. */
  line: 20,
  // More room above than below: the names are capitals, which sit high in their line box.
  // 30 after the longest name, measured on the maintainer's mockup of 2026-09-27.
  padding: { top: 8, bottom: 0, left: 15, right: 30 },
} as const;

export const COVER = {
  /** The cover words' box, as a multiple of their size: one line and its leading. */
  boxRatio: 1.3,
  lineHeight: 1.05,
  /** The illustration's square side. */
  illustration: 180,
  /** Between the illustration and the words under it. */
  illustrationGap: 16,
} as const;

/* ------------------------------------------------------------------------ geometry -- */

/**
 * The owl, shared with the other Casa brands since TYTO-200: the geometry is the
 * house's, not Azul's, and each brand fills it with its own colour.
 */
export { OWL } from '../_casa/marks.js';

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
