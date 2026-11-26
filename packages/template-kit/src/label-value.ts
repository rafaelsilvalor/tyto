import { lineBreak, run } from '@tyto/core/template';

import { keepTogetherText } from './keep-together.js';
import { labelOfText } from './label.js';
import { type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

import type { TextRun } from '@tyto/core';

/**
 * Facts written `Label: value`, one per line, as runs: the label in one style and the value in
 * another (TYTO-890). concursos-abertos and concursos-abertos-ec each wrote this, in two
 * different ways; each difference is a parameter here, and either template's runs come out of
 * it unchanged.
 */

/** The numbers and choices labelled facts use. */
export const LABEL_VALUE_PARAMETERS = {
  unlabelled: {
    kind: 'choice',
    default: 'value',
    choices: ['label', 'value'],
    description: 'The style a line with no label is drawn in, whole.',
  },
  labelGap: {
    kind: 'choice',
    default: 'one-space',
    choices: ['as-written', 'one-space'],
    description:
      '`as-written`: the label and the value as the line splits them, an empty value left ' +
      'out. `one-space`: both trimmed, the label followed by one space, the value always ' +
      'written, and a line with no label trimmed.',
  },
  keepTogether: {
    kind: 'choice',
    default: 'no',
    choices: ['yes', 'no'],
    description:
      "Whether the kit's no-break rules (`keepTogetherText`: a currency sign and its amount) " +
      'are applied to each line before it is split.',
  },
} as const satisfies ParameterSchema;

export type LabelValueParameters = ValuesOf<typeof LABEL_VALUE_PARAMETERS>;

/** The run style of a label and of a value. */
export interface LabelValueStyles {
  readonly label: Parameters<typeof run>[1];
  readonly value: Parameters<typeof run>[1];
}

/**
 * `lines` as runs, a line break between two lines, each line split at its label's separator
 * (`labelOfText`). Plain lines: both templates flatten a fact to its words before splitting it.
 * `options.value` rewrites each value before it is drawn — a template's own glue between words
 * that must not break apart, which is its language's vocabulary and not the kit's.
 */
export function labelValueRuns(
  lines: readonly string[],
  styles: LabelValueStyles,
  given: Partial<LabelValueParameters> = {},
  options: { readonly value?: (value: string) => string } = {},
): TextRun[] {
  const values = parameterValues(LABEL_VALUE_PARAMETERS, given);
  const trimmed = values.labelGap === 'one-space';
  const glue = options.value ?? ((value: string) => value);
  return lines.flatMap((written, index) => {
    const line = values.keepTogether === 'yes' ? keepTogetherText(written) : written;
    const { label, text } = labelOfText(line);
    const opening = index > 0 ? [lineBreak()] : [];
    if (label === undefined) {
      const style = values.unlabelled === 'label' ? styles.label : styles.value;
      return [...opening, run(trimmed ? line.trim() : line, style)];
    }
    const value = trimmed ? text.replace(/^\s+/, '') : text;
    return [
      ...opening,
      run(trimmed ? `${label.trim()} ` : label, styles.label),
      ...(!trimmed && value === '' ? [] : [run(glue(value), styles.value)]),
    ];
  });
}
