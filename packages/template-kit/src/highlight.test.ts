import { font, runsOf } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { highlights, highlightsFromValues, richTextOfPlain } from './highlight.js';
import { labelOf } from './label.js';

import type { HighlightSpec } from './highlight.js';
import type { RichText } from '@tyto/core';
import type { RunsOptions, TemplateValues } from '@tyto/core/template';

const BASE = { font: font('Inter'), size: 40, weight: 400, color: '#222222' } as const;

const ORANGE = '#ff5900';
const NAVY = '#102a54';
const BLUE = '#1f6fd1';
const RED = '#d11f1f';

/** `weight/hex/text` per run, which is all these tests are about. */
function shape(text: RichText, options?: RunsOptions): string[] {
  return runsOf(text, BASE, options).map((run) => {
    if (run.kind === 'break') return '⏎';
    const { r, g, b } = run.color.kind === 'solid' ? run.color.color : { r: -1, g: -1, b: -1 };
    const hex = [r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('');
    return `${run.weight}/#${hex}/${run.text}`;
  });
}

const SPEC: HighlightSpec = {
  bold: { color: ORANGE },
  marks: { cor: { like: 'bold', values: { azul: { color: BLUE }, vermelho: { color: RED } } } },
};

describe('the highlight a template declares once', () => {
  it('is bold at 700 in the surrounding colour when it says nothing, as runsOf always drew', () => {
    const text = richTextOfPlain('a **b** c');
    expect(shape(text, highlights({}).options)).toEqual(shape(text));
    expect(shape(text)).toEqual(['400/#222222/a ', '700/#222222/b', '400/#222222/ c']);
  });

  it('paints **…** in its own colour', () => {
    expect(shape(richTextOfPlain('a **b**'), highlights(SPEC).options)).toEqual([
      '400/#222222/a ',
      '700/#ff5900/b',
    ]);
  });

  it('gives a colour mark its own colour and the highlight’s weight', () => {
    expect(
      shape(richTextOfPlain('{cor:azul}x{/} {cor:vermelho}y{/}'), highlights(SPEC).options),
    ).toEqual(['700/#1f6fd1/x', '400/#222222/ ', '700/#d11f1f/y']);
  });

  it('passes a mark name the template does not declare through unchanged', () => {
    expect(shape(richTextOfPlain('{cor:verde}x{/}'), highlights(SPEC).options)).toEqual([
      '400/#222222/x',
    ]);
  });

  it('varies in one place without repeating the rest', () => {
    const title = highlights(SPEC).with({ bold: { color: NAVY } });
    expect(shape(richTextOfPlain('**a** {cor:azul}b{/}'), title.options)).toEqual([
      '700/#102a54/a',
      '400/#222222/ ',
      '700/#1f6fd1/b',
    ]);
  });

  it('lets the closest wrapper decide when they nest', () => {
    const text: RichText = [
      {
        kind: 'mark',
        key: 'cor',
        value: 'azul',
        range: { start: 0, end: 1 },
        children: [
          { kind: 'text', value: 'a', range: { start: 0, end: 1 } },
          {
            kind: 'bold',
            range: { start: 1, end: 2 },
            children: [{ kind: 'text', value: 'b', range: { start: 1, end: 2 } }],
          },
        ],
      },
    ];
    expect(shape(text, highlights(SPEC).options)).toEqual(['700/#1f6fd1/a', '700/#ff5900/b']);
  });
});

describe('highlights from declared values (ADR 0153)', () => {
  const context = (values: TemplateValues) => ({ values });

  it('draws the constants when nothing is declared', () => {
    const text = richTextOfPlain('**a** {cor:azul}b{/}');
    expect(shape(text, highlightsFromValues({}, SPEC).options)).toEqual(
      shape(text, highlights(SPEC).options),
    );
  });

  it('reads the weight, the colour, a place’s colour and a mark’s colour by their shared names', () => {
    const values = context({
      'highlight-weight': 900,
      'highlight-color': '#00aa00',
      'title-highlight-color': '#aa00aa',
      'mark-cor-azul': '#0000ff',
    });
    const text = richTextOfPlain('**a** {cor:azul}b{/}');

    expect(shape(text, highlightsFromValues(values, SPEC).options)).toEqual([
      '900/#00aa00/a',
      '400/#222222/ ',
      '900/#0000ff/b',
    ]);
    expect(shape(text, highlightsFromValues(values, SPEC, 'title').options)).toEqual([
      '900/#aa00aa/a',
      '400/#222222/ ',
      '900/#0000ff/b',
    ]);
  });

  // TYTO-619: a configured weight the template has no face for would be drawn in a face its
  // plugin's process cannot measure, so it snaps to the nearest face the template declares.
  describe('snapped to the faces the template declares', () => {
    const FACES = [300, 400, 500, 700, 900].map((weight) => ({ weight }));
    const boldWeight = (values: TemplateValues, faces?: readonly { weight: number }[]) =>
      shape(
        richTextOfPlain('**a**'),
        highlightsFromValues(context(values), SPEC, undefined, faces).options,
      )[0];

    it('moves a weight the faces lack to the nearest one, a tie going to the heavier', () => {
      expect(boldWeight({ 'highlight-weight': 640 }, FACES)).toBe('700/#ff5900/a');
      expect(boldWeight({ 'highlight-weight': 600 }, FACES)).toBe('700/#ff5900/a');
      expect(boldWeight({ 'highlight-weight': 450 }, FACES)).toBe('500/#ff5900/a');
      expect(boldWeight({ 'highlight-weight': 1000 }, FACES)).toBe('900/#ff5900/a');
    });

    it('snaps the marks drawn like bold with it', () => {
      const text = richTextOfPlain('{cor:azul}b{/}');
      const options = highlightsFromValues(
        context({ 'highlight-weight': 600 }),
        SPEC,
        undefined,
        FACES,
      ).options;
      expect(shape(text, options)).toEqual(['700/#1f6fd1/b']);
    });

    it('keeps a weight the faces have, and any weight when no faces are given, which is the control', () => {
      expect(boldWeight({ 'highlight-weight': 500 }, FACES)).toBe('500/#ff5900/a');
      expect(boldWeight({ 'highlight-weight': 600 })).toBe('600/#ff5900/a');
      expect(boldWeight({ 'highlight-weight': 600 }, [])).toBe('600/#ff5900/a');
    });
  });

  it('falls back from a place to the house colour when the place declares none', () => {
    const values = context({ 'highlight-color': '#00aa00' });
    expect(
      shape(richTextOfPlain('**a**'), highlightsFromValues(values, SPEC, 'title').options),
    ).toEqual(['700/#00aa00/a']);
  });
});

describe('plain text as rich text', () => {
  it('reads **…** and a mark, each over plain text, with offsets as ranges', () => {
    expect(richTextOfPlain('a **b** {cor:azul}c{/}')).toEqual([
      { kind: 'text', value: 'a ', range: { start: 0, end: 2 } },
      {
        kind: 'bold',
        range: { start: 2, end: 7 },
        children: [{ kind: 'text', value: 'b', range: { start: 4, end: 5 } }],
      },
      { kind: 'text', value: ' ', range: { start: 7, end: 8 } },
      {
        kind: 'mark',
        key: 'cor',
        value: 'azul',
        range: { start: 8, end: 22 },
        children: [{ kind: 'text', value: 'c', range: { start: 18, end: 19 } }],
      },
    ]);
  });

  it('keeps a stray ** and an unclosed mark as written', () => {
    expect(richTextOfPlain('2 ** 3 {cor:azul} x')).toEqual([
      { kind: 'text', value: '2 ** 3 {cor:azul} x', range: { start: 0, end: 19 } },
    ]);
  });

  it('turns a newline into a break, and never lets a span cross one', () => {
    expect(richTextOfPlain('**a\nb**').map((inline) => inline.kind)).toEqual([
      'text',
      'break',
      'text',
    ]);
  });
});

describe('composing with labels (TYTO-594)', () => {
  it('keeps a highlight working inside the label and inside the text', () => {
    const { label, text } = labelOf(richTextOfPlain('**Banca:** Quintex {cor:azul}hoje{/}'));
    const options = highlights(SPEC).options;
    expect(shape(label ?? [], options)).toEqual(['700/#ff5900/Banca:']);
    expect(shape(text, options)).toEqual(['400/#222222/ Quintex ', '700/#1f6fd1/hoje']);
  });
});
