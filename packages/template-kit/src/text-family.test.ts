import { rect } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { block } from './blocks.js';
import { capOffset } from './cap-text.js';
import { richTextOfPlain } from './highlight.js';
import {
  LEVEL_STACK_PARAMETERS,
  type LevelItem,
  type LevelStackStyle,
  levelStack,
  levelStackIn,
} from './levels.js';
import { parameterValues } from './parameters.js';
import {
  GROWN_TEXT_PARAMETERS,
  TEXT_PARAMETERS,
  type TextBlockOptions,
  type TextStyle,
  grownTextBlock,
  grownTextIn,
  textBlock,
  textIn,
} from './text.js';
import {
  oldGrownTextBlock,
  oldLevelStack,
  oldTextBlock,
  oldTitleBlock,
} from './text-before.fixture.js';
import {
  TITLE_BLOCK_PARAMETERS,
  type TitleBlockStyle,
  titleBlock,
  titleBlockIn,
} from './title-block.js';

import type { AssetRef, RichText, TextMeasurement } from '@tyto/core';
import type { TextDraft } from '@tyto/core/template';

/*
 * TYTO-891, the text family: textBlock, grownTextBlock, titleBlock and levelStack are wrappers
 * over area-taking forms now, and must draw what they drew. The oracle is the older code itself,
 * copied verbatim from origin/main into `text-before.fixture.ts`.
 */

const FACE = { family: 'CircularXX', source: 'system' } as const;
const STYLES: readonly TextStyle[] = [
  { font: FACE, size: 32, weight: 400, color: '#1a2b3c' },
  { font: FACE, size: 25.66, weight: 700, color: '#000000', paragraphSpacing: 12 },
];
const VALUES: readonly RichText[] = [
  [],
  richTextOfPlain('Uma linha'),
  richTextOfPlain('Duas\nlinhas com **ênfase**'),
  richTextOfPlain('Um parágrafo\n\noutro'),
];
const OPTIONS: readonly TextBlockOptions[] = [
  {},
  { name: 'titulo' },
  { name: 'corpo', align: 'center', lineHeight: 1.3, letterSpacing: 0.5 },
  { valign: 'middle', overflow: 'grow', letterSpacing: -1.17 },
  { align: 'justify', valign: 'bottom', overflow: 'shrink', lineHeight: 1 },
];

/** Measures: none, and one that answers lines and a height from the runs it is handed. */
const nothingMeasures = (): undefined => undefined;
function measures(node: TextDraft): TextMeasurement {
  const lines = node.runs.filter((each) => each.kind === 'break').length + 2;
  return {
    runs: node.runs,
    lines,
    width: 300.4,
    height: lines * 41.3,
  } as unknown as TextMeasurement;
}

describe('the older text forms draw what they drew', () => {
  it('textBlock: the wrapper and textIn at its defaults equal the older one', () => {
    let compared = 0;
    for (const value of VALUES) {
      for (const style of STYLES) {
        for (const options of OPTIONS) {
          for (const size of [
            { w: 400, h: 100 },
            { w: 333.3, h: 10 / 3 },
          ]) {
            const before = oldTextBlock(value, size, style, options);
            expect(textBlock(value, size, style, options)).toEqual(before);
            const { lineHeight, letterSpacing, align, valign, overflow, ...rest } = options;
            const given = { lineHeight, letterSpacing, align, valign, overflow };
            const drawn = textIn(
              value,
              { width: size.w, height: size.h },
              style,
              Object.fromEntries(Object.entries(given).filter(([, each]) => each !== undefined)),
              { text: rest },
            );
            expect({ width: drawn.width, height: drawn.height, draft: drawn.draft }).toEqual(
              before,
            );
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(VALUES.length * STYLES.length * OPTIONS.length * 2);
  });

  it('grownTextBlock: the wrapper and grownTextIn equal the older one, measured or not', () => {
    for (const value of VALUES) {
      for (const style of STYLES) {
        for (const options of OPTIONS) {
          for (const measure of [nothingMeasures, measures]) {
            for (const minHeight of [0, 38.4, 200]) {
              const before = oldGrownTextBlock(value, 400, minHeight, style, measure, options);
              expect(grownTextBlock(value, 400, minHeight, style, measure, options)).toEqual(
                before,
              );
            }
          }
        }
      }
    }
  });

  const TITLE: TitleBlockStyle = {
    name: 'titulo',
    parts: [
      { kind: 'image', field: 'brasao', name: 'brasao', size: { w: 120, h: 80 }, gapAbove: 0 },
      {
        kind: 'text',
        field: 'nome',
        name: 'nome',
        style: STYLES[0]!,
        height: 48,
        lineHeight: 1.2,
        gapAbove: 24,
      },
      { kind: 'rule', name: 'filete', width: 200, thickness: 2, color: '#000000', gapAbove: 12.5 },
      {
        kind: 'text',
        field: 'fatos',
        name: 'fatos',
        style: STYLES[1]!,
        height: 60,
        letterSpacing: 0.2,
        overflow: 'grow',
        measured: true,
        gapAbove: 10 / 3,
      },
    ],
  };
  const CREST: AssetRef = { id: 'brasao', source: 'file', path: './b.png', hash: 'sha256-0' };
  const FIELDS = [
    {},
    { nome: richTextOfPlain('Tribunal Regional') },
    { brasao: CREST, nome: richTextOfPlain('TRT\n2ª Região'), fatos: richTextOfPlain('Vagas: 10') },
    { brasao: CREST, fatos: richTextOfPlain('Só fatos') },
  ];

  it('titleBlock: the wrapper and titleBlockIn in box mode equal the older one', () => {
    for (const fields of FIELDS) {
      for (const measure of [undefined, measures]) {
        const content = { fields, width: 600, ...(measure === undefined ? {} : { measure }) };
        const before = oldTitleBlock(TITLE, content);
        expect(titleBlock(TITLE, content)).toEqual(before);
        const drawn = titleBlockIn(
          { width: 600, height: Infinity },
          TITLE,
          fields,
          {},
          {
            ...(measure === undefined ? {} : { measure }),
          },
        );
        expect({ width: drawn.width, height: drawn.height, draft: drawn.draft }).toEqual(before);
      }
    }
  });

  it('levelStack: the wrapper and levelStackIn equal the older one', () => {
    const part = (words: string, level: 0 | 1 | 2, position: 'before' | 'main' | 'after') => ({
      words: richTextOfPlain(words),
      level,
      position,
    });
    const items: LevelItem[] = [
      { kind: 'divider' },
      { kind: 'line', parts: [part('Antes', 2, 'before'), part('Título', 1, 'main')] },
      { kind: 'divider' },
      {
        kind: 'line',
        parts: [part('Um', 0, 'main'), { ...part('junto', 0, 'after'), joined: true }],
      },
      { kind: 'divider' },
    ];
    const look = (each: { level: number }) => ({
      style: STYLES[each.level === 1 ? 1 : 0]!,
      ...(each.level === 2 ? { lineHeight: 1.1, letterSpacing: 0.4 } : {}),
    });
    const styles: LevelStackStyle[] = [
      { name: 'niveis', look, gap: 12 },
      {
        name: 'niveis',
        look,
        gap: (above, below) => (above.level > below.level ? 8.25 : 16),
        lineGap: 30,
        align: 'end',
        divider: (width) => block(width / 2, 2, rect({ size: { w: width / 2, h: 2 } })),
      },
    ];
    for (const style of styles) {
      for (const measure of [nothingMeasures, measures]) {
        for (const list of [items, [], [{ kind: 'divider' } as const]]) {
          const before = oldLevelStack(list, style, 700, measure);
          expect(levelStack(list, style, 700, measure)).toEqual(before);
          const drawn = levelStackIn(
            { width: 700, height: Infinity },
            list,
            style,
            {},
            { measure },
          );
          expect({ width: drawn.width, height: drawn.height, draft: drawn.draft }).toEqual(before);
        }
      }
    }
  });
});

describe('the area-taking text forms', () => {
  it('textIn anchors its first capitals and last baseline, by its vertical alignment', () => {
    const style = STYLES[0]!;
    const value = richTextOfPlain('Uma\nduas');
    const top = textIn(value, { width: 400, height: 200 }, style, { lineHeight: 1.25 });
    const pitch = 32 * 1.25;
    expect(top.anchor).toEqual({
      capTop: capOffset(32, 1.25),
      baseline: capOffset(32, 1.25) + pitch + 32 * 0.709,
    });
    const middle = textIn(value, { width: 400, height: 200 }, style, {
      lineHeight: 1.25,
      valign: 'middle',
    });
    expect(middle.anchor!.capTop).toBeCloseTo((200 - 2 * pitch) / 2 + capOffset(32, 1.25), 12);
  });

  it('textIn reads its lines from the measure, and reports what runs past the box', () => {
    const drawn = textIn(
      richTextOfPlain('Uma'),
      { width: 400, height: 50 },
      STYLES[0]!,
      {},
      {
        measure: measures,
      },
    );
    // The stand-in says two lines, 82.6 px: 32.6 past a 50 px box.
    expect(drawn.overflow).toBeCloseTo(82.6 - 50, 10);
    expect(drawn.anchor!.baseline).toBeCloseTo(capOffset(32, 1.2) + 32 * 1.2 + 32 * 0.709, 12);
  });

  it('grownTextIn grows to its measured height and anchors its measured lines', () => {
    const drawn = grownTextIn(
      richTextOfPlain('Uma'),
      { width: 400, height: 60 },
      STYLES[0]!,
      {},
      {
        measure: measures,
      },
    );
    expect(drawn.height).toBeCloseTo(82.6, 10);
    expect(drawn.overflow).toBeCloseTo(82.6 - 60, 10);
  });

  it('titleBlockIn measured from the capitals runs each gap from a baseline to the next capitals', () => {
    const fields = { nome: richTextOfPlain('Tribunal'), fatos: richTextOfPlain('Vagas: 10') };
    const style: TitleBlockStyle = {
      name: 't',
      parts: [
        { kind: 'text', field: 'nome', name: 'nome', style: STYLES[0]!, height: 48, gapAbove: 0 },
        {
          kind: 'text',
          field: 'fatos',
          name: 'fatos',
          style: STYLES[0]!,
          height: 48,
          gapAbove: 40,
        },
      ],
    };
    const drawn = titleBlockIn({ width: 600, height: Infinity }, style, fields, {
      measureFrom: 'capitals',
    });
    const [, facts] = (drawn.draft as { children: readonly { transform: { y: number } }[] })
      .children;
    const nameBaseline = capOffset(32, 1.2) + 32 * 0.709;
    expect(facts!.transform.y + capOffset(32, 1.2)).toBeCloseTo(nameBaseline + 40, 12);
  });

  it('levelStackIn takes the alignment it is given over the style’s', () => {
    const items: LevelItem[] = [
      { kind: 'line', parts: [{ words: richTextOfPlain('Um'), level: 0, position: 'main' }] },
    ];
    const style: LevelStackStyle = { name: 'n', look: () => ({ style: STYLES[0]! }), gap: 0 };
    expect(levelStackIn({ width: 700, height: Infinity }, items, style, {}).anchor).toBeDefined();
    expect(
      levelStackIn({ width: 700, height: 10 }, items, style, {}, { measure: measures }).overflow,
    ).toBeGreaterThan(0);
  });

  it('take the older forms’ values as defaults', () => {
    expect(parameterValues(TEXT_PARAMETERS)).toEqual({
      lineHeight: 1.2,
      letterSpacing: 0,
      align: 'left',
      valign: 'top',
      overflow: 'clip',
    });
    expect(parameterValues(GROWN_TEXT_PARAMETERS)).toMatchObject({ minHeight: 0, lineHeight: 1.2 });
    expect(parameterValues(TITLE_BLOCK_PARAMETERS)).toEqual({ measureFrom: 'box' });
    expect(parameterValues(LEVEL_STACK_PARAMETERS)).toEqual({ align: 'center' });
  });
});
