import { lineBreak, run, text } from '@tyto/core/template';

import { balance, breakPieces } from './balance.js';
import { type Block, block } from './blocks.js';
import { DEFAULT_METRICS, type FontMetrics } from './cap-text.js';
import { reportOverflow } from './page.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';
import { lines as linesOf, plain } from './rows.js';
import {
  type Measure,
  type TextBlockOptions,
  type TextStyle,
  grownTextBlock,
  naturalWidth,
  textBlock,
} from './text.js';

import type { RichText, TemplateContext, TextRun } from '@tyto/core';
import type { TextDraft } from '@tyto/core/template';

/**
 * The largest size at which a text fits its room, as one primitive (TYTO-889, ADR 0224).
 *
 * anuncio, house-style, questao-estrategica and voce-conhece each answered that question with a
 * loop of their own, and their loops stepped differently: voce-conhece from its fractional
 * ceiling down a pixel at a time, always trying its floor last; questao from the whole pixel
 * under its ceiling, missing a floor the step skips; anuncio not stepping at all. Those rules
 * are data here (`fitSizes`), so each template keeps its own; what fits is a policy.
 */

/** The numbers and choices a fitted text uses. */
export const FIT_TEXT_PARAMETERS = {
  floor: { kind: 'length', default: 24, min: 1, description: 'The smallest size, in px.' },
  ceiling: { kind: 'length', default: 48, min: 1, description: 'The largest size, in px.' },
  step: {
    kind: 'length',
    default: 1,
    min: 0,
    description:
      'From one size tried to the next, in px. 0 is continuous: `oneLine` solves for the size ' +
      'that makes the line exactly as wide as the area.',
  },
  start: {
    kind: 'choice',
    default: 'ceiling',
    choices: ['ceiling', 'whole'],
    description: 'The first size tried: the ceiling itself, or the whole pixel at or under it.',
  },
  floorLast: {
    kind: 'choice',
    default: 'always',
    choices: ['always', 'on-step'],
    description: 'Whether the floor is tried last even when the step misses it, or only if hit.',
  },
  lineHeight: {
    kind: 'ratio',
    default: 1.2,
    min: 0.5,
    description: 'From one line to the next, as a multiple of the size.',
  },
  lineCap: {
    kind: 'length',
    default: 0,
    min: 0,
    description: 'The most lines a fitting size may take; 0 is no cap.',
  },
  keepWrittenLines: {
    kind: 'choice',
    default: 'no',
    choices: ['first', 'no'],
    description:
      '`first`: look for a size that keeps the lines as written before one that wraps them.',
  },
  widthTolerance: {
    kind: 'length',
    default: 0.5,
    min: 0,
    description: 'Px a line may run past the area and still fit, for the rounding of a measure.',
  },
  measureFrom: {
    kind: 'choice',
    default: 'box',
    choices: ['box', 'capitals'],
    description:
      'How tall the text is against the area: its line boxes, or from its first capitals to its last baseline (ADR 0230).',
  },
  estimatedAdvance: {
    kind: 'ratio',
    default: 0.55,
    min: 0,
    description: "A character's advance, in em, when nothing can measure the text.",
  },
  align: {
    kind: 'choice',
    default: 'left',
    choices: ['left', 'center', 'right'],
    description: 'Where each line sits across the area.',
  },
} as const satisfies ParameterSchema;

export type FitTextParameters = ValuesOf<typeof FIT_TEXT_PARAMETERS>;

/**
 * What fits: one line (`oneLine`), the room's width and height (`fill`), or balanced lines that
 * end on none of the caller's `functionWords` where they can help it (`balance`).
 */
export type FitPolicy =
  | 'oneLine'
  | 'fill'
  | {
      readonly kind: 'balance';
      /** The words a line should not end on: the caller's data, never the kit's. */
      readonly functionWords: ReadonlySet<string>;
      readonly locale?: string;
    };

/** The size a fitted text was set at, its lines, and how far it runs past its room. */
export interface Fit {
  readonly size: number;
  readonly lines: number;
  /** 0 when it fits; at the floor, how far it still runs past the area. */
  readonly overflow: number;
}

/**
 * The sizes a fit tries, largest first: from the ceiling (or the whole pixel under it, `start`)
 * down by `step` while above the floor, then the floor itself (`floorLast: 'always'`) or the
 * floor only when the step lands on it (`'on-step'`). The ceiling is never under the floor.
 * A step of 0 tries the ceiling alone, then the floor.
 */
export function fitSizes(
  given: Partial<
    Pick<FitTextParameters, 'floor' | 'ceiling' | 'step' | 'start' | 'floorLast'>
  > = {},
): number[] {
  const values = parameterValues(FIT_TEXT_PARAMETERS, given);
  const floor = values.floor;
  const ceiling = Math.max(floor, values.ceiling);
  const start = values.start === 'whole' ? Math.floor(ceiling) : ceiling;
  if (values.step === 0) return start === floor ? [floor] : [start, floor];
  const sizes: number[] = [];
  if (values.floorLast === 'always') {
    for (let size = start; size > floor; size -= values.step) sizes.push(size);
    sizes.push(floor);
  } else {
    for (let size = start; size >= floor; size -= values.step) sizes.push(size);
  }
  return sizes;
}

/**
 * `words` at the largest of `fitSizes` that `policy` says fits `area`, as a block as wide as the
 * area and as tall as its lines; when none fits, at the floor, with the overflow reported. The
 * block carries the `fit` it chose, for a caller that places other things by it.
 */
export function fitText(
  words: RichText,
  area: Area,
  style: Omit<TextStyle, 'size'>,
  policy: FitPolicy,
  given: Partial<FitTextParameters> = {},
  options: {
    readonly measure?: Measure;
    readonly report?: TemplateContext['report'];
    readonly name?: string;
    readonly metrics?: FontMetrics;
    /** Any other option of the text node (`overflow`…), passed through. */
    readonly text?: Omit<TextBlockOptions, 'name' | 'align' | 'lineHeight'>;
  } = {},
): Block & { readonly fit: Fit } {
  const values = parameterValues(FIT_TEXT_PARAMETERS, given);
  const measure: Measure = options.measure ?? (() => undefined);
  const drawOptions: TextBlockOptions = {
    ...options.text,
    ...(options.name === undefined ? {} : { name: options.name }),
    align: values.align,
    lineHeight: values.lineHeight,
  };
  const at = (size: number): TextStyle => ({ ...style, size });

  if (typeof policy !== 'string') {
    return balanced(words, area, at, policy, values, measure, drawOptions, options.report);
  }

  const written = linesOf(words).map((line) => plain(line));
  const layout = (size: number): { readonly lines: number; readonly width: number } => {
    const probe = textBlock(words, { w: area.width, h: 0 }, at(size), drawOptions).draft;
    const measured =
      probe.kind === 'text'
        ? measure({ ...(probe as TextDraft), box: { w: area.width } })
        : undefined;
    if (measured !== undefined) return measured;
    const widest = Math.max(0, ...written.map((line) => [...line].length));
    return { lines: written.length, width: widest * values.estimatedAdvance * size };
  };
  const metrics = options.metrics ?? DEFAULT_METRICS;
  const height = (size: number, lines: number): number =>
    values.measureFrom === 'capitals'
      ? (lines - 1) * size * values.lineHeight + size * metrics.capHeight
      : lines * size * values.lineHeight;

  let size: number;
  let overflow = 0;
  if (policy === 'oneLine') {
    size = oneLineSize(words, area, at, values, measure, layout);
  } else {
    const sizes = fitSizes(values);
    const fits = (each: number, keepLines: boolean): boolean => {
      const laid = layout(each);
      return (
        laid.width <= area.width + values.widthTolerance &&
        height(each, laid.lines) <= area.height &&
        (!keepLines || laid.lines <= Math.max(1, written.length)) &&
        (values.lineCap === 0 || laid.lines <= values.lineCap)
      );
    };
    const chosen =
      (values.keepWrittenLines === 'first' ? sizes.find((each) => fits(each, true)) : undefined) ??
      sizes.find((each) => fits(each, false));
    size = chosen ?? values.floor;
    if (chosen === undefined) {
      const bottom = height(size, layout(size).lines);
      overflow = Math.max(0, bottom - area.height);
      if (options.report !== undefined) reportOverflow(options.report, bottom, area.height);
    }
  }
  const drawn = grownTextBlock(words, area.width, 0, at(size), measure, drawOptions);
  return { ...drawn, fit: { size, lines: layout(size).lines, overflow } };
}

/** `oneLine`: continuous with a step of 0, otherwise the largest size laid on one line. */
function oneLineSize(
  words: RichText,
  area: Area,
  at: (size: number) => TextStyle,
  values: FitTextParameters,
  measure: Measure,
  layout: (size: number) => { readonly lines: number },
): number {
  const ceiling = Math.max(values.floor, values.ceiling);
  if (values.step === 0) {
    const natural = naturalWidth(words, at(ceiling), measure);
    if (natural === undefined || natural <= area.width) return ceiling;
    return Math.max(values.floor, (ceiling * area.width) / natural);
  }
  const sizes = fitSizes(values);
  return sizes.find((size) => layout(size).lines === 1) ?? sizes[sizes.length - 1] ?? values.floor;
}

/** `balance`: the kit's balanced breaks, over the words' plain text, each written line kept. */
function balanced(
  words: RichText,
  area: Area,
  at: (size: number) => TextStyle,
  policy: Exclude<FitPolicy, string>,
  values: FitTextParameters,
  measure: Measure,
  drawOptions: TextBlockOptions,
  report: TemplateContext['report'] | undefined,
): Block & { readonly fit: Fit } {
  const pieces: string[] = [];
  const forced = new Set<number>();
  for (const line of linesOf(words)) {
    const split = breakPieces(plain(line));
    if (pieces.length > 0 && split.length > 0) forced.add(pieces.length);
    pieces.push(...split);
  }
  const reference = Math.max(values.floor, values.ceiling);
  const style = at(reference);
  const runStyle = { font: style.font, size: reference, weight: style.weight, color: style.color };
  const setting = balance({
    pieces,
    forced,
    widthOf: (from, to) =>
      measure(text({ runs: [run(pieces.slice(from, to).join(' '), runStyle)], box: {} }))?.width,
    reference,
    box: { w: area.width, h: area.height },
    lineHeight: values.lineHeight,
    sizes: { floor: values.floor, ceiling: reference, step: values.step === 0 ? 1 : values.step },
    functionWords: policy.functionWords,
    ...(policy.locale === undefined ? {} : { locale: policy.locale }),
  });
  const size = setting?.size ?? values.floor;
  const starts = setting?.starts ?? [0];
  const drawnStyle = { ...runStyle, size };
  const runs: TextRun[] = [];
  for (const [index, start] of starts.entries()) {
    if (index > 0) runs.push(lineBreak());
    runs.push(run(pieces.slice(start, starts[index + 1] ?? pieces.length).join(' '), drawnStyle));
  }
  const [first = run('', drawnStyle), ...others] = runs;
  const overflow =
    setting === undefined || !Number.isFinite(setting.overflow) ? 0 : setting.overflow;
  if (report !== undefined && overflow > 0) report({ code: 'W_TEMPLATE_OVERFLOW', overflow });
  const height = starts.length * values.lineHeight * size;
  return {
    ...block(
      area.width,
      height,
      text({ ...drawOptions, runs: [first, ...others], box: { w: area.width } }),
    ),
    fit: { size, lines: starts.length, overflow },
  };
}
