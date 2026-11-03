import { describe, expect, it } from 'vitest';

import {
  LABEL_EXCEPTIONS,
  LONGEST_LABEL,
  type LabelOptions,
  labelOf,
  labelOfText,
} from './label.js';
import { plain } from './rows.js';
import { bold, rich, span } from './rich-text.fixture.js';

import type { Inline, RichText } from '@tyto/core';

/** A rich line written as its spans, `**…**` for bold, so a case reads at a glance. */
function shown(value: RichText | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
          return inline.value;
        case 'break':
          return '\n';
        case 'bold':
          return `**${shown(inline.children)}**`;
        default:
          return `{${shown(inline.children)}}`;
      }
    })
    .join('');
}

function read(line: RichText, options?: LabelOptions) {
  const { label, text } = labelOf(line, options);
  return { label: shown(label), text: shown(text) };
}

describe('labelOfText', () => {
  it('splits at the first colon, the colon with the label and the text as written', () => {
    expect(labelOfText('Board: North Office')).toEqual({ label: 'Board:', text: ' North Office' });
    expect(labelOfText('Seats: 1.200: more soon')).toEqual({
      label: 'Seats:',
      text: ' 1.200: more soon',
    });
  });

  it('returns a line with no separator whole, with no label', () => {
    expect(labelOfText('A line with no label')).toEqual({
      label: undefined,
      text: 'A line with no label',
    });
  });

  it('gives a label with empty text when nothing follows the separator', () => {
    expect(labelOfText('Board:')).toEqual({ label: 'Board:', text: '' });
  });

  it('reads a blank label as no label', () => {
    expect(labelOfText(': nothing before')).toEqual({ label: undefined, text: ': nothing before' });
    expect(labelOfText('   : nothing before')).toEqual({
      label: undefined,
      text: '   : nothing before',
    });
  });

  it('does not count the colon of a time, and takes the next separator instead', () => {
    expect(labelOfText('10:30 opening')).toEqual({ label: undefined, text: '10:30 opening' });
    expect(labelOfText('At 9:05: doors open')).toEqual({
      label: 'At 9:05:',
      text: ' doors open',
    });
    expect(labelOfText('Exam: 10:30')).toEqual({ label: 'Exam:', text: ' 10:30' });
  });

  it("does not count a URL scheme's colon", () => {
    expect(labelOfText('https://example.test/page')).toEqual({
      label: undefined,
      text: 'https://example.test/page',
    });
    expect(labelOfText('Site: https://example.test')).toEqual({
      label: 'Site:',
      text: ' https://example.test',
    });
  });

  it('reads a separator past the longest label as a colon in a sentence', () => {
    const atLimit = 'a'.repeat(LONGEST_LABEL);
    expect(labelOfText(`${atLimit}: text`).label).toBe(`${atLimit}:`);
    expect(labelOfText(`  ${atLimit}  : text`).label).toBe(`  ${atLimit}  :`);
    const pastLimit = 'a'.repeat(LONGEST_LABEL + 1);
    expect(labelOfText(`${pastLimit}: text`)).toEqual({
      label: undefined,
      text: `${pastLimit}: text`,
    });
  });

  it('counts the longest label in characters, not UTF-16 units', () => {
    const accented = 'ã'.repeat(LONGEST_LABEL - 1) + '🦉';
    expect(labelOfText(`${accented}: text`).label).toBe(`${accented}:`);
  });

  it('takes its options from the caller', () => {
    expect(labelOfText('Board: North', { keepSeparator: false })).toEqual({
      label: 'Board',
      text: ' North',
    });
    expect(labelOfText('Board - North: East', { separator: ' - ' })).toEqual({
      label: 'Board - ',
      text: 'North: East',
    });
    expect(labelOfText('Board: North', { separator: '' })).toEqual({
      label: undefined,
      text: 'Board: North',
    });
    expect(labelOfText('A longer label: text', { longestLabel: 5 }).label).toBeUndefined();
    expect(labelOfText(`${'a'.repeat(200)}: text`, { longestLabel: Infinity }).label).toBe(
      `${'a'.repeat(200)}:`,
    );
    expect(labelOfText('10:30 opening', { notLabels: [] })).toEqual({
      label: '10:',
      text: '30 opening',
    });
    expect(
      labelOfText('Code A:1 then: text', {
        notLabels: [{ name: 'a code', pattern: String.raw`[A-Z]:\d` }],
      }).label,
    ).toBe('Code A:1 then:');
  });

  it('keeps the default exceptions to a time and a URL', () => {
    expect(LABEL_EXCEPTIONS.map((exception) => exception.name)).toEqual(['a time', 'a URL']);
  });
});

/**
 * The split a template wrote by hand before the kit had one (concursos-abertos v0.2.4, its
 * `card()`), copied verbatim: the label up to and with the first colon, the rest as written,
 * and a line with no colon drawn whole as the label.
 */
function handWritten(line: string): { label: string; detail: string } {
  const split = line.indexOf(':');
  const label = split < 0 ? line : line.slice(0, split + 1);
  const detail = split < 0 ? '' : line.slice(split + 1);
  return { label, detail };
}

/**
 * The options a template that splits at every first colon passes to read the same lines: no
 * exception and no length limit. With the defaults, a time's colon and a long label read
 * differently — on purpose.
 */
const EVERY_FIRST_COLON: LabelOptions = { notLabels: [], longestLabel: Infinity };

describe('labelOfText reproduces a hand-written split at the first colon', () => {
  const lines = [
    'Board: North Office',
    'Enrolment: open',
    'Seats: 1.200',
    'Salary: R$ 4.512,30',
    'Enrolment: until 14/11',
    'Exam: to be confirmed',
    'Exam: 14/11 at 10:30',
    'Board:',
    'A line with no colon',
    'Note: first: second',
    '10:30 opening',
    `${'a'.repeat(60)}: a long label`,
  ];

  it.each(lines)('%s', (line) => {
    const { label, text } = labelOfText(line, EVERY_FIRST_COLON);
    // A line with no label is drawn whole in the label's style, as the hand-written split did.
    expect({ label: label ?? text, detail: label === undefined ? '' : text }).toEqual(
      handWritten(line),
    );
  });

  it('differs, with those options, only on a blank label, which it reads as none', () => {
    expect(handWritten(': x')).toEqual({ label: ':', detail: ' x' });
    expect(labelOfText(': x', EVERY_FIRST_COLON)).toEqual({ label: undefined, text: ': x' });
  });

  it('differs with the defaults on a time and on a long label', () => {
    expect(labelOfText('10:30 opening').label).toBeUndefined();
    expect(labelOfText(`${'a'.repeat(60)}: a long label`).label).toBeUndefined();
  });
});

describe('labelOf', () => {
  it('splits rich text at the first colon, as labelOfText splits its characters', () => {
    expect(read(rich('Board: North Office'))).toEqual({ label: 'Board:', text: ' North Office' });
    expect(read(rich('A line with no label'))).toEqual({
      label: undefined,
      text: 'A line with no label',
    });
  });

  it('gives the same label for **Label:** text as for Label: text', () => {
    const marked = labelOf([bold('Board:'), span(' North Office')]);
    const written = labelOf(rich('Board: North Office'));
    expect(plain(marked.label!)).toBe(plain(written.label!));
    expect(read([bold('Board:'), span(' North Office')])).toEqual({
      label: '**Board:**',
      text: ' North Office',
    });
  });

  it('keeps the highlight on either side of the label', () => {
    expect(read([span('Board: '), bold('North'), span(' Office')])).toEqual({
      label: 'Board:',
      text: ' **North** Office',
    });
    expect(read([span('The '), bold('new'), span(' board: North')])).toEqual({
      label: 'The **new** board:',
      text: ' North',
    });
  });

  it('cuts a highlight the separator falls inside, each half keeping its kind', () => {
    expect(read([bold('Note: due'), span(' today')])).toEqual({
      label: '**Note:**',
      text: '** due** today',
    });
    expect(read([bold('Board'), span(': North')])).toEqual({
      label: '**Board**:',
      text: ' North',
    });
  });

  it('takes the first separator, inside a highlight mid-line or not', () => {
    expect(read([span('Today '), bold('Note: due'), span(' soon')])).toEqual({
      label: 'Today **Note:**',
      text: '** due** soon',
    });
    expect(read([span('Board: '), bold('Note: due')])).toEqual({
      label: 'Board:',
      text: ' **Note: due**',
    });
  });

  it('reads a highlight past the longest label as no label', () => {
    const line = [span('a'.repeat(LONGEST_LABEL)), bold(' then: due')];
    expect(labelOf(line)).toEqual({ label: undefined, text: line });
  });

  it('does not take a label across a line break', () => {
    const line = rich('No label here\nBoard: North');
    expect(labelOf(line)).toEqual({ label: undefined, text: line });
  });

  it('keeps a break that sits in the text', () => {
    expect(read(rich('Board: North\nOffice'))).toEqual({
      label: 'Board:',
      text: ' North\nOffice',
    });
  });

  it('applies its options to rich text', () => {
    expect(read([bold('Board:'), span(' North')], { keepSeparator: false })).toEqual({
      label: '**Board**',
      text: ' North',
    });
    expect(read(rich('10:30 opening'))).toEqual({ label: undefined, text: '10:30 opening' });
  });

  it('gives each piece of a cut text a range inside the one it came from', () => {
    const [whole] = rich('Board: North') as [Inline & { kind: 'text' }];
    const { label, text } = labelOf([whole]);
    expect(label).toEqual([
      {
        kind: 'text',
        value: 'Board:',
        range: { start: whole.range.start, end: whole.range.start + 6 },
      },
    ]);
    expect(text).toEqual([
      {
        kind: 'text',
        value: ' North',
        range: { start: whole.range.start + 6, end: whole.range.end },
      },
    ]);
  });
});
