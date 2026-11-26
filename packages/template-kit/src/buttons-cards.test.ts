import { group, rect, solid } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { type Block, block } from './blocks.js';
import { oldButtonRow } from './button-row-before.fixture.js';
import {
  BUTTON_ROW_PARAMETERS,
  type Button,
  type ButtonStyle,
  buttonRow,
  buttonRowIn,
} from './button-row.js';
import { oldCard, oldCardRow } from './card-before.fixture.js';
import {
  CARD_PARAMETERS,
  CARD_ROW_PARAMETERS,
  type CardRowItem,
  type CardSegment,
  type CardStyle,
  card,
  cardIn,
  cardRow,
  cardRowIn,
} from './card.js';
import { parameterValues } from './parameters.js';

import type { TemplateReport } from '@tyto/core';

/*
 * TYTO-891, buttons and cards: `buttonRow`, `card` and `cardRow` are wrappers over area-taking
 * forms now, and must draw what they drew and report what they reported. The oracle is the older
 * code itself, `button-row.ts` and `card.ts` copied whole from origin/main into the
 * `*-before.fixture.ts` files.
 */

const piece = (width: number, height: number, name: string): Block =>
  block(width, height, rect({ name, size: { w: width, h: height } }));

/** Every report a call makes, in order. */
function reported(draw: (report: (each: TemplateReport) => void) => unknown) {
  const reports: TemplateReport[] = [];
  const drawn = draw((each) => reports.push(each));
  return { drawn, reports };
}

/* -------------------------------------------------------------------- the buttons -- */

const PILL: ButtonStyle = {
  height: 60,
  radius: 30,
  fill: '#123456',
  padding: { left: 24, right: 24 },
  gap: 12,
};
const STYLES: readonly ButtonStyle[] = [
  PILL,
  {
    height: 60,
    radius: 30,
    stroke: { color: '#ffffff', width: 2 },
    padding: { left: 24, right: 24 },
    gap: 12,
  },
  { ...PILL, trailing: { width: 60, fill: '#000000', radius: [0, 30, 30, 0] }, height: 70.5 },
];
const BUTTON_SETS: readonly (readonly Button[])[] = [
  [],
  [{ style: PILL, words: piece(120, 24, 'words') }],
  STYLES.map((style, index) => ({
    style,
    words: piece(100 + index * 13.3, 24, 'words'),
    leading: piece(24, 24, 'icon'),
    trailing: piece(18, 18, 'arrow'),
    name: `button-${index}`,
  })),
  [
    { style: PILL, leading: piece(36, 36, 'icon-only') },
    { style: STYLES[2]!, trailing: piece(20, 20, 'arrow') },
  ],
];

describe('buttonRow draws and reports what it drew', () => {
  it('the wrapper and buttonRowIn equal the older row, reports included', () => {
    let compared = 0;
    for (const buttons of BUTTON_SETS) {
      for (const width of [undefined, 1000, 200.5]) {
        for (const arrange of [undefined, 'packed', 'justified'] as const) {
          for (const gap of [0, 16, 7.5]) {
            const options = {
              gap,
              ...(width === undefined ? {} : { width }),
              ...(arrange === undefined ? {} : { arrange }),
              name: 'botoes',
            };
            const before = reported((report) => oldButtonRow(buttons, { ...options, report }));
            const after = reported((report) => buttonRow(buttons, { ...options, report }));
            expect(after).toEqual(before);
            expect(buttonRow(buttons, options)).toEqual(oldButtonRow(buttons, options));
            const drawn = buttonRowIn(
              { width: width ?? Infinity, height: Infinity },
              buttons,
              { gap, ...(arrange === undefined ? {} : { arrange }) },
              { name: 'botoes' },
            );
            expect({ width: drawn.width, height: drawn.height, draft: drawn.draft }).toEqual(
              before.drawn,
            );
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(BUTTON_SETS.length * 3 * 3 * 3);
  });

  it('returns the overflow it used to report', () => {
    const buttons = BUTTON_SETS[2]!;
    const { reports } = reported((report) =>
      oldButtonRow(buttons, { gap: 16, width: 200.5, report }),
    );
    expect(reports).toHaveLength(1);
    expect(buttonRowIn({ width: 200.5, height: Infinity }, buttons, { gap: 16 }).overflow).toBe(
      reports[0]!.overflow,
    );
  });
});

/* ---------------------------------------------------------------------- the cards -- */

const segment = (kind: 'band' | 'plain', height: number, minHeight?: number): CardSegment => ({
  kind,
  content: block(80, height, group({ name: `${kind}-content`, children: [] })),
  ...(minHeight === undefined ? {} : { minHeight }),
});
const CARD: CardStyle = {
  name: 'oferta',
  width: 300,
  radius: 24,
  fill: solid('#ffffff'),
  stroke: { paint: solid('#000000'), width: 2, align: 'inside' },
  band: { fill: solid('#880000'), name: 'faixa' },
};
const SEGMENTS: readonly (readonly CardSegment[])[] = [
  [],
  [segment('band', 40)],
  [segment('plain', 30), segment('band', 50.5, 60), segment('plain', 20)],
  [segment('plain', 10), segment('plain', 20), segment('band', 30)],
];

describe('card and cardRow draw and report what they drew', () => {
  it('card: the wrapper and cardIn equal the older card, reports included', () => {
    for (const segments of SEGMENTS) {
      for (const height of [undefined, 400, 50]) {
        const style: CardStyle = height === undefined ? CARD : { ...CARD, height };
        const before = reported((report) => oldCard(segments, style, report));
        expect(reported((report) => card(segments, style, report))).toEqual(before);
        expect(card(segments, style)).toEqual(oldCard(segments, style));
        const drawn = cardIn({ width: 300, height: height ?? Infinity }, segments, CARD);
        const { overflow, ...rest } = drawn;
        expect(rest).toEqual(before.drawn);
        expect(overflow).toBe(before.reports[0]?.overflow ?? 0);
      }
    }
  });

  it('cardRow: the wrapper and cardRowIn equal the older row, reports included', () => {
    const items: CardRowItem[] = [
      { segments: SEGMENTS[2]!, style: CARD },
      { segments: SEGMENTS[3]!, style: { ...CARD, name: 'outra', height: 180 } },
      { segments: [], style: CARD },
      { segments: SEGMENTS[1]!, style: { ...CARD, radius: 0 } },
    ];
    for (const rowItems of [[], items, items.slice(0, 2)]) {
      for (const gap of [0, 24, 7.25]) {
        const before = reported((report) => oldCardRow(rowItems, gap, report, 'cartoes'));
        expect(reported((report) => cardRow(rowItems, gap, report, 'cartoes'))).toEqual(before);
        expect(cardRow(rowItems, gap)).toEqual(oldCardRow(rowItems, gap));
        const drawn = cardRowIn(
          { width: Infinity, height: Infinity },
          rowItems,
          { gap },
          {
            name: 'cartoes',
          },
        );
        expect({ width: drawn.width, height: drawn.height, draft: drawn.draft }).toEqual(
          before.drawn,
        );
      }
    }
  });

  it('a radius given as a parameter draws what the same radius written in the style drew', () => {
    const segments = SEGMENTS[2]!;
    const drawn = cardIn({ width: 300, height: Infinity }, segments, CARD, { radius: 9 });
    const { overflow: _overflow, ...rest } = drawn;
    expect(rest).toEqual(oldCard(segments, { ...CARD, radius: 9 }));
  });

  it('a row reports how far it runs past a bounded area', () => {
    const items: CardRowItem[] = [
      { segments: SEGMENTS[2]!, style: CARD },
      { segments: SEGMENTS[1]!, style: CARD },
    ];
    expect(cardRowIn({ width: 500, height: Infinity }, items, { gap: 10 }).overflow).toBe(110);
  });
});

describe('the schemas', () => {
  it('take the older forms’ values as defaults', () => {
    expect(parameterValues(BUTTON_ROW_PARAMETERS)).toEqual({ gap: 0, arrange: 'packed' });
    expect(parameterValues(CARD_PARAMETERS)).toEqual({ radius: 0 });
    expect(parameterValues(CARD_ROW_PARAMETERS)).toEqual({ gap: 0 });
  });
});
