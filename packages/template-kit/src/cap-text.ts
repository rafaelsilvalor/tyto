import { lineBreak, run, text } from '@tyto/core/template';

import { type Block, block } from './blocks.js';
import { type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

import type { Area } from './parameters.js';
import type { Measure, TextBlockOptions } from './text.js';
import type { FontRef, TextRun } from '@tyto/core';
import type { NonEmpty } from '@tyto/core/template';

/**
 * Text placed by the top of its capitals, as a measured block (TYTO-793, ADR 0230 decision 2).
 *
 * Reference art gives a line's place as where its capitals start, not where its line box does.
 * Six template repositories turned one into the other with copies of the same two functions — a
 * cap offset from the face's metrics, and a text node moved up by it — and then worked out where
 * the last line's baseline fell, by hand, to know where the next text went. This is that, once:
 * the text sits at the top of its block, and the block's anchor says where its capitals start and
 * where its last baseline is. A template that wants the capitals at a height places the block at
 * that height less `anchor.capTop`.
 */

/**
 * A face's vertical metrics, in em: what the browser puts above and below a line's content, and
 * how tall a capital is. From the font file's own tables (OS/2 typo where the font sets
 * USE_TYPO_METRICS, hhea where it does not); a template that draws several families keeps one
 * of these per family, as data.
 */
export interface FontMetrics {
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
}

/** The metrics every template that copied the cap offset used: CircularXX's, from its files. */
export const DEFAULT_METRICS: FontMetrics = { ascent: 0.75, descent: 0.25, capHeight: 0.709 };

/**
 * How far below a line's top its capitals start: half the line height's excess over the face's
 * ascent and descent, then the ascent less the cap height, at `size`.
 */
export function capOffset(
  size: number,
  lineHeight: number,
  metrics: FontMetrics = DEFAULT_METRICS,
): number {
  const excess = (lineHeight - (metrics.ascent + metrics.descent)) / 2;
  return size * (excess + (metrics.ascent - metrics.capHeight));
}

/** The numbers a capital-placed text uses (ADR 0224 decision 2). */
export const CAP_TEXT_PARAMETERS = {
  size: { kind: 'length', default: 32, min: 1, description: 'The type size, in px.' },
  lineHeight: {
    kind: 'ratio',
    default: 1,
    min: 0.5,
    description: 'From one line to the next, as a multiple of the size.',
  },
  letterSpacing: {
    kind: 'length',
    default: 0,
    description: 'Space added between letters, in px.',
  },
  align: {
    kind: 'choice',
    default: 'left',
    choices: ['left', 'center', 'right'],
    description: 'Where each line sits across the block.',
  },
} as const satisfies ParameterSchema;

export type CapTextParameters = ValuesOf<typeof CAP_TEXT_PARAMETERS>;

export interface CapTextOptions {
  /** The text node's name, so a scene reads back in the template's words. */
  readonly name?: string;
  /** The face's metrics; {@link DEFAULT_METRICS} when absent. */
  readonly metrics?: FontMetrics;
  /**
   * How many lines the text takes. Absent: measured when `measure` can, otherwise the lines the
   * runs break into themselves.
   */
  readonly lines?: number;
  readonly measure?: Measure;
  /** Any other option of the text node (`overflow`, `valign`…), passed through. */
  readonly text?: Omit<
    TextBlockOptions,
    'name' | 'align' | 'lineHeight' | 'letterSpacing' | 'transform'
  >;
}

/**
 * The runs as a block whose anchor is the capitals of the first line and the baseline of the
 * last. The text sits at the block's top left; it is as wide as the area when the area has a
 * width, and otherwise as wide as its longest line. The block is as tall as its line boxes.
 */
export function capText(
  runs: NonEmpty<TextRun>,
  area: Area,
  given: Partial<CapTextParameters> = {},
  options: CapTextOptions = {},
): Block {
  const values = parameterValues(CAP_TEXT_PARAMETERS, given);
  const metrics = options.metrics ?? DEFAULT_METRICS;
  const box = Number.isFinite(area.width) ? { box: { w: area.width } } : {};
  const node = text({
    ...options.text,
    ...(options.name === undefined ? {} : { name: options.name }),
    runs,
    ...box,
    align: values.align,
    lineHeight: values.lineHeight,
    letterSpacing: values.letterSpacing,
  });
  const lines = options.lines ?? options.measure?.(node)?.lines ?? linesWritten(runs);
  const pitch = values.size * values.lineHeight;
  const capTop = capOffset(values.size, values.lineHeight, metrics);
  return {
    ...block(Number.isFinite(area.width) ? area.width : 0, lines * pitch, node),
    anchor: { capTop, baseline: capTop + (lines - 1) * pitch + values.size * metrics.capHeight },
  };
}

/** The lines the runs break into themselves: one more than their breaks. */
function linesWritten(runs: readonly TextRun[]): number {
  return runs.filter((each) => each.kind === 'break').length + 1;
}

/** The run style a plain capital-placed text is drawn in. */
export interface CapTextStyle {
  readonly font: FontRef;
  readonly size: number;
  readonly weight: number;
  readonly color: string;
}

/** Plain words as runs, one per line, a line break wherever the words have a `\n`. */
export function plainRuns(words: string, style: CapTextStyle): NonEmpty<TextRun> {
  const [first = '', ...others] = words.split('\n');
  return [run(first, style), ...others.flatMap((line) => [lineBreak(), run(line, style)])];
}
