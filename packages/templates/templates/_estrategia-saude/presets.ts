/**
 * Estratégia Saúde's configurations of the kit's components (ADR 0039).
 *
 * A preset is a component in this brand's look: which columns, which pills, which colours.
 * It holds no number of its own — every size is a token — so changing the look of every
 * Saúde table is a change to `tokens.ts`, and changing what a table *is* is a change here.
 */

import {
  APPROVED,
  BLACK,
  BOLD,
  COVER,
  COVER_INK,
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

import type { Inline, RichText } from '@tyto/core';
import type { LabelColumn, PillTableStyle, TextStyle, TitleBlockStyle } from '@tyto/template-kit';

const style = (size: number, weight: number, color: string): TextStyle => ({
  font: FACE,
  size,
  weight,
  color,
});

/** The blue pill on the left of a row, holding one field centred on the row. */
function badge(options: {
  readonly name: string;
  readonly text: string;
  readonly width: number;
  readonly radius: number;
  readonly style: TextStyle;
  readonly rewrite?: LabelColumn['text']['rewrite'];
}): LabelColumn {
  return {
    kind: 'label',
    name: options.name,
    width: options.width,
    shape: { fill: INK, radius: options.radius },
    text: {
      name: options.text,
      style: options.style,
      align: 'center',
      valign: 'middle',
      ...(options.rewrite === undefined ? {} : { rewrite: options.rewrite }),
    },
  };
}

/* ------------------------------------------------------------------------ the agenda -- */

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
    badge({
      name: 'date-pill',
      text: 'date',
      width: TABLE.badge.w,
      radius: RADIUS,
      style: style(TYPE.date, MEDIUM, ON_INK),
    }),
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

/** The agenda's cover: the calendar illustration over the cover words. */
export const coverTitle: TitleBlockStyle = {
  name: 'cover',
  parts: [
    {
      kind: 'image',
      field: 'ilustracao',
      name: 'illustration',
      size: { w: COVER.illustration, h: COVER.illustration },
    },
    {
      kind: 'text',
      field: 'titulo',
      name: 'cover-title',
      style: style(TYPE.cover, BLACK, COVER_INK),
      height: Math.round(TYPE.cover * COVER.boxRatio),
      lineHeight: COVER.lineHeight,
      gapAbove: COVER.illustrationGap,
    },
  ],
};

/* ----------------------------------------------------------------- the approved list -- */

/** The words after a rank in its badge: `1º` is drawn `1º Lugar`. */
const PLACE = ' Lugar';

/**
 * A field with words appended, as a text inline at the field's end.
 *
 * The range is the empty one at the end of the field, so a warning about the cell still
 * points inside the directive the author wrote.
 */
function followedBy(words: string): (value: RichText) => RichText {
  return (value) => {
    const end = value[value.length - 1]?.range.end ?? 0;
    const tail: Inline = { kind: 'text', value: words, range: { start: end, end } };
    return [...value, tail];
  };
}

/** A field in capitals, as the published list sets every name, whatever the brief typed. */
function capitals(value: RichText): RichText {
  return value.map((inline) =>
    inline.kind === 'text' ? { ...inline, value: inline.value.toLocaleUpperCase('pt-BR') } : inline,
  );
}

/**
 * The approved list: `rank | name`, grouped under specialty headings.
 *
 * Measured on the maintainer's reference of 2026-09-27: the same overlap as
 * {@link sessionTable}, at less than half its size — a 92 × 39 badge on a grey pill 457 wide.
 * The brief writes `1º`; the badge draws `1º Lugar`.
 */
export const approvedTable: PillTableStyle = {
  layering: 'overlap',
  rowGap: APPROVED.gap.rows,
  minRowHeight: APPROVED.badge.h,
  columns: [
    badge({
      name: 'rank-pill',
      text: 'rank',
      width: APPROVED.badge.w,
      radius: APPROVED.badge.radius,
      style: style(APPROVED.type.rank, BOLD, ON_INK),
      rewrite: followedBy(PLACE),
    }),
    {
      kind: 'lines',
      name: 'name-pill',
      width: 'fill',
      shape: { fill: PILL, radius: APPROVED.badge.radius },
      padding: APPROVED.padding,
      lineGap: 0,
      lines: [
        {
          name: 'name',
          style: style(APPROVED.type.name, BOLD, PILL_INK),
          minHeight: APPROVED.line,
          rewrite: capitals,
        },
      ],
    },
  ],
  groups: {
    heading: {
      name: 'specialty',
      height: APPROVED.box.specialty,
      style: style(APPROVED.type.specialty, BOLD, INK),
      align: 'center',
      overflow: 'shrink',
    },
    headingGap: APPROVED.gap.heading,
    gap: APPROVED.gap.groups,
  },
  names: {
    table: 'approved-table',
    group: 'specialty-group',
    rows: 'approved',
    row: 'approved-row',
  },
};

/** The approved list's title: emblem, kicker, subtitle, rule, and the exam's name. */
export const resultTitle: TitleBlockStyle = {
  name: 'result-title',
  parts: [
    { kind: 'image', field: 'emblema', name: 'emblem', size: APPROVED.emblem },
    {
      kind: 'text',
      field: 'chamada',
      name: 'kicker',
      style: style(APPROVED.type.kicker, MEDIUM, COVER_INK),
      height: APPROVED.box.kicker,
      gapAbove: APPROVED.gap.kicker,
    },
    {
      kind: 'text',
      field: 'subtitulo',
      name: 'subtitle',
      style: style(APPROVED.type.subtitle, LIGHT, COVER_INK),
      height: APPROVED.box.subtitle,
      gapAbove: APPROVED.gap.subtitle,
    },
    {
      kind: 'rule',
      name: 'rule',
      width: APPROVED.rule.w,
      thickness: APPROVED.rule.h,
      color: COVER_INK,
      gapAbove: APPROVED.gap.rule,
    },
    {
      kind: 'text',
      field: 'titulo',
      name: 'exam',
      style: style(APPROVED.type.exam, BOLD, INK),
      height: APPROVED.box.exam,
      lineHeight: 1,
      overflow: 'shrink',
      gapAbove: APPROVED.gap.exam,
    },
  ],
};
