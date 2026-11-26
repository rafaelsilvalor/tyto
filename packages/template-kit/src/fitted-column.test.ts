import { lineBreak, rect, run, text } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import {
  type ColumnStack,
  type ColumnTuning,
  FITTED_COLUMN_PARAMETERS,
  fittedColumn,
} from './fitted-column.js';
import { parameterValues } from './parameters.js';
import { reportOrphan, settle, spaceByWeight } from './rhythm.js';

import type { TemplateContext, TextMeasurement, TextRun } from '@tyto/core';
import type { GroupDraft, NodeDraft, TextDraft } from '@tyto/core/template';

/*
 * The oracle: questao-estrategica's `fitStack` on its origin/main (38ae3a5, src/template.ts
 * :962) and its `drawn`, code copied verbatim. `context` is stood in for by what it reads —
 * `measure`, `report`, and `numberValue` answering the look's numbers — and the slide it stacks
 * by a stand-in `stackAt`, the same one the kit is handed.
 */

type Tuning = ColumnTuning;
type Stacked = ColumnStack;

interface Look {
  readonly numbers: Readonly<Record<string, number>>;
  readonly room: { readonly top: number };
}

interface Context {
  readonly measure: (node: TextDraft) => TextMeasurement | undefined;
  readonly report: TemplateContext['report'];
}

const numberValue = (_context: Context, _name: string, fallback: number): number => fallback;

function fitStack(
  context: Context,
  name: 'statement' | 'explanation',
  stackAt: (tuning: Tuning) => Stacked,
  bottom: number,
  look: Look,
): NodeDraft[] {
  const defaults = look.numbers;
  const floor = numberValue(context, `${name}-floor`, defaults[`${name}-floor`]!);
  const ceiling = Math.max(
    floor,
    numberValue(context, `${name}-ceiling`, defaults[`${name}-ceiling`]!),
  );
  const gapFloor = numberValue(context, 'gap-floor', defaults['gap-floor']!);
  const limits = {
    shrink: numberValue(context, 'orphan-shrink', defaults['orphan-shrink']!),
    tracking: numberValue(context, 'orphan-tracking', defaults['orphan-tracking']!),
  };
  const arrange = (tuning: Tuning) => {
    const stacked = stackAt(tuning);
    const heights = stacked.pieces.map((piece) => piece.height);
    const spaced = spaceByWeight({ top: look.room.top, bottom, heights, weights: stacked.weights });
    return { stacked, spaced, fits: spaced.unit >= gapFloor };
  };
  const plainAt = (size: number): Tuning => ({ size, letterSpacing: 0, extras: [] });

  let fitted: number | undefined;
  for (let size = Math.floor(ceiling); size >= floor && fitted === undefined; size -= 1) {
    if (arrange(plainAt(size)).fits) fitted = size;
  }
  if (fitted === undefined) {
    const arranged = arrange(plainAt(floor));
    const weight = arranged.stacked.weights.reduce((sum, each) => sum + each, 0);
    context.report({
      code: 'W_TEMPLATE_OVERFLOW',
      overflow: (gapFloor - arranged.spaced.unit) * weight,
    });
    return drawn(arranged.stacked, arranged.spaced.tops, look.room.top);
  }

  let tuning = plainAt(fitted);
  const orphans: string[] = [];
  const main = arrange(tuning).stacked.text;
  if (main !== undefined) {
    const settled = settle({
      size: fitted,
      measure: context.measure,
      limits,
      layout: (setting) => {
        const tried = { ...setting, extras: [] };
        const arranged = arrange(tried);
        return { text: arranged.stacked.text ?? main, fits: arranged.fits, laid: tried };
      },
    });
    tuning = settled.laid;
    if (settled.orphan !== undefined) orphans.push(settled.orphan);
  }
  for (const [index, extra] of arrange(tuning).stacked.extras.entries()) {
    const settled = settle({
      size: extra.size,
      measure: context.measure,
      limits: { shrink: 0, tracking: limits.tracking },
      layout: (setting) => {
        const spacing = [...tuning.extras];
        spacing[index] = setting.letterSpacing;
        const rebroken = [...(tuning.extraRuns ?? [])];
        rebroken[index] = setting.runs;
        const tried = { ...tuning, extras: spacing, extraRuns: rebroken };
        const arranged = arrange(tried);
        const read = arranged.stacked.extras[index]?.text ?? extra.text;
        return { text: read, fits: arranged.fits, laid: tried };
      },
    });
    tuning = settled.laid;
    if (settled.orphan !== undefined) orphans.push(settled.orphan);
  }
  for (const word of orphans) reportOrphan(context.report, word);
  const arranged = arrange(tuning);
  return drawn(arranged.stacked, arranged.spaced.tops, look.room.top);
}

function drawn(stacked: Stacked, tops: readonly number[], top: number): NodeDraft[] {
  return stacked.pieces.flatMap((piece, index) => piece.place(tops[index] ?? top));
}

/* --------------------------------------------------------------------- the stand-ins -- */

const FACE = { family: 'CircularXX', source: 'system' } as const;
const WIDTH = 900;

/**
 * A stand-in measure that wraps for real: a character is 0.55 em plus the letter spacing, words
 * go on a line while they fit the box, and the laid runs carry the breaks it decided — what
 * `settle` reads a paragraph's last line from.
 */
function measure(node: TextDraft): TextMeasurement {
  const texts = node.runs.filter((each) => each.kind === 'text');
  const style = texts[0]!;
  const advance = 0.55 * style.size + node.letterSpacing;
  const paragraphs: string[] = [''];
  for (const each of node.runs) {
    if (each.kind === 'break') paragraphs.push('');
    else if (each.kind === 'text') paragraphs[paragraphs.length - 1] += each.text;
  }
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    let line = '';
    for (const word of paragraph.split(' ').filter((each) => each !== '')) {
      const tried = line === '' ? word : `${line} ${word}`;
      if (line !== '' && [...tried].length * advance > (node.box?.w ?? Infinity)) {
        lines.push(line);
        line = word;
      } else line = tried;
    }
    lines.push(line);
  }
  const runs: TextRun[] = lines.flatMap((line, index) => [
    ...(index > 0 ? [lineBreak()] : []),
    run(line, { font: style.font, size: style.size, weight: style.weight, color: style.color }),
  ]);
  return {
    runs,
    lines: lines.length,
    width: Math.max(...lines.map((line) => [...line].length * advance)),
    height: lines.length * node.lineHeight * style.size,
  } as unknown as TextMeasurement;
}

/** A slide: a statement that wraps, a picture of fixed height, and options that follow its size. */
function stackOf(statement: string, options: string, picture: number) {
  return (tuning: Tuning): Stacked => {
    const textAt = (words: string, size: number, spacing: number, runs?: readonly TextRun[]) => {
      const style = { font: FACE, size, weight: 400, color: '#000000' };
      const [first, ...others] = runs ?? [run(words, style)];
      return text({
        name: 'texto',
        runs: [first!, ...others],
        box: { w: WIDTH },
        lineHeight: 1.2,
        letterSpacing: spacing,
      });
    };
    const main = textAt(statement, tuning.size, tuning.letterSpacing, tuning.runs);
    const extra = textAt(
      options,
      tuning.size,
      tuning.extras[0] ?? 0,
      tuning.extraRuns?.[0] ?? undefined,
    );
    const heightOf = (node: TextDraft) => measure(node).lines * 1.2 * tuning.size;
    const piece = (node: TextDraft) => ({
      height: heightOf(node),
      place: (top: number): NodeDraft[] => [{ ...node, transform: { ...node.transform, y: top } }],
    });
    return {
      pieces: [
        piece(main),
        {
          height: picture,
          place: (top) => [
            rect({ name: 'imagem', size: { w: WIDTH, h: picture }, transform: { y: top } }),
          ],
        },
        piece(extra),
      ],
      weights: [0, 2, 2, 1],
      text: main,
      extras: [{ text: extra, size: tuning.size }],
    };
  };
}

const NUMBERS = {
  'statement-floor': 32,
  'statement-ceiling': 64.5,
  'gap-floor': 20,
  'orphan-shrink': 0.08,
  'orphan-tracking': 0.01,
};
const ROOM = { width: 1080, top: 300, bottom: 1200 };

function both(statement: string, options: string, picture: number) {
  const oracleReports: unknown[] = [];
  const kitReports: unknown[] = [];
  const stackAt = stackOf(statement, options, picture);
  const oracle = fitStack(
    { measure, report: (problem) => oracleReports.push(problem) },
    'statement',
    stackAt,
    ROOM.bottom,
    { numbers: NUMBERS, room: { top: ROOM.top } },
  );
  const kit = fittedColumn(
    stackAt,
    ROOM,
    {
      floor: 32,
      ceiling: 64.5,
      start: 'whole',
      floorLast: 'on-step',
      gapFloor: 20,
      orphanShrink: 0.08,
      orphanTracking: 0.01,
    },
    { measure, report: (problem) => kitReports.push(problem) },
  );
  return { oracle, oracleReports, kit, kitReports };
}

const CASES: readonly [string, string, string, number][] = [
  ['fits at its ceiling', 'Qual é o prazo?', 'A) Dez dias. B) Vinte dias.', 200],
  [
    'shrinks to fit',
    'Considere a situação hipotética em que um servidor público federal, ocupante de cargo efetivo, pretende se afastar para cursar mestrado no exterior.',
    'A) Pode, com remuneração. B) Pode, sem remuneração. C) Não pode.',
    300,
  ],
  ['settles the statement’s orphan', 'aaaaaaaaaa bbbbbbbbbb ccc dd', 'Opções curtas', 200],
  ['settles an option’s orphan', 'Qual é o prazo?', 'aaaaaaaaaa bbbbbbbbbb ccc dd', 200],
  ['shrinks a word that cannot move', 'aaaaaaaaaaaaaaaaaaaaaaaaa b', 'Opções', 200],
  [
    'overflows at the floor',
    'Texto muito longo '.repeat(30),
    'Alternativas igualmente longas '.repeat(10),
    500,
  ],
];

describe('the fitted column', () => {
  it.each(CASES)(
    'draws questao-estrategica’s stack exactly when it %s',
    (_, statement, options, picture) => {
      const { oracle, oracleReports, kit, kitReports } = both(statement, options, picture);
      expect((kit.draft as GroupDraft).children).toEqual(oracle);
      expect(kitReports).toEqual(oracleReports);
      expect([kit.width, kit.height]).toEqual([ROOM.width, ROOM.bottom]);
    },
  );

  it('keeps a size whose gap is exactly the floor, as questao-estrategica does', () => {
    // One piece 10 × size tall in 900 px, weights 1 and 1: the unit is (900 − 10 × size) / 2,
    // exactly the 20 px floor at 86.
    const stackAt = (tuning: Tuning): Stacked => ({
      pieces: [
        {
          height: 10 * tuning.size,
          place: (top) => [rect({ name: 'bloco', size: { w: 10, h: 10 }, transform: { y: top } })],
        },
      ],
      weights: [1, 1],
      extras: [],
    });
    const look = {
      numbers: { ...NUMBERS, 'statement-floor': 10, 'statement-ceiling': 100 },
      room: { top: ROOM.top },
    };
    const oracle = fitStack(
      { measure, report: () => undefined },
      'statement',
      stackAt,
      ROOM.bottom,
      look,
    );
    const kit = fittedColumn(
      stackAt,
      ROOM,
      { floor: 10, ceiling: 100, start: 'whole', floorLast: 'on-step', gapFloor: 20 },
      { measure },
    );
    expect(kit.tuning.size).toBe(86);
    expect((kit.draft as GroupDraft).children).toEqual(oracle);
  });

  it('takes neutral defaults', () => {
    expect(parameterValues(FITTED_COLUMN_PARAMETERS)).toMatchObject({
      gapFloor: 24,
      orphanShrink: 0.08,
      orphanTracking: 0.01,
      start: 'ceiling',
      floorLast: 'always',
    });
  });
});
