import { describe, expect, it } from 'vitest';

import { richTextOfPlain } from './highlight.js';
import { type TitleBlockStyle, type TitleTextPart, titleBlock } from './title-block.js';

import type { TextMeasurement } from '@tyto/core';
import type { GroupDraft, TextDraft } from '@tyto/core/template';

/*
 * A text part may measure its words instead of taking a stated height (TYTO-890), so a stacked
 * card — a name over its facts — is a title block. Opt-in: a part that does not ask, or a
 * content that hands no `measure`, takes its stated height exactly as before.
 */

const FACE = { family: 'CircularXX', source: 'system' } as const;

function part(measured: boolean): TitleTextPart {
  return {
    kind: 'text',
    field: 'name',
    name: 'nome',
    style: { font: FACE, size: 40, weight: 500, color: '#000000' },
    height: 48,
    lineHeight: 1.2,
    ...(measured ? { measured: true as const } : {}),
  };
}

const style = (measured: boolean): TitleBlockStyle => ({
  name: 'exame',
  parts: [
    part(measured),
    {
      kind: 'rule',
      name: 'filete',
      width: 100,
      thickness: 2,
      color: '#000000',
      gapAbove: 10,
    },
    { ...part(false), field: 'facts', name: 'fatos', gapAbove: 10 },
  ],
});

/** Three lines of 48 px, whatever it is asked: a name that wraps. */
const asked: TextDraft[] = [];
function measure(node: TextDraft): TextMeasurement {
  asked.push(node);
  return { runs: node.runs, lines: 3, width: 300, height: 144 } as unknown as TextMeasurement;
}

const fields = {
  name: richTextOfPlain('Tribunal Regional do Trabalho da 2ª Região'),
  facts: richTextOfPlain('Vagas: 120'),
};

function boxes(drawn: ReturnType<typeof titleBlock>) {
  return (drawn.draft as GroupDraft).children.map((child) => ({
    y: child.transform.y,
    h: child.kind === 'text' ? (child as TextDraft).box?.h : undefined,
  }));
}

describe('a measured title part', () => {
  it('takes its measured height, and what is under it moves down by the difference', () => {
    asked.length = 0;
    const drawn = titleBlock(style(true), { fields, width: 400, measure });
    expect(boxes(drawn)).toEqual([
      { y: 0, h: 144 },
      { y: 154, h: undefined },
      { y: 166, h: 48 },
    ]);
    expect(drawn.height).toBe(144 + 10 + 2 + 10 + 48);
    // It measured the part as drawn, at the block's width and with no height of its own.
    expect(asked).toHaveLength(1);
    expect(asked[0]!.box).toEqual({ w: 400 });
    expect(asked[0]!.name).toBe('nome');
  });

  it('takes its stated height when the content hands no measure', () => {
    const drawn = titleBlock(style(true), { fields, width: 400 });
    expect(boxes(drawn)[0]).toEqual({ y: 0, h: 48 });
  });

  it('is opt-in: a part that does not ask is not measured', () => {
    asked.length = 0;
    const plain = titleBlock(style(false), { fields, width: 400 });
    const handed = titleBlock(style(false), { fields, width: 400, measure });
    expect(handed).toEqual(plain);
    expect(asked).toHaveLength(0);
  });

  it('takes its stated height when the measure cannot answer', () => {
    const drawn = titleBlock(style(true), { fields, width: 400, measure: () => undefined });
    expect(boxes(drawn)[0]).toEqual({ y: 0, h: 48 });
  });
});
