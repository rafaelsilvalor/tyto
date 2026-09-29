/**
 * The kit's components in the look Roxo, Ocre and VINHO share
 * (ADR 0047). A preset holds no number of its own; the accent arrives from the brand.
 */

import {
  BLACK,
  BOLD,
  BOOK,
  FACE,
  ON_ACCENT,
  ROW,
  ROW_INK,
  TABLE,
  TITLE,
  TITLE_INK,
  TYPE,
} from './tokens.js';

import type { PillTableStyle, TextStyle } from '@tyto/template-kit';

const style = (size: number, weight: number, color: string): TextStyle => ({
  font: FACE,
  size,
  weight,
  color,
});

/** A mock exam's name on its grey row. */
export const EXAM_STYLE: TextStyle = style(TYPE.exam, BOOK, ROW_INK);

/**
 * The week's mock exams: a day, its schedule on an accent band, one grey row per exam.
 *
 * Written in the brief as `Domingo 26/10 | Aplicação às 08h30 & correção às 14h`, then one
 * line per exam — the heading line carries the band's words, so a line with one separator
 * is a day and a line with none is an exam (`pillTable`'s caption). Every row is the table's
 * width, as the references draw them; the composition picks that width from the longest name
 * (`tableWidth` in `compose.ts`), and a name past the maximum wraps and makes its row taller.
 */
export function examTable(accent: string): PillTableStyle {
  return {
    layering: 'side-by-side',
    rowGap: TABLE.row.gap,
    minRowHeight: TABLE.row.height,
    columns: [
      {
        kind: 'lines',
        name: 'exam-row',
        width: 'fill',
        shape: { fill: ROW, radius: 0 },
        padding: { top: 0, bottom: 0, left: TABLE.padding, right: TABLE.padding },
        lineGap: 0,
        lines: [{ name: 'exam', style: EXAM_STYLE, minHeight: TABLE.row.line }],
      },
    ],
    groups: {
      heading: {
        name: 'day',
        height: TABLE.heading,
        style: style(TYPE.day, BLACK, accent),
        align: 'left',
        overflow: 'shrink',
      },
      headingGap: TABLE.headingGap,
      gap: TABLE.groupGap,
      caption: {
        name: 'schedule-band',
        height: TABLE.band.height,
        // Rounded on top only: the band sits on its rows and reads as their lid.
        shape: { fill: accent, radius: [TABLE.band.radius, TABLE.band.radius, 0, 0] },
        text: { name: 'schedule', style: style(TYPE.schedule, BLACK, ON_ACCENT) },
        padding: { left: TABLE.padding, right: TABLE.padding },
        gap: TABLE.band.gap,
      },
    },
    names: { table: 'exam-table', group: 'exam-day', rows: 'exams', row: 'exam-line' },
  };
}

/** The title's words, drawn in grey whatever the brand. */
export const TITLE_STYLE: TextStyle = style(TYPE.title, BOLD, TITLE_INK);

/** A title line's box height. */
export const TITLE_LINE = Math.round(TYPE.title * TITLE.lineHeight);
