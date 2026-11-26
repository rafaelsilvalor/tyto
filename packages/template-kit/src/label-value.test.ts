import { lineBreak, run } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { richTextOfPlain } from './highlight.js';
import { keepTogetherText } from './keep-together.js';
import { labelOf, labelOfText } from './label.js';
import { LABEL_VALUE_PARAMETERS, labelValueRuns } from './label-value.js';
import { parameterValues } from './parameters.js';
import { plain } from './rows.js';

import type { RichText, TextRun } from '@tyto/core';

/*
 * The oracles, code copied verbatim from their origin/main:
 * - concursos-abertos-ec `factRuns` :598 (5cd97b1);
 * - concursos-abertos' card runs :474 (b56819c), the `runs` its `card` builds, with its glue.
 * `ink` stands in for their colours.
 */

const FACE = { family: 'CircularXX', source: 'system' } as const;
const LIGHT = 300;
const MEDIUM = 500;
const INKS: Record<string, string> = {
  'body-ink': '#646464',
  ink: '#00a0df',
  'label-ink': '#00a0df',
  'value-ink': '#646464',
};
type Ink = (name: string) => string;
const testInk: Ink = (name) => INKS[name]!;

function factRuns(facts: readonly RichText[], size: number, ink: Ink): TextRun[] {
  const body = { font: FACE, size, weight: LIGHT, color: ink('body-ink') };
  const labelStyle = { ...body, weight: MEDIUM, color: ink('ink') };
  return facts.flatMap((line, index) => {
    const { label, text: rest } = labelOf(line);
    const value = plain(rest).replace(/^\s+/, '');
    return [
      ...(index > 0 ? [lineBreak()] : []),
      ...(label === undefined ? [] : [run(`${plain(label).trim()} `, labelStyle)]),
      run(label === undefined ? plain(line).trim() : value, body),
    ];
  });
}

/** concursos-abertos' card runs, the body of its `card` up to them. */
function abertosRuns(facts: readonly string[], glue: (text: string) => string): TextRun[] {
  return facts.flatMap((line, index) => {
    const fact = labelOfText(keepTogetherText(line));
    const label = fact.label ?? fact.text;
    const detail = fact.label === undefined ? '' : fact.text;
    return [
      ...(index > 0 ? [lineBreak()] : []),
      run(label, { font: FACE, size: 40, weight: MEDIUM, color: testInk('label-ink') }),
      ...(detail === ''
        ? []
        : [
            run(glue(detail), {
              font: FACE,
              size: 40,
              weight: LIGHT,
              color: testInk('value-ink'),
            }),
          ]),
    ];
  });
}

/** A stand-in for concursos-abertos' connector glue: any rewrite the kit must hand the value. */
const glue = (text: string): string => text.replace(/ de /gu, ' de\u00a0');

const LINES: readonly string[][] = [
  ['Vagas: 120', 'Salário: até R$ 9.000'],
  ['Inscrições abertas', '  Banca:   Cebraspe  '],
  ['Cargos:', 'Analista de sistemas'],
  ['Remuneração: R$ 4.500 a R$ 12.000'],
];

describe('labelled facts', () => {
  it.each(LINES)('draws concursos-abertos-ec’s fact runs exactly: %j', (...facts) => {
    const written = facts.map((line) => richTextOfPlain(line));
    const kit = labelValueRuns(
      written.map((line) => plain(line)),
      {
        label: { font: FACE, size: 34, weight: MEDIUM, color: testInk('ink') },
        value: { font: FACE, size: 34, weight: LIGHT, color: testInk('body-ink') },
      },
      { unlabelled: 'value', labelGap: 'one-space', keepTogether: 'no' },
    );
    expect(kit).toEqual(factRuns(written, 34, testInk));
  });

  it.each(LINES)('draws concursos-abertos’ card runs exactly: %j', (...facts) => {
    const kit = labelValueRuns(
      facts,
      {
        label: { font: FACE, size: 40, weight: MEDIUM, color: testInk('label-ink') },
        value: { font: FACE, size: 40, weight: LIGHT, color: testInk('value-ink') },
      },
      { unlabelled: 'label', labelGap: 'as-written', keepTogether: 'yes' },
      { value: glue },
    );
    expect(kit).toEqual(abertosRuns(facts, glue));
  });

  it('draws a line with no label in the style it is told', () => {
    const styles = {
      label: { font: FACE, size: 20, weight: MEDIUM, color: '#000000' },
      value: { font: FACE, size: 20, weight: LIGHT, color: '#000000' },
    };
    const [asLabel] = labelValueRuns(['Aberto'], styles, { unlabelled: 'label' });
    const [asValue] = labelValueRuns(['Aberto'], styles, { unlabelled: 'value' });
    expect(asLabel).toMatchObject({ weight: MEDIUM });
    expect(asValue).toMatchObject({ weight: LIGHT });
  });

  it('takes concursos-abertos-ec’s way by default', () => {
    expect(parameterValues(LABEL_VALUE_PARAMETERS)).toEqual({
      unlabelled: 'value',
      labelGap: 'one-space',
      keepTogether: 'no',
    });
  });
});
