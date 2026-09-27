/**
 * Estratégia Saúde's configurations of the kit's components (ADR 0039).
 *
 * A preset is a component in this brand's look: which columns, which pills, which colours.
 * It holds no number of its own — every size is a token — so changing the look of every
 * Saúde table is a change to `tokens.ts`, and changing what a table *is* is a change here.
 */

import {
  FACE,
  GAP,
  INK,
  LIGHT,
  MEDIUM,
  ON_INK,
  PILL,
  PILL_INK,
  RADIUS,
  TABLE,
  TYPE,
} from './tokens.js';

import type { PillTableStyle, TextStyle } from '@tyto/template-kit';

const style = (size: number, weight: number, color: string): TextStyle => ({
  font: FACE,
  size,
  weight,
  color,
});

/** The blue pill on the left of a row, holding one field centred on the row. */
function badge(name: string, text: string, size: number) {
  return {
    kind: 'label',
    name,
    width: TABLE.badge.w,
    shape: { fill: INK, radius: RADIUS },
    text: { name: text, style: style(size, MEDIUM, ON_INK), align: 'center', valign: 'middle' },
  } as const;
}

/**
 * The agenda's sessions: `date | title | professor`, grouped under discipline headings.
 *
 * The grey pill runs the full width of the row and the blue date pill is laid over its left
 * end, as the published slide draws the two — one shape, no gap between them. A title that
 * wraps makes its pill, and the row, taller (TYTO-184).
 */
export const sessionTable: PillTableStyle = {
  layering: 'overlap',
  rowGap: GAP.sessions,
  minRowHeight: TABLE.badge.h,
  columns: [
    badge('date-pill', 'date', TYPE.date),
    {
      kind: 'lines',
      name: 'session-pill',
      width: 'fill',
      shape: { fill: PILL, radius: RADIUS },
      padding: TABLE.padding,
      lineGap: TABLE.lineGap,
      lines: [
        {
          name: 'session-title',
          style: style(TYPE.sessionTitle, MEDIUM, PILL_INK),
          minHeight: TABLE.line.title,
        },
        {
          name: 'professor',
          style: style(TYPE.professor, LIGHT, PILL_INK),
          minHeight: TABLE.line.professor,
        },
      ],
    },
  ],
  groups: {
    heading: {
      name: 'discipline',
      height: TABLE.heading,
      style: style(TYPE.discipline, MEDIUM, INK),
      align: 'center',
      overflow: 'shrink',
    },
    headingGap: GAP.heading,
    gap: GAP.disciplines,
  },
  names: { table: 'session-table', group: 'discipline-group', rows: 'sessions', row: 'session' },
};

/**
 * The approved list: `rank | name`, one line to a row, no headings.
 *
 * **Provisional.** Built from the maintainer's description on 2026-09-27 ("1º, 2º, 43º" and a
 * person's name), not from a published slide: the same pills as {@link sessionTable} with
 * one line in the grey one. It is tuned against a reference image in the live preview.
 */
export const approvedTable: PillTableStyle = {
  layering: 'overlap',
  rowGap: GAP.sessions,
  minRowHeight: TABLE.badge.h,
  columns: [
    badge('rank-pill', 'rank', TYPE.rank),
    {
      kind: 'lines',
      name: 'name-pill',
      width: 'fill',
      shape: { fill: PILL, radius: RADIUS },
      padding: TABLE.padding,
      lineGap: TABLE.lineGap,
      lines: [
        { name: 'name', style: style(TYPE.name, MEDIUM, PILL_INK), minHeight: TABLE.line.name },
      ],
    },
  ],
  names: { table: 'approved-table', rows: 'approved', row: 'approved-row' },
};
