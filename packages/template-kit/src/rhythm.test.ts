import { type FaceCache, type TemplateReport, type TextRun, measureText } from '@tyto/core';
import { lineBreak, run, text } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import {
  ORPHAN_LIMITS,
  type Setting,
  orphanOf,
  rebreak,
  reportOrphan,
  settle,
  spaceByWeight,
} from './rhythm.js';

/**
 * Against a face whose every character is half an em wide, as `core`'s layout tests do: the
 * algorithm is under test, not a font, and every line break is one a reader can check by
 * counting characters.
 */
const faces: FaceCache = {
  get: (face) =>
    face.family === 'Test'
      ? { advance: (characters: string) => characters.length * 0.5, contentHeight: 1.2 }
      : undefined,
};
const measure = (node: Parameters<typeof measureText>[0]) => measureText(node, faces);
const unmeasurable = () => undefined;

const FONT = { family: 'Test', source: 'bundled' } as const;
const WIDTH = 840;

/** The explanation on the maintainer's screenshot, which ended on "princípio." alone. */
const EXPLANATION =
  'A gestão democrática pressupõe participação coletiva, diálogo, transparência e ' +
  'compartilhamento das decisões. Relações hierárquicas rígidas e decisões impostas ' +
  'verticalmente contrariam esse princípio.';

function paragraph(words: string, size: number, letterSpacing = 0) {
  return text({
    runs: [run(words, { font: FONT, size, color: '#000000' })],
    box: { w: WIDTH },
    lineHeight: 1.5,
    letterSpacing,
  });
}

/** The layout `settle` is handed: the explanation, fitting any room it is given. */
function explanation(room = Number.POSITIVE_INFINITY) {
  return (setting: Setting) => {
    const plain = paragraph(EXPLANATION, setting.size, setting.letterSpacing);
    // A rebroken setting is drawn with the runs it carries, as a template draws it.
    const node = setting.runs === undefined ? plain : { ...plain, runs: [...setting.runs] };
    const height = measure(node)?.height ?? 0;
    return { text: node, fits: height <= room, laid: setting };
  };
}

function words(...lines: string[]): TextRun[] {
  return lines.flatMap((line, index) => [
    ...(index > 0 ? [lineBreak()] : []),
    run(line, { font: FONT, size: 10, color: '#000000' }),
  ]);
}

describe('spaceByWeight', () => {
  it('shares the room out by weight, so every gap is the same multiple of one unit', () => {
    // 1000 px of room, 600 of blocks: 400 over weights 1 + 1.6 + 1 = 3.6.
    const spaced = spaceByWeight({
      top: 100,
      bottom: 1100,
      heights: [200, 400],
      weights: [1, 1.6, 1],
    });

    expect(spaced.unit).toBeCloseTo(400 / 3.6, 9);
    expect(spaced.tops[0]).toBeCloseTo(100 + spaced.unit, 9);
    expect(spaced.tops[1]! - (spaced.tops[0]! + 200)).toBeCloseTo(1.6 * spaced.unit, 9);
    expect(spaced.overflow).toBe(0);
  });

  it('centres the blocks when the outer weights are equal', () => {
    const spaced = spaceByWeight({ top: 0, bottom: 1000, heights: [100, 300], weights: [1, 2, 1] });
    const above = spaced.tops[0]!;
    const below = 1000 - (spaced.tops[1]! + 300);

    expect(above).toBeCloseTo(below, 9);
  });

  it('keeps the proportions when the text grows: a longer block shrinks every gap alike', () => {
    const short = spaceByWeight({
      top: 0,
      bottom: 1000,
      heights: [100, 300],
      weights: [1, 1.6, 1],
    });
    const long = spaceByWeight({ top: 0, bottom: 1000, heights: [100, 600], weights: [1, 1.6, 1] });

    expect(long.unit).toBeLessThan(short.unit);
    expect(long.tops[0]).toBeCloseTo(long.unit, 9);
    expect(long.tops[1]! - 100 - long.tops[0]!).toBeCloseTo(1.6 * long.unit, 9);
  });

  it('closes the gaps and says by how much the blocks run over a room they do not fit', () => {
    const spaced = spaceByWeight({ top: 0, bottom: 500, heights: [200, 400], weights: [1, 1, 1] });

    expect(spaced).toEqual({ tops: [0, 200], unit: 0, overflow: 100 });
  });

  it('refuses weights that are not one more than the blocks', () => {
    expect(() => spaceByWeight({ top: 0, bottom: 10, heights: [1, 1], weights: [1, 1] })).toThrow(
      RangeError,
    );
  });
});

describe('orphanOf', () => {
  it('names the last word of a paragraph that wrapped and left it alone on its line', () => {
    expect(orphanOf(words('one two three'), words('one two', 'three'))).toBe('three');
  });

  it('passes a last line of two words, which is the control', () => {
    expect(orphanOf(words('one two three'), words('one', 'two three'))).toBeUndefined();
  });

  it('passes a paragraph of one line, even of one word: nothing wrapped onto it', () => {
    expect(orphanOf(words('Letra D', 'alone'), words('Letra D', 'alone'))).toBeUndefined();
  });

  it('reads each paragraph apart, so the orphan of the first is found before the second', () => {
    const written = words('one two three', 'four five six');
    const laid = words('one two', 'three', 'four five six');

    expect(orphanOf(written, laid)).toBe('three');
  });

  it('keeps counting across an empty line, which is a paragraph of no words', () => {
    const written = words('a b', '', 'c d e');
    const laid = words('a b', '', 'c d', 'e');

    expect(orphanOf(written, laid)).toBe('e');
  });

  it('reads two words joined by a no-break space as two, so a glued last pair is no orphan', () => {
    expect(orphanOf(words('one two three'), words('one', 'two three'))).toBeUndefined();
  });
});

describe('rebreak', () => {
  it('breaks before the last word of the line over the orphan', () => {
    const rebroken = rebreak(words('one two three'), words('one two', 'three'));

    expect(rebroken).toEqual(words('one', 'two three'));
  });

  it('answers nothing for a text with no orphan, which is the control', () => {
    expect(rebreak(words('one two three'), words('one', 'two three'))).toBeUndefined();
  });

  it('moves two words joined by a no-break space together, never splitting them', () => {
    const rebroken = rebreak(words('one two three four'), words('one two three', 'four'));

    expect(rebroken).toEqual(words('one', 'two three four'));
  });

  it('breaks inside the right paragraph, across runs, keeping each run’s style', () => {
    const bold = run('two ', { font: FONT, size: 10, weight: 700, color: '#000000' });
    const written = [
      ...words('lead'),
      lineBreak(),
      run('one ', { font: FONT, size: 10, color: '#000000' }),
      bold,
      run('three', { font: FONT, size: 10, color: '#000000' }),
    ];
    const laid = [
      ...words('lead'),
      lineBreak(),
      run('one ', { font: FONT, size: 10, color: '#000000' }),
      { ...bold, text: 'two' },
      lineBreak(),
      run('three', { font: FONT, size: 10, color: '#000000' }),
    ];
    const rebroken = rebreak(written, laid) ?? [];

    expect(rebroken.map((item) => (item.kind === 'break' ? '|' : item.text))).toEqual([
      'lead',
      '|',
      'one',
      '|',
      'two ',
      'three',
    ]);
    expect(rebroken[4]).toMatchObject({ weight: 700 });
  });
});

describe('settle', () => {
  it('reproduces the screenshot: at 48 px the explanation ends on "princípio." alone', () => {
    const node = paragraph(EXPLANATION, 48);

    expect(orphanOf(node.runs, measure(node)!.runs)).toBe('princípio.');
  });

  it('clears it with letter spacing alone, at the size the text fitted at', () => {
    const settled = settle({
      size: 48,
      layout: explanation(),
      measure,
      limits: { shrink: 0.08, tracking: 0.01, rebreak: false },
    });
    const node = paragraph(EXPLANATION, settled.setting.size, settled.setting.letterSpacing);

    expect(settled.orphan).toBeUndefined();
    expect(settled.setting.size).toBe(48);
    expect(settled.setting.letterSpacing).not.toBe(0);
    // Within a hundredth of an em, the house limit.
    expect(Math.abs(settled.setting.letterSpacing)).toBeLessThanOrEqual(0.01 * 48);
    expect(orphanOf(node.runs, measure(node)!.runs)).toBeUndefined();
  });

  it('falls to a smaller size when letter spacing is not allowed', () => {
    // 57, 56 and 55 px all end on "princípio." alone; 54 does not, and 54 is within 8% of 57.
    const settled = settle({
      size: 57,
      layout: explanation(),
      measure,
      limits: { shrink: 0.08, tracking: 0, rebreak: false },
    });

    expect(settled.orphan).toBeUndefined();
    expect(settled.setting.letterSpacing).toBe(0);
    expect(settled.setting.size).toBe(54);
  });

  it('names the word and keeps the fitted setting when nothing within the limits clears it', () => {
    const settled = settle({
      size: 48,
      layout: explanation(),
      measure,
      limits: { shrink: 0, tracking: 0, rebreak: false },
    });

    expect(settled).toEqual({
      setting: { size: 48, letterSpacing: 0 },
      laid: { size: 48, letterSpacing: 0 },
      orphan: 'princípio.',
    });
  });

  it('first moves a word down from the line above, at the same size and spacing', () => {
    const settled = settle({ size: 48, layout: explanation(), measure });
    const runs = settled.setting.runs ?? [];
    const node = { ...paragraph(EXPLANATION, 48), runs: [...runs] };

    expect(settled.orphan).toBeUndefined();
    expect(settled.setting).toMatchObject({ size: 48, letterSpacing: 0 });
    expect(runs.filter((item) => item.kind === 'break')).toHaveLength(1);
    expect(orphanOf(node.runs, measure(node)!.runs)).toBeUndefined();
    // As many lines as before: the word moved down, nothing grew.
    expect(measure(node)!.lines).toBe(measure(paragraph(EXPLANATION, 48))!.lines);
  });

  it('refuses a rebreak that leaves the line above alone, and goes on to the other tools', () => {
    // At 76 px the line over "princípio." is "contrariam esse": moving "esse" strands "contrariam".
    const node = paragraph(EXPLANATION, 76);
    const rebroken = rebreak(node.runs, measure(node)!.runs)!;
    const tried = { ...node, runs: rebroken };
    const settled = settle({ size: 76, layout: explanation(), measure });

    expect(orphanOf(tried.runs, measure(tried)!.runs)).toBe('contrariam');
    expect(settled.setting.runs).toBeUndefined();
  });

  it('leaves a caller that ignores the rebroken runs exactly where it was before rebreak existed', () => {
    const ignoring = (setting: Setting) =>
      explanation()({ size: setting.size, letterSpacing: setting.letterSpacing });
    const withRebreak = settle({ size: 48, layout: ignoring, measure });
    const without = settle({
      size: 48,
      layout: ignoring,
      measure,
      limits: { ...ORPHAN_LIMITS, rebreak: false },
    });

    expect(withRebreak).toEqual(without);
    expect(withRebreak.setting.runs).toBeUndefined();
  });

  it('refuses a rebreak whose moved word would not fit beside the lonely one', () => {
    // At 100 px a character is 50 px, 16 to the 840 px line: "a bbbbbbbbbbbbb" fills one line
    // and "ccc" is alone; moving "bbbbbbbbbbbbb" down needs 17 characters, so it wraps again.
    const crowded = 'a bbbbbbbbbbbbb ccc';
    const node = paragraph(crowded, 100);
    const rebroken = { ...node, runs: rebreak(node.runs, measure(node)!.runs)! };
    const layout = (setting: Setting) => {
      const plain = paragraph(crowded, setting.size, setting.letterSpacing);
      const drawn = setting.runs === undefined ? plain : { ...plain, runs: [...setting.runs] };
      return { text: drawn, fits: true, laid: setting };
    };
    const settled = settle({ size: 100, layout, measure, limits: { shrink: 0, tracking: 0 } });

    expect(measure(rebroken)!.lines).toBeGreaterThan(measure(node)!.lines);
    expect(settled.setting.runs).toBeUndefined();
    expect(settled.orphan).toBe('ccc');
  });

  it('skips every setting at which the text no longer fits its room', () => {
    // A room that holds only the setting the text fitted at: every other is refused, so the
    // orphan stays and is named rather than cleared by a setting that would run over.
    const onlyFitted = (setting: Setting) => ({
      ...explanation()(setting),
      fits: setting.size === 48 && setting.letterSpacing === 0 && setting.runs === undefined,
    });
    const settled = settle({ size: 48, layout: onlyFitted, measure });

    expect(settled.orphan).toBe('princípio.');
    expect(settled.setting).toEqual({ size: 48, letterSpacing: 0 });
  });

  it('leaves a text with no orphan as it fitted, which is the control', () => {
    const settled = settle({ size: 50, layout: explanation(), measure });

    expect(settled).toEqual({
      setting: { size: 50, letterSpacing: 0 },
      laid: { size: 50, letterSpacing: 0 },
    });
  });

  it('claims nothing when nothing can measure', () => {
    const settled = settle({ size: 48, layout: explanation(), measure: unmeasurable });

    expect(settled).toEqual({
      setting: { size: 48, letterSpacing: 0 },
      laid: { size: 48, letterSpacing: 0 },
    });
  });
});

describe('reportOrphan', () => {
  function reportsFor(word: string | undefined): TemplateReport[] {
    const reports: TemplateReport[] = [];
    reportOrphan((report) => reports.push(report), word);
    return reports;
  }

  it('reports the word as W_TEMPLATE_ORPHAN, and nothing for no word', () => {
    expect(reportsFor('princípio.')).toEqual([{ code: 'W_TEMPLATE_ORPHAN', word: 'princípio.' }]);
    expect(reportsFor(undefined)).toEqual([]);
  });

  it('cuts a word to the 80 characters the host accepts, so the answer is not refused', () => {
    const [report] = reportsFor('x'.repeat(200));

    expect(report?.code === 'W_TEMPLATE_ORPHAN' && report.word).toBe('x'.repeat(80));
  });
});
