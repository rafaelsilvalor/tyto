import { describe, expect, it } from 'vitest';

import { runsOf } from './runs.js';
import { font } from './values.js';
import type { RichText } from '../brief/ast.js';
import { sourceRange } from '../source/range.js';

/**
 * The seam between what a brief says and what a template makes it look like. The brief
 * carries structure — bold, italic, a mark, a break — and the template carries the
 * typography; `runsOf` is where the first becomes the second.
 */

const inter = font('Inter');
const AT = sourceRange(0, 1);
const BASE = { font: inter, size: 48, color: '#ffffff' } as const;

function plain(value: string): RichText {
  return [{ kind: 'text', value, range: AT }];
}

/** `weight/style/text`, which is all these tests are about. */
function shape(text: RichText, options = {}): string[] {
  return runsOf(text, BASE, options).map((run) =>
    run.kind === 'break' ? '⏎' : `${run.weight}/${run.style}/${run.text}`,
  );
}

describe('what a brief says about emphasis', () => {
  it('gives plain text the base style', () => {
    expect(shape(plain('Direito'))).toEqual(['400/normal/Direito']);
  });

  it('turns bold into a weight and italic into a style', () => {
    expect(
      shape([
        { kind: 'bold', children: plain('a'), range: AT },
        { kind: 'italic', children: plain('b'), range: AT },
      ]),
    ).toEqual(['700/normal/a', '400/italic/b']);
  });

  it('keeps both when they nest, in either direction (ADR 0015)', () => {
    const boldOverItalic: RichText = [
      { kind: 'bold', children: [{ kind: 'italic', children: plain('x'), range: AT }], range: AT },
    ];
    const italicOverBold: RichText = [
      { kind: 'italic', children: [{ kind: 'bold', children: plain('x'), range: AT }], range: AT },
    ];

    expect(shape(boldOverItalic)).toEqual(['700/italic/x']);
    expect(shape(italicOverBold)).toEqual(['700/italic/x']);
  });

  it('lets a template choose what bold weighs', () => {
    expect(shape([{ kind: 'bold', children: plain('a'), range: AT }], { bold: 900 })).toEqual([
      '900/normal/a',
    ]);
  });

  it('returns to the surrounding style after an emphasised run ends', () => {
    expect(
      shape([
        { kind: 'text', value: 'Direito ', range: AT },
        { kind: 'bold', children: plain('Constitucional'), range: AT },
        { kind: 'text', value: ' hoje', range: AT },
      ]),
    ).toEqual(['400/normal/Direito ', '700/normal/Constitucional', '400/normal/ hoje']);
  });
});

describe('a break is a run, not a character (ADR 0016)', () => {
  it('becomes its own run rather than a newline inside one', () => {
    expect(
      shape([
        { kind: 'text', value: 'Primeira', range: AT },
        { kind: 'break', range: AT },
        { kind: 'text', value: 'Segunda', range: AT },
      ]),
    ).toEqual(['400/normal/Primeira', '⏎', '400/normal/Segunda']);
  });

  it('carries no styling, whatever the text around it is wearing', () => {
    const runs = runsOf([{ kind: 'break', range: AT }], BASE);
    expect(runs).toEqual([{ kind: 'break' }]);
  });

  it('survives inside an emphasised run', () => {
    expect(
      shape([
        {
          kind: 'bold',
          children: [
            { kind: 'text', value: 'a', range: AT },
            { kind: 'break', range: AT },
            { kind: 'text', value: 'b', range: AT },
          ],
          range: AT,
        },
      ]),
    ).toEqual(['700/normal/a', '⏎', '700/normal/b']);
  });
});

describe('marks are the template’s vocabulary', () => {
  const marked: RichText = [
    { kind: 'text', value: 'Garanta sua ', range: AT },
    { kind: 'mark', key: 'cor', value: 'laranja', children: plain('vaga'), range: AT },
  ];

  it('applies whatever the template maps the mark to', () => {
    const runs = runsOf(marked, BASE, {
      mark: (key, value) => (key === 'cor' && value === 'laranja' ? { color: '#ff5900' } : {}),
    });

    expect(runs[1]?.kind === 'text' && runs[1].color).toEqual({
      kind: 'solid',
      color: { r: 255, g: 89, b: 0, a: 1 },
    });
  });

  it('passes the children through unchanged when nothing maps the mark', () => {
    // A template that does not use a mark should not have to refuse it.
    expect(shape(marked)).toEqual(['400/normal/Garanta sua ', '400/normal/vaga']);
  });
});

describe('the edges', () => {
  it('returns no runs for empty rich text, which is what a text node refuses', () => {
    // `text({ runs })` needs a non-empty list at the type level and `E_SCENE_EMPTY_TEXT`
    // catches the rest; producing an empty run here is the honest answer to empty input.
    expect(runsOf([], BASE)).toEqual([]);
  });

  it('drops an empty text node rather than emitting a run that draws nothing', () => {
    expect(shape([{ kind: 'text', value: '', range: AT }])).toEqual([]);
  });
});
