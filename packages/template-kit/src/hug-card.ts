import { group, rect, text } from '@tyto/core/template';

import { type Block, anchorOf, at } from './blocks.js';
import { type FontMetrics, capText } from './cap-text.js';
import { type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

import type { Measure, TextBlockOptions } from './text.js';
import type { Color, Paint, TextRun } from '@tyto/core';
import type { NonEmpty } from '@tyto/core/template';

/**
 * A card that hugs what it holds (TYTO-890, ADR 0224), as two siblings of `card`: `huggedText`
 * measures a text as wide as its widest line, up to a limit, and `paddedCard` draws a padded,
 * rounded, optionally shadowed surface around any block. concursos-abertos drew its fact card
 * by hand from both halves; informativo draws its sheet the same way.
 */

/* --------------------------------------------------------------------- hugged text -- */

/** The numbers a hugged text uses. */
export const HUGGED_TEXT_PARAMETERS = {
  size: {
    kind: 'length',
    default: 32,
    min: 1,
    description: "The type size, in px: the anchor's and the estimate's.",
  },
  lineHeight: {
    kind: 'ratio',
    default: 1.2,
    min: 0.5,
    description: 'From one line to the next, as a multiple of the size.',
  },
  slack: {
    kind: 'length',
    default: 1,
    min: 0,
    description:
      "Px the text's box is wider than its widest line, so that line does not wrap on a rounding.",
  },
  estimatedAdvance: {
    kind: 'ratio',
    default: 0.55,
    min: 0,
    description: "A character's advance, in em, when nothing can measure the text.",
  },
} as const satisfies ParameterSchema;

export type HuggedTextParameters = ValuesOf<typeof HUGGED_TEXT_PARAMETERS>;

/**
 * `runs` as a block as wide as its widest line — laid out one line each when they fit
 * `maxWidth`, and otherwise wrapped at `maxWidth` and measured again, so the block hugs the
 * widest line the wrap left and not the box it wrapped in. The breaks the wrap decided are kept,
 * so the narrower box cannot break the lines anywhere else. The text's own box is `slack` wider
 * than the block. With nothing to measure, a line is `estimatedAdvance` em per character.
 */
export function huggedText(
  runs: NonEmpty<TextRun>,
  maxWidth: number,
  given: Partial<HuggedTextParameters> = {},
  options: {
    readonly measure?: Measure;
    readonly name?: string;
    readonly metrics?: FontMetrics;
    /** Any other option of the text node (`overflow`…), passed through. */
    readonly text?: Omit<TextBlockOptions, 'name' | 'lineHeight' | 'transform'>;
  } = {},
): Block {
  const values = parameterValues(HUGGED_TEXT_PARAMETERS, given);
  const draft = (box: { readonly w?: number }) =>
    text({
      ...(options.name === undefined ? {} : { name: options.name }),
      runs,
      box,
      lineHeight: values.lineHeight,
      ...options.text,
    });
  const fit = hugWidth((w) => options.measure?.(draft(w === undefined ? {} : { w })), maxWidth);
  const lines = runs.filter((each) => each.kind === 'break').length + 1;
  const width = fit?.width ?? Math.min(maxWidth, Math.ceil(estimatedWidth(runs, values)));
  const drawn = capText(
    fit?.wrappedRuns ?? runs,
    { width: width + values.slack, height: Infinity },
    { size: values.size, lineHeight: values.lineHeight },
    {
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
      ...(options.text === undefined ? {} : { text: options.text }),
      lines: fit?.lines ?? lines,
    },
  );
  return { ...drawn, width };
}

/** The widest line's width and the line count, or `undefined` when nothing can measure. */
function hugWidth(
  measure: (w?: number) => ReturnType<Measure>,
  widest: number,
):
  | { readonly width: number; readonly lines: number; readonly wrappedRuns?: NonEmpty<TextRun> }
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

/** The longest written line's characters times an estimated advance. */
function estimatedWidth(runs: readonly TextRun[], values: HuggedTextParameters): number {
  const lines: number[] = [0];
  for (const each of runs) {
    if (each.kind === 'break') lines.push(0);
    else if (each.kind === 'text') lines[lines.length - 1]! += [...each.text].length;
  }
  return Math.max(...lines) * values.estimatedAdvance * values.size;
}

/* ---------------------------------------------------------------------- the card -- */

/** The numbers a padded card uses. Its fill and its shadow's colour are the caller's. */
export const PADDED_CARD_PARAMETERS = {
  paddingTop: { kind: 'length', default: 24, min: 0, description: 'Above the content, in px.' },
  paddingRight: {
    kind: 'length',
    default: 24,
    min: 0,
    description: 'Right of the content, in px.',
  },
  paddingBottom: {
    kind: 'length',
    default: 24,
    min: 0,
    description: 'Below the content, in px.',
  },
  paddingLeft: {
    kind: 'length',
    default: 24,
    min: 0,
    description: 'Left of the content, in px.',
  },
  radius: { kind: 'length', default: 16, min: 0, description: "The card's corners, in px." },
  measureFrom: {
    kind: 'choice',
    default: 'box',
    choices: ['box', 'capitals'],
    description:
      "Where the top and bottom padding start: the content's box, or its first capitals and " +
      'last baseline (ADR 0230).',
  },
  shadowX: { kind: 'length', default: 0, description: "The shadow's offset to the right, in px." },
  shadowY: { kind: 'length', default: 4, description: "The shadow's offset down, in px." },
  shadowBlur: {
    kind: 'length',
    default: 8,
    min: 0,
    description: "The shadow's blur, a standard deviation in px.",
  },
  shadowSpread: {
    kind: 'length',
    default: 0,
    description: 'How much wider than the card the shadow is on every side, in px.',
  },
} as const satisfies ParameterSchema;

export type PaddedCardParameters = ValuesOf<typeof PADDED_CARD_PARAMETERS>;

/** A padded card's colours: its fill, and its shadow's (absent, no shadow). */
export interface PaddedCardPaints {
  readonly fill: Paint;
  readonly shadow?: Color;
}

/**
 * `content` on a rounded card, padded on each side. With `measureFrom: 'capitals'` the top
 * padding runs from the content's first capitals and the bottom from its last baseline, as a
 * reference measures a card of text; with `'box'`, from the content's box. The card's anchor is
 * the content's, moved with it.
 */
export function paddedCard(
  content: Block,
  paints: PaddedCardPaints,
  given: Partial<PaddedCardParameters> = {},
  options: { readonly name?: string; readonly surfaceName?: string } = {},
): Block {
  const values = parameterValues(PADDED_CARD_PARAMETERS, given);
  const anchor = anchorOf(content);
  const capitals = values.measureFrom === 'capitals';
  const inner = capitals ? anchor.baseline - anchor.capTop : content.height;
  const size = {
    w: values.paddingLeft + content.width + values.paddingRight,
    h: values.paddingTop + inner + values.paddingBottom,
  };
  const top = capitals ? values.paddingTop - anchor.capTop : values.paddingTop;
  const shadow =
    paints.shadow === undefined
      ? {}
      : {
          effects: [
            {
              kind: 'shadow' as const,
              x: values.shadowX,
              y: values.shadowY,
              blur: values.shadowBlur,
              spread: values.shadowSpread,
              color: paints.shadow,
            },
          ],
        };
  return {
    width: size.w,
    height: size.h,
    draft: group({
      name: options.name ?? 'padded-card',
      children: [
        rect({
          name: options.surfaceName ?? 'card',
          size,
          radius: values.radius,
          fill: paints.fill,
          ...shadow,
        }),
        at(values.paddingLeft, top, content),
      ],
    }),
    ...(content.anchor === undefined
      ? {}
      : { anchor: { capTop: top + anchor.capTop, baseline: top + anchor.baseline } }),
  };
}
