import { run } from '@tyto/core/template';

import { type Block } from './blocks.js';
import { type FontMetrics, capText } from './cap-text.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

import type { FontRef } from '@tyto/core';

/**
 * The slide counter, `01 I 04`: where this slide stands in its carousel, the current number in
 * its own weight (TYTO-888, ADR 0224). questao-estrategica wrote it by hand from the artwork's
 * index and count; here it is one component over `capText`, placed by its capitals.
 */

/** The numbers a slide counter uses. Its face, weights and colours are the caller's. */
export const SLIDE_COUNTER_PARAMETERS = {
  size: { kind: 'length', default: 28, min: 1, description: 'The type size, in px.' },
  letterSpacing: {
    kind: 'length',
    default: 0,
    description: 'Space added between letters, in px.',
  },
  lineHeight: {
    kind: 'ratio',
    default: 1,
    min: 0.5,
    description: "The line's height, as a multiple of the size.",
  },
  digits: {
    kind: 'length',
    default: 2,
    min: 1,
    description: 'How many digits each number shows, padded with zeros on the left: 2 is `04`.',
  },
} as const satisfies ParameterSchema;

export type SlideCounterParameters = ValuesOf<typeof SLIDE_COUNTER_PARAMETERS>;

/** The counter's face, its weights and its two colours. */
export interface SlideCounterStyle {
  readonly font: FontRef;
  /** The current slide's number. */
  readonly currentWeight: number;
  /** The separator and the total. */
  readonly otherWeight: number;
  /** The current number's colour and the separator's. */
  readonly current: string;
  /** The total's colour. */
  readonly total: string;
}

/**
 * `artwork`'s place as `current SEPARATOR total` on one line from the area's left edge: the
 * current number (`index + 1`) in `currentWeight`, the separator and the total in
 * `otherWeight`, each number padded to `digits`. Its anchor is at its capitals.
 */
export function slideCounter(
  artwork: { readonly index: number; readonly count: number },
  area: Area,
  style: SlideCounterStyle,
  given: Partial<SlideCounterParameters> = {},
  options: {
    readonly name?: string;
    /** Between the two numbers; ` I ` when absent. */
    readonly separator?: string;
    readonly metrics?: FontMetrics;
  } = {},
): Block {
  const values = parameterValues(SLIDE_COUNTER_PARAMETERS, given);
  const pad = (value: number) => String(value).padStart(values.digits, '0');
  const base = { font: style.font, size: values.size };
  return capText(
    [
      run(pad(artwork.index + 1), { ...base, weight: style.currentWeight, color: style.current }),
      run(options.separator ?? ' I ', {
        ...base,
        weight: style.otherWeight,
        color: style.current,
      }),
      run(pad(artwork.count), { ...base, weight: style.otherWeight, color: style.total }),
    ],
    area,
    {
      size: values.size,
      letterSpacing: values.letterSpacing,
      lineHeight: values.lineHeight,
      align: 'left',
    },
    {
      name: options.name ?? 'counter',
      ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    },
  );
}
