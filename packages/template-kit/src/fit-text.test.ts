import { lineBreak, run, text } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { FIT_TEXT_PARAMETERS, fitSizes, fitText } from './fit-text.js';
import { richTextOfPlain } from './highlight.js';
import { parameterValues } from './parameters.js';
import { grownTextBlock, naturalWidth } from './text.js';

import type { TextStyle } from './text.js';
import type { RichText, TextMeasurement, TextRun } from '@tyto/core';
import type { TextDraft } from '@tyto/core/template';

/*
 * The oracles, their size searches copied verbatim from their origin/main:
 * - anuncio `fitted` :1356 and `fitSize` :1377 (0163d78), with `FIT_FLOOR` 0.7 and `LINE_HEIGHT` 1;
 * - voce-conhece `sizesBetween` :136, the cover's lead :302 and `coverTitle` :349 (1e1fabb);
 * - questao-estrategica `examLines` :434 (38ae3a5);
 * - house-style `titleSizeFor` (table.ts:637).
 * Where a search reads its own text node, the node is stood in for by a text of the same words
 * at the same size, width and line height, measured by the stand-in below for both sides: the
 * question each answers is the size, and that is what is compared (the coordinator's ruling on
 * TYTO-889); anuncio draws with the kit's `grownTextBlock`, so its node is compared whole.
 */

const FACE = { family: 'CircularXX', source: 'system' } as const;
const CAP_HEIGHT = 0.709;

/**
 * A stand-in measure: a character is 0.6 em wide; a written line wider than the box wraps into
 * as many lines as it needs, and the text is then as wide as the box.
 */
function measure(node: TextDraft): TextMeasurement {
  const lines: { chars: number; size: number }[] = [{ chars: 0, size: 0 }];
  for (const each of node.runs) {
    if (each.kind === 'break') lines.push({ chars: 0, size: 0 });
    else if (each.kind === 'text') {
      const line = lines[lines.length - 1]!;
      line.chars += [...each.text].length;
      line.size = Math.max(line.size, each.size);
    }
  }
  const box = node.box?.w;
  let count = 0;
  let widest = 0;
  for (const line of lines) {
    const width = line.chars * 0.6 * line.size;
    const wraps = box === undefined ? 1 : Math.max(1, Math.ceil(width / box));
    count += wraps;
    widest = Math.max(widest, wraps > 1 ? box! : width);
  }
  const size = Math.max(...lines.map((line) => line.size));
  return {
    runs: node.runs,
    lines: count,
    width: widest,
    height: count * node.lineHeight * size,
  } as unknown as TextMeasurement;
}

const plainLines = (written: readonly string[], size: number, extra: object = {}): TextDraft => {
  const style = { font: FACE, size, weight: 700, color: '#000000' };
  const [first = '', ...others] = written;
  return text({
    runs: [run(first, style), ...others.flatMap((line) => [lineBreak(), run(line, style)])],
    ...extra,
  });
};

const STYLE: Omit<TextStyle, 'size'> = { font: FACE, weight: 700, color: '#000000' };
const rich = (written: readonly string[]): RichText => richTextOfPlain(written.join('\n'));

/* ------------------------------------------------------------------------ anuncio -- */

const FIT_FLOOR = 0.7;
const LINE_HEIGHT = 1;

function anuncioFitted(words: RichText, setting: { size: number; inner: number }) {
  const style = (size: number): TextStyle => ({ font: FACE, size, weight: 700, color: '#000000' });
  const fitSize = (size: number, width: number): number => {
    const natural = naturalWidth(words, style(size), measure);
    if (natural === undefined || natural <= width) return size;
    return Math.max(size * FIT_FLOOR, (size * width) / natural);
  };
  const size = fitSize(setting.size, setting.inner);
  return grownTextBlock(words, setting.inner, 0, style(size), measure, {
    name: 'titulo',
    align: 'center',
    lineHeight: LINE_HEIGHT,
    overflow: 'grow',
  });
}

describe('oneLine, continuous: anuncio’s fit', () => {
  it.each([
    ['fits as it is', 'CURSO', 80, 700],
    ['shrinks to one line', 'CURSO REGULAR PLUS', 80, 700],
    ['stops at the floor', 'CURSO REGULAR COMPLETO', 80, 700],
    ['stops at the floor and wraps', 'CURSO REGULAR COMPLETO PARA TODOS OS CARGOS', 80, 700],
  ])('draws anuncio’s words exactly when it %s', (_, words, size, inner) => {
    const written = richTextOfPlain(words);
    const kit = fitText(
      written,
      { width: inner, height: Infinity },
      STYLE,
      'oneLine',
      { floor: size * FIT_FLOOR, ceiling: size, step: 0, lineHeight: LINE_HEIGHT, align: 'center' },
      { measure, name: 'titulo', text: { overflow: 'grow' } },
    );
    const oracle = anuncioFitted(written, { size, inner });
    expect({ width: kit.width, height: kit.height, draft: kit.draft }).toEqual(oracle);
  });
});

/* --------------------------------------------------------------------- voce-conhece -- */

function sizesBetween(floor: number, ceilingValue: number): number[] {
  const ceiling = Math.max(floor, ceilingValue);
  const sizes: number[] = [];
  for (let size = ceiling; size > floor; size -= 1) sizes.push(size);
  sizes.push(floor);
  return sizes;
}

const COVER = { leadCapTop: 194, leadLineHeight: 1.2, width: 852, bottom: 1060 } as const;
const TITLE_LINE_HEIGHT = 113.62 / 94.23;

function voceLead(lead: string): number {
  const linesAt = (size: number) =>
    measure(plainLines([lead], size, { box: { w: COVER.width }, lineHeight: COVER.leadLineHeight }))
      .lines;
  const sizes = sizesBetween(32, 47.11);
  return sizes.find((size) => linesAt(size) === 1) ?? sizes[sizes.length - 1]!;
}

function voceCoverTitle(written: readonly string[], capTop: number): number | undefined {
  const sizes = sizesBetween(56, 94.23);
  const layout = (size: number) =>
    measure(plainLines(written, size, { box: { w: COVER.width }, lineHeight: TITLE_LINE_HEIGHT }));
  const foot = (size: number, count: number) =>
    capTop + (count - 1) * size * TITLE_LINE_HEIGHT + size * CAP_HEIGHT;
  const fits = (size: number) => {
    const laid = layout(size);
    return laid.width <= COVER.width + 0.5 && foot(size, laid.lines) <= COVER.bottom;
  };
  return sizes.find((size) => fits(size));
}

describe('voce-conhece’s step rule: from the fractional ceiling, the floor always last', () => {
  it('lists the sizes as `sizesBetween` does', () => {
    expect(fitSizes({ floor: 32, ceiling: 47.11, start: 'ceiling', floorLast: 'always' })).toEqual(
      sizesBetween(32, 47.11),
    );
  });

  it.each(['O QUE É', 'A DIFERENÇA ENTRE CARGO E FUNÇÃO PÚBLICA', 'X'.repeat(60)])(
    'sets the lead at voce-conhece’s size: %s',
    (lead) => {
      const kit = fitText(
        rich([lead]),
        { width: COVER.width, height: Infinity },
        STYLE,
        'oneLine',
        { floor: 32, ceiling: 47.11, lineHeight: COVER.leadLineHeight },
        { measure },
      );
      expect(kit.fit.size).toBe(voceLead(lead));
    },
  );

  it.each([
    [['CARGO', 'E FUNÇÃO']],
    [['A DIFERENÇA ENTRE', 'CARGO, EMPREGO E FUNÇÃO', 'PÚBLICA NA PRÁTICA']],
    [['UMA PALAVRA MUITO LONGA PARA CABER EM QUALQUER LUGAR DESTA CAPA']],
    [['A DIFERENÇA ENTRE CARGO EMPREGO E FUNÇÃO PÚBLICA NO SERVIÇO PÚBLICO FEDERAL BRASILEIRO']],
    [['A'.repeat(100)]],
    [['TEXTO '.repeat(60)]],
  ])('sets the cover title at voce-conhece’s size: %j', (written) => {
    const capTop = 386;
    const kit = fitText(
      rich(written),
      { width: COVER.width, height: COVER.bottom - capTop },
      STYLE,
      'fill',
      { floor: 56, ceiling: 94.23, lineHeight: TITLE_LINE_HEIGHT, measureFrom: 'capitals' },
      { measure },
    );
    const oracle = voceCoverTitle(written, capTop);
    expect(kit.fit.size).toBe(oracle ?? 56);
    expect(kit.fit.overflow > 0).toBe(oracle === undefined);
  });
});

/* -------------------------------------------------------------- questao-estrategica -- */

const EXAM = {
  capTop: 573,
  lineHeight: 129 / 93.28,
  width: 903,
  bottom: 1082,
  estimatedAdvance: 0.6,
};

function questaoExamSize(written: readonly string[]): { size: number; overflow: boolean } {
  const floor = 56;
  const ceiling = Math.max(floor, 112);
  const layout = (size: number) =>
    measure(plainLines(written, size, { box: { w: EXAM.width }, lineHeight: EXAM.lineHeight }));
  const foot = (size: number, lines: number) =>
    EXAM.capTop + (lines - 1) * size * EXAM.lineHeight + size * CAP_HEIGHT;
  const sizes: number[] = [];
  for (let size = Math.floor(ceiling); size >= floor; size -= 1) sizes.push(size);
  const fits = (size: number, keepLines: boolean) => {
    const laid = layout(size);
    return (
      laid.width <= EXAM.width + 0.5 &&
      foot(size, laid.lines) <= EXAM.bottom &&
      (!keepLines || laid.lines <= Math.max(1, written.length))
    );
  };
  const chosen = sizes.find((size) => fits(size, true)) ?? sizes.find((size) => fits(size, false));
  return chosen === undefined ? { size: floor, overflow: true } : { size: chosen, overflow: false };
}

describe('questao-estrategica’s step rule: from the whole ceiling, the floor only on a step', () => {
  it('lists the sizes as `examLines` does', () => {
    const sizes: number[] = [];
    for (let size = Math.floor(80.5); size >= 40.5; size -= 1) sizes.push(size);
    expect(fitSizes({ floor: 40.5, ceiling: 80.5, start: 'whole', floorLast: 'on-step' })).toEqual(
      sizes,
    );
  });

  it.each([
    [['TRF 1']],
    [['TRIBUNAL REGIONAL', 'FEDERAL DA 1ª REGIÃO']],
    [['UMA LINHA LONGA QUE SÓ CABE SE QUEBRAR ENTRE AS PALAVRAS DO TÍTULO']],
    [['A', 'B', 'C', 'D', 'E', 'F', 'G']],
    [['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']],
  ])('sets the exam lines at questao-estrategica’s size: %j', (written) => {
    const reports: number[] = [];
    const kit = fitText(
      rich(written),
      { width: EXAM.width, height: EXAM.bottom - EXAM.capTop },
      STYLE,
      'fill',
      {
        floor: 56,
        ceiling: 112,
        start: 'whole',
        floorLast: 'on-step',
        keepWrittenLines: 'first',
        lineHeight: EXAM.lineHeight,
        measureFrom: 'capitals',
      },
      { measure, report: (problem) => reports.push(problem.overflow ?? 0) },
    );
    const oracle = questaoExamSize(written);
    expect(kit.fit.size).toBe(oracle.size);
    expect(reports.length > 0).toBe(oracle.overflow);
  });
});

/* ---------------------------------------------------------------------- house-style -- */

function titleSizeFor(title: readonly string[], ceiling: number, width: number, limit: number) {
  const floor = 40;
  let low = floor;
  let high = ceiling;
  let best = floor;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const measured = measure(plainLines(title, middle, { box: { w: width }, lineHeight: 1.06 }));
    if (measured === undefined || measured.lines <= limit) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

describe('house-style’s title: the largest whole size within a line cap', () => {
  it.each([
    [['CONCURSOS'], 3],
    [['CONCURSOS ABERTOS EM TODO O BRASIL NESTA SEMANA'], 3],
    [['LINHA UM', 'LINHA DOIS'], 2],
  ])('sets %j at `titleSizeFor`’s size', (title, limit) => {
    const kit = fitText(
      rich(title),
      { width: 600, height: Infinity },
      STYLE,
      'fill',
      {
        floor: 40,
        ceiling: 96,
        start: 'whole',
        floorLast: 'on-step',
        lineCap: limit,
        lineHeight: 1.06,
        widthTolerance: Number.MAX_SAFE_INTEGER,
      },
      { measure },
    );
    expect(kit.fit.size).toBe(titleSizeFor(title, 96, 600, limit));
  });
});

/* ------------------------------------------------------------------------- balance -- */

describe('balance, through fitText', () => {
  it('sets balanced lines at the largest step, ending none on the caller’s words', () => {
    const kit = fitText(
      rich(['Prefeitura Municipal de São Bento do Vale']),
      { width: 600, height: 200 },
      STYLE,
      { kind: 'balance', functionWords: new Set(['de', 'do']) },
      { floor: 20, ceiling: 60, step: 2, lineHeight: 1 },
      { measure },
    );
    const runs = (kit.draft as TextDraft).runs as readonly TextRun[];
    const written = runs.flatMap((each) => (each.kind === 'text' ? [each.text] : []));
    expect(kit.fit.overflow).toBe(0);
    for (const line of written.slice(0, -1)) expect(line).not.toMatch(/ (de|do)$/u);
    expect(kit.fit.lines).toBe(written.length);
  });
});

describe('the width tolerance', () => {
  /** One word that never wraps: as wide as its characters, however narrow the box. */
  const unbreakable = (node: TextDraft): TextMeasurement => {
    const first = node.runs.find((each) => each.kind === 'text');
    const size = first?.kind === 'text' ? first.size : 0;
    const chars = node.runs.reduce(
      (sum, each) => sum + (each.kind === 'text' ? [...each.text].length : 0),
      0,
    );
    return {
      runs: node.runs,
      lines: 1,
      width: chars * 0.6 * size,
      height: size,
    } as unknown as TextMeasurement;
  };

  it('lets a line run up to half a pixel past the area, for a measure’s rounding', () => {
    // At 96 the word is 576 px: 0.3 past a 575.7 px area, within the tolerance.
    const fitted = (widthTolerance: number) =>
      fitText(
        rich(['ABCDEFGHIJ']),
        { width: 575.7, height: Infinity },
        STYLE,
        'fill',
        { floor: 40, ceiling: 96, widthTolerance },
        { measure: unbreakable },
      ).fit.size;
    expect(fitted(0.5)).toBe(96);
    expect(fitted(0)).toBe(95);
  });
});

describe('the parameters', () => {
  it('take neutral defaults', () => {
    expect(parameterValues(FIT_TEXT_PARAMETERS)).toMatchObject({
      floor: 24,
      ceiling: 48,
      step: 1,
      start: 'ceiling',
      floorLast: 'always',
    });
  });
});
