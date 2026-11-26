import { lineBreak, rect, run, solid, text as textNode } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { at as placeAt } from './blocks.js';
import {
  HUGGED_TEXT_PARAMETERS,
  PADDED_CARD_PARAMETERS,
  huggedText,
  paddedCard,
} from './hug-card.js';
import { keepTogetherText } from './keep-together.js';
import { labelOfText } from './label.js';
import { labelValueRuns } from './label-value.js';
import { parameterValues } from './parameters.js';

import type { TextMeasurement, TextRun } from '@tyto/core';
import type { GroupDraft, NodeDraft, TextDraft } from '@tyto/core/template';

/*
 * The oracle: concursos-abertos' fact card on its origin/main (b56819c, src/template.ts `card`
 * :468, `hug` :557, `SHADOW` :581, `estimatedWidth`, and the connector glue `keepTogether`
 * :670 with `wordsOf` and `unbreakable`), code copied verbatim. `context` is stood in for by
 * what the card reads: `measure`, and `numberValue` answering the declared defaults.
 */

const FACE = { family: 'CircularXX', source: 'system' } as const;
const LIGHT = 300;
const MEDIUM = 500;
const ASCENT = 0.75;
const DESCENT = 0.25;
const CAP_HEIGHT = 0.709;
const SLIDE_WIDTH = 1080;
const NO_BREAK_SPACE = '\u00a0';

function capOffset(size: number, lineHeight: number): number {
  return size * ((lineHeight - (ASCENT + DESCENT)) / 2 + (ASCENT - CAP_HEIGHT));
}

const NUMBER_DEFAULTS = { 'card-padding': 64, 'card-max-width': 780 } as const;
const EXAM = { factSize: 40, factLineHeight: 1.2, estimatedAdvance: 0.55 } as const;
const INKS: Record<string, string> = {
  card: '#ffffff',
  'label-ink': '#00a0df',
  'value-ink': '#646464',
};
type Ink = (name: string) => string;
const testInk: Ink = (name) => INKS[name]!;

interface Context {
  readonly measure: (node: TextDraft) => TextMeasurement | undefined;
}
const numberValue = (_context: Context, _name: string, fallback: number): number => fallback;

type NonEmptyRuns = Parameters<typeof textNode>[0]['runs'];

function card(
  context: Context,
  ink: Ink,
  facts: readonly string[],
  top: number,
): { readonly nodes: NodeDraft[]; readonly foot: number } | undefined {
  const runs = facts.flatMap((line, index) => {
    const fact = labelOfText(keepTogetherText(line));
    const label = fact.label ?? fact.text;
    const detail = fact.label === undefined ? '' : fact.text;
    return [
      ...(index > 0 ? [lineBreak()] : []),
      run(label, { font: FACE, size: EXAM.factSize, weight: MEDIUM, color: ink('label-ink') }),
      ...(detail === ''
        ? []
        : [
            run(keepTogether(detail), {
              font: FACE,
              size: EXAM.factSize,
              weight: LIGHT,
              color: ink('value-ink'),
            }),
          ]),
    ];
  });
  const [first, ...others] = runs;
  if (first === undefined) return undefined;

  const padding = numberValue(context, 'card-padding', NUMBER_DEFAULTS['card-padding']);
  const widest =
    numberValue(context, 'card-max-width', NUMBER_DEFAULTS['card-max-width']) - padding * 2;
  const pitch = EXAM.factSize * EXAM.factLineHeight;
  const draft = (
    box: { readonly w?: number },
    at = { x: 0, y: 0 },
    written: NonEmptyRuns = [first, ...others],
  ) =>
    textNode({
      name: 'fatos',
      runs: written,
      box,
      lineHeight: EXAM.factLineHeight,
      overflow: 'grow',
      transform: at,
    });

  const fit = hug((w) => context.measure(draft(w === undefined ? {} : { w })), widest);
  const width = fit?.width ?? Math.min(widest, Math.ceil(estimatedWidth(facts)));
  const lineCount = fit?.lines ?? facts.length;
  const wrapped = fit?.wrappedRuns;

  const size = {
    w: width + padding * 2,
    h: (lineCount - 1) * pitch + EXAM.factSize * CAP_HEIGHT + padding * 2,
  };
  const left = Math.round((SLIDE_WIDTH - size.w) / 2);
  const capTop = top + padding;
  const nodes = [
    rect({
      name: 'card',
      size,
      radius: 32,
      fill: solid(ink('card')),
      effects: [SHADOW],
      transform: { x: left, y: top },
    }),
    draft(
      { w: width + 1 },
      { x: left + padding, y: capTop - capOffset(EXAM.factSize, EXAM.factLineHeight) },
      wrapped,
    ),
  ];
  return { nodes, foot: top + size.h };
}

function hug(
  measure: (w?: number) => TextMeasurement | undefined,
  widest: number,
):
  | { readonly width: number; readonly lines: number; readonly wrappedRuns?: NonEmptyRuns }
  | undefined {
  const natural = measure();
  if (natural === undefined) return undefined;
  if (natural.width <= widest) return { width: Math.ceil(natural.width), lines: natural.lines };
  const laid = measure(widest);
  if (laid === undefined) return { width: widest, lines: natural.lines };
  const [first, ...others] = laid.runs;
  return {
    width: Math.min(widest, Math.ceil(laid.width)),
    lines: laid.lines,
    ...(first === undefined ? {} : { wrappedRuns: [first, ...others] }),
  };
}

const SHADOW = {
  kind: 'shadow',
  x: 4,
  y: 6.9,
  blur: 8,
  spread: 0,
  color: { r: 0, g: 0, b: 0, a: 0.35 },
} as const;

function estimatedWidth(facts: readonly string[]): number {
  const longest = Math.max(0, ...facts.map((line) => [...line].length));
  return longest * EXAM.estimatedAdvance * EXAM.factSize;
}

const CONNECTORS = new Set([
  'a',
  'à',
  'ao',
  'as',
  'às',
  'aos',
  'o',
  'os',
  'e',
  'ou',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'em',
  'na',
  'no',
  'nas',
  'nos',
  'com',
  'para',
  'por',
]);

const isConnector = (word: string): boolean =>
  [...word].length === 1 || CONNECTORS.has(word.toLowerCase());

const isDash = (word: string): boolean => /^[-–—]$/.test(word);

const wordsOf = (text: string): string[] =>
  text.split(/[^\S\u00a0]+/).filter((piece) => piece !== '');

function unbreakable(words: readonly string[]): string[][] {
  const pieces: string[][] = [];
  let pending: string[] = [];
  for (const word of words) {
    const last = pieces[pieces.length - 1];
    if (isDash(word) && pending.length === 0 && last !== undefined) {
      last.push(word);
      continue;
    }
    pending.push(word);
    if (!isConnector(word) || isDash(word)) {
      pieces.push(pending);
      pending = [];
    }
  }
  if (pending.length > 0) {
    const last = pieces[pieces.length - 1];
    if (last === undefined) pieces.push(pending);
    else last.push(...pending);
  }
  return pieces;
}

function keepTogether(text: string): string {
  const leading = /^\s/.test(text) ? ' ' : '';
  const words = wordsOf(text);
  return (
    leading +
    unbreakable(words)
      .map((piece) => piece.join(NO_BREAK_SPACE))
      .join(' ')
  );
}

/* ------------------------------------------------------------------------ the kit -- */

/**
 * A stand-in for the measuring host, the same for the oracle and the kit: 20 px a character,
 * and a text wider than its box wrapped once, after its first run, to a width with a fraction.
 */
function fakeMeasure(node: TextDraft): TextMeasurement {
  const widths = [0];
  for (const each of node.runs) {
    if (each.kind === 'break') widths.push(0);
    else if (each.kind === 'text') widths[widths.length - 1]! += [...each.text].length * 20;
  }
  const natural = Math.max(...widths) + 0.4;
  const box = node.box?.w;
  if (box === undefined || natural <= box) {
    return { runs: node.runs, lines: widths.length, width: natural } as unknown as TextMeasurement;
  }
  const [head, ...tail] = node.runs;
  return {
    runs: [head, lineBreak(), ...tail],
    lines: widths.length + 1,
    width: box - 37.4,
  } as unknown as TextMeasurement;
}

function kitCard(facts: readonly string[], top: number, measure?: Context['measure']) {
  const runs = labelValueRuns(
    facts,
    {
      label: { font: FACE, size: EXAM.factSize, weight: MEDIUM, color: testInk('label-ink') },
      value: { font: FACE, size: EXAM.factSize, weight: LIGHT, color: testInk('value-ink') },
    },
    { unlabelled: 'label', labelGap: 'as-written', keepTogether: 'yes' },
    { value: keepTogether },
  );
  const [first, ...others] = runs;
  const content = huggedText(
    [first!, ...others],
    780 - 64 * 2,
    { size: EXAM.factSize, lineHeight: EXAM.factLineHeight },
    { name: 'fatos', text: { overflow: 'grow' }, ...(measure === undefined ? {} : { measure }) },
  );
  const drawn = paddedCard(
    content,
    { fill: solid(testInk('card')), shadow: SHADOW.color },
    {
      paddingTop: 64,
      paddingRight: 64,
      paddingBottom: 64,
      paddingLeft: 64,
      radius: 32,
      measureFrom: 'capitals',
      shadowX: SHADOW.x,
      shadowY: SHADOW.y,
      shadowBlur: SHADOW.blur,
      shadowSpread: SHADOW.spread,
    },
  );
  return { drawn, placed: placeAt(Math.round((SLIDE_WIDTH - drawn.width) / 2), top, drawn) };
}

/** Every drawn node under `node`, moved by the groups above it. */
function leaves(node: NodeDraft, dx = 0, dy = 0): NodeDraft[] {
  const x = node.transform.x + dx;
  const y = node.transform.y + dy;
  if (node.kind === 'group') {
    return (node as GroupDraft).children.flatMap((child) => leaves(child, x, y));
  }
  return [{ ...node, transform: { ...node.transform, x, y } }];
}

/** Equal but for float rounding in positions and sizes, which the two add in other orders. */
function expectSameNode(kit: NodeDraft, oracle: NodeDraft): void {
  const strip = (node: NodeDraft) => {
    const { transform, ...rest } = node as NodeDraft & { size?: { w: number; h: number } };
    const { size, ...others } = rest as typeof rest & { size?: { w: number; h: number } };
    return { others, transform, size };
  };
  const a = strip(kit);
  const b = strip(oracle);
  expect(a.others).toEqual(b.others);
  expect({ ...a.transform, x: 0, y: 0 }).toEqual({ ...b.transform, x: 0, y: 0 });
  expect(Math.abs(a.transform.x - b.transform.x)).toBeLessThan(1e-9);
  expect(Math.abs(a.transform.y - b.transform.y)).toBeLessThan(1e-9);
  if (b.size !== undefined) {
    expect(Math.abs(a.size!.w - b.size.w)).toBeLessThan(1e-9);
    expect(Math.abs(a.size!.h - b.size.h)).toBeLessThan(1e-9);
  }
}

const FACTS: readonly [string, readonly string[]][] = [
  ['two short facts', ['Vagas: 120', 'Salário: até R$ 9.000']],
  ['a fact without a label', ['Inscrições abertas', 'Banca: Cebraspe']],
  ['a fact too wide for the card', ['Escolaridade: nível superior em qualquer área de formação']],
  ['a label with nothing after it', ['Cargos:', 'Analista e técnico']],
];

describe('the hugging card', () => {
  it.each(FACTS)('draws concursos-abertos’ fact card exactly for %s', (_, facts) => {
    for (const measure of [fakeMeasure, undefined]) {
      const context = { measure: measure ?? (() => undefined) };
      const oracle = card(context, testInk, facts, 640)!;
      const { drawn, placed } = kitCard(facts, 640, measure);
      const [surface, words] = leaves(placed);
      expectSameNode(surface!, oracle.nodes[0]!);
      expectSameNode(words!, oracle.nodes[1]!);
      expect(Math.abs(640 + drawn.height - oracle.foot)).toBeLessThan(1e-9);
    }
  });

  it('is as wide as its widest line and padding, capped at the maximum', () => {
    const runs: [TextRun, ...TextRun[]] = [
      run('abcde', { font: FACE, size: 40, weight: LIGHT, color: '#000000' }),
    ];
    const short = huggedText(runs, 500, { size: 40 }, { measure: fakeMeasure });
    expect(short.width).toBe(Math.ceil(5 * 20 + 0.4));
    const long = huggedText(
      [run('x'.repeat(40), { font: FACE, size: 40, weight: LIGHT, color: '#000000' })],
      500,
      { size: 40 },
      { measure: fakeMeasure },
    );
    expect(long.width).toBe(Math.ceil(500 - 37.4));
    expect(paddedCard(short, { fill: solid('#ffffff') }).width).toBe(short.width + 48);
  });

  it('pads from the box by default, and casts no shadow without a colour', () => {
    const content = { width: 100, height: 40, draft: rect({ size: { w: 100, h: 40 } }) };
    const drawn = paddedCard(content, { fill: solid('#ffffff') });
    expect([drawn.width, drawn.height]).toEqual([148, 88]);
    const [surface, inside] = leaves(drawn.draft);
    expect(surface!.effects).toEqual([]);
    expect(inside!.transform).toMatchObject({ x: 24, y: 24 });
  });

  it('takes neutral defaults', () => {
    expect(parameterValues(HUGGED_TEXT_PARAMETERS)).toEqual({
      size: 32,
      lineHeight: 1.2,
      slack: 1,
      estimatedAdvance: 0.55,
    });
    expect(parameterValues(PADDED_CARD_PARAMETERS)).toMatchObject({
      paddingTop: 24,
      radius: 16,
      measureFrom: 'box',
    });
  });
});
