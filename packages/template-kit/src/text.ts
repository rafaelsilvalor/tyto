import { group, runsOf, text } from '@tyto/core/template';

import { type Anchor, type Block, block } from './blocks.js';
import { DEFAULT_METRICS, type FontMetrics, capOffset } from './cap-text.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

import type { Highlights } from './highlight.js';
import type { FontRef, RichText, TemplateContext, TextRun } from '@tyto/core';
import type { NonEmpty, TextDraft, TextOptions } from '@tyto/core/template';

/**
 * Text as a {@link Block}: a brief's words at a size somebody stated, or at the size they
 * measure to.
 *
 * Moved here from the weekly agenda's `parts.ts` by TYTO-185. Neither function knows a colour or
 * a face — both arrive in a {@link TextStyle} — so they are mechanism, and mechanism is what
 * this package owns.
 */

/** What a template is handed to ask how tall its text will be (ADR 0038). */
export type Measure = TemplateContext['measure'];

/** The four things a run of brief text is drawn with. */
export interface TextStyle {
  readonly font: FontRef;
  readonly size: number;
  readonly weight: number;
  readonly color: string;
  /**
   * What `**…**`, `*…*` and marks look like in this text. Absent is the house default — bold at
   * 700 in the surrounding colour — because `**…**` works in every template (TYTO-554).
   */
  readonly highlights?: Highlights;
  /**
   * The px between two paragraphs — a blank line between two lines of the brief's text — on
   * top of the line advance (ADR 0205). Absent is 0: a paragraph is drawn as any other line
   * break, exactly as before paragraphs existed.
   */
  readonly paragraphSpacing?: number;
}

/** Everything `text()` takes except what these functions decide themselves. */
export type TextBlockOptions = Omit<TextOptions, 'runs' | 'box'>;

/**
 * At least one run, or nothing.
 *
 * `text()` takes `NonEmpty<TextRun>` because a text node with no runs is
 * `E_SCENE_EMPTY_TEXT` — the SDK makes it unwritable rather than diagnosable. A brief can
 * still leave a field empty, so somebody has to turn "no runs" into "no node", and this is
 * the narrowing that lets the compiler check that it happened.
 */
export function atLeastOne(runs: readonly TextRun[]): NonEmpty<TextRun> | undefined {
  const [first, ...rest] = runs;
  return first === undefined ? undefined : [first, ...rest];
}

function runsIn(value: RichText, style: TextStyle): NonEmpty<TextRun> | undefined {
  return atLeastOne(
    runsOf(
      value,
      { font: style.font, size: style.size, weight: style.weight, color: style.color },
      style.paragraphSpacing === undefined
        ? style.highlights?.options
        : { ...style.highlights?.options, paragraphSpacing: style.paragraphSpacing },
    ),
  );
}

/** The same room, painted with nothing: a group is a transform and a list, one node. */
function nothing(width: number, height: number): Block {
  return block(width, height, group({ children: [] }));
}

/**
 * A text block of a stated size, or the same space drawn empty.
 *
 * The size is stated either way, which is what keeps a row the same shape when one of its
 * fields was left empty in the brief.
 */
export function textBlock(
  value: RichText,
  size: { readonly w: number; readonly h: number },
  style: TextStyle,
  options: TextBlockOptions = {},
): Block {
  const { given, rest } = splitOptions(options);
  return withoutAnchor(
    textIn(value, { width: size.w, height: size.h }, style, given, { text: rest }),
  );
}

/**
 * A text block as tall as its lines, and never shorter than `minHeight`.
 *
 * **It wraps and grows rather than shrinking** (TYTO-184). The text is built with the width
 * and no height, asked how tall it comes out, and given that height — never less than
 * `minHeight`, so a short line is drawn exactly as a fixed box would draw it.
 *
 * Where nothing can measure (`measure` answers `undefined`: no faces in this compile), the
 * box is `minHeight` and a long line shrinks into it. That height is a guess, and the
 * exporter's own wrap can differ from it.
 */
export function grownTextBlock(
  value: RichText,
  width: number,
  minHeight: number,
  style: TextStyle,
  measure: Measure,
  options: TextBlockOptions = {},
): Block {
  const { given, rest } = splitOptions(options);
  return withoutAnchor(
    grownTextIn(
      value,
      { width, height: Infinity },
      style,
      { ...given, minHeight },
      { measure, text: rest },
    ),
  );
}

/* --------------------------------------------------------- the area-taking forms -- */

/** The numbers and choices a text block uses (TYTO-891); defaults are `text()`'s own. */
export const TEXT_PARAMETERS = {
  lineHeight: {
    kind: 'ratio',
    default: 1.2,
    min: 0,
    description: 'From one line to the next, as a multiple of the size.',
  },
  letterSpacing: { kind: 'length', default: 0, description: 'Space added between letters, in px.' },
  align: {
    kind: 'choice',
    default: 'left',
    choices: ['left', 'center', 'right', 'justify'],
    description: 'Where each line sits across the box.',
  },
  valign: {
    kind: 'choice',
    default: 'top',
    choices: ['top', 'middle', 'bottom'],
    description: 'Where the lines sit down the box.',
  },
  overflow: {
    kind: 'choice',
    default: 'clip',
    choices: ['clip', 'shrink', 'grow'],
    description: 'What the text does when it does not fit its box.',
  },
} as const satisfies ParameterSchema;

export type TextParameters = ValuesOf<typeof TEXT_PARAMETERS>;

/** The numbers a grown text block uses: the text's, and the least height it takes. */
export const GROWN_TEXT_PARAMETERS = {
  ...TEXT_PARAMETERS,
  minHeight: {
    kind: 'length',
    default: 0,
    min: 0,
    description: 'The least height the block takes, in px, however few its lines.',
  },
} as const satisfies ParameterSchema;

export type GrownTextParameters = ValuesOf<typeof GROWN_TEXT_PARAMETERS>;

/** Everything `text()` takes that the schema does not: the node's name, id, effects… */
export type TextNodeOptions = Omit<TextBlockOptions, keyof TextParameters>;

interface TextFormOptions {
  readonly text?: TextNodeOptions;
  readonly measure?: Measure;
  readonly metrics?: FontMetrics;
}

/**
 * `value` in a box as large as `area`, drawn empty when the brief left it empty, with its anchor
 * at its first capitals and last baseline (ADR 0230 decision 2): its lines are measured when
 * `measure` can, else counted as written. With an unbounded height the box has none and the
 * block is as tall as its lines. `overflow` is how far the lines run past a bounded box.
 */
export function textIn(
  value: RichText,
  area: Area,
  style: TextStyle,
  given: Partial<TextParameters> = {},
  options: TextFormOptions = {},
): Block & { readonly overflow: number } {
  const values = parameterValues(TEXT_PARAMETERS, given);
  const runs = runsIn(value, style);
  const bounded = Number.isFinite(area.height);
  if (runs === undefined) return { ...nothing(area.width, bounded ? area.height : 0), overflow: 0 };

  const draft = text({
    ...options.text,
    runs,
    box: bounded ? { w: area.width, h: area.height } : { w: area.width },
    ...values,
  });
  const laid = linesOf(draft, runs, options.measure);
  const tall = laid.lines * values.lineHeight * style.size;
  const height = bounded ? area.height : (laid.height ?? tall);
  return {
    width: area.width,
    height,
    draft,
    anchor: anchorIn(height, laid.lines, style.size, values, options.metrics),
    overflow: bounded ? Math.max(0, (laid.height ?? tall) - area.height) : 0,
  };
}

/**
 * `value` as tall as its lines measure at `area`'s width, never shorter than `minHeight`; with
 * nothing to measure, `minHeight` tall and shrunk into it. Its anchor as {@link textIn}'s;
 * `overflow` is how far it runs past a bounded area.
 */
export function grownTextIn(
  value: RichText,
  area: Area,
  style: TextStyle,
  given: Partial<GrownTextParameters> = {},
  options: TextFormOptions = {},
): Block & { readonly overflow: number } {
  const { minHeight, ...values } = parameterValues(GROWN_TEXT_PARAMETERS, given);
  const width = area.width;
  const runs = runsIn(value, style);
  if (runs === undefined) return { ...nothing(width, minHeight), overflow: 0 };

  const node = (box: { readonly w: number; readonly h?: number }, overflow = values.overflow) =>
    text({ ...options.text, runs, box, ...values, overflow });
  const measured = (options.measure ?? (() => undefined))(node({ w: width }));
  const finished =
    measured === undefined
      ? { height: minHeight, draft: node({ w: width, h: minHeight }, 'shrink') }
      : (() => {
          const height = Math.max(minHeight, measured.height);
          return { height, draft: node({ w: width, h: height }) };
        })();
  const lines = measured?.lines ?? linesWritten(runs);
  return {
    width,
    height: finished.height,
    draft: finished.draft,
    anchor: anchorIn(finished.height, lines, style.size, values, options.metrics),
    overflow: Number.isFinite(area.height) ? Math.max(0, finished.height - area.height) : 0,
  };
}

/** The lines a text takes, and its height, when `measure` can tell; else as written. */
function linesOf(
  draft: TextDraft,
  runs: NonEmpty<TextRun>,
  measure: Measure | undefined,
): { readonly lines: number; readonly height?: number } {
  const probe = draft.box.h === undefined ? draft : { ...draft, box: { w: draft.box.w } };
  const measured = measure?.(probe);
  return measured === undefined
    ? { lines: linesWritten(runs) }
    : { lines: measured.lines, height: measured.height };
}

function linesWritten(runs: readonly TextRun[]): number {
  return runs.filter((each) => each.kind === 'break').length + 1;
}

/** A box's first capitals and last baseline, the lines set by its vertical alignment. */
function anchorIn(
  boxHeight: number,
  lines: number,
  size: number,
  values: Pick<TextParameters, 'lineHeight' | 'valign'>,
  metrics: FontMetrics = DEFAULT_METRICS,
): Anchor {
  const pitch = size * values.lineHeight;
  const room = boxHeight - lines * pitch;
  const top = values.valign === 'middle' ? room / 2 : values.valign === 'bottom' ? room : 0;
  const capTop = top + capOffset(size, values.lineHeight, metrics);
  return { capTop, baseline: capTop + (lines - 1) * pitch + size * metrics.capHeight };
}

/** The text options the schema names, and everything else for the node. */
function splitOptions(options: TextBlockOptions): {
  readonly given: Partial<TextParameters>;
  readonly rest: TextNodeOptions;
} {
  const { lineHeight, letterSpacing, align, valign, overflow, ...rest } = options;
  return {
    given: {
      ...(lineHeight === undefined ? {} : { lineHeight }),
      ...(letterSpacing === undefined ? {} : { letterSpacing }),
      ...(align === undefined ? {} : { align }),
      ...(valign === undefined ? {} : { valign }),
      ...(overflow === undefined ? {} : { overflow }),
    },
    rest,
  };
}

/** The block the older forms returned: no anchor, no overflow. */
function withoutAnchor(item: Block): Block {
  return { width: item.width, height: item.height, draft: item.draft };
}

/**
 * How wide a brief's words come out on one line, rounded up to a whole pixel: 0 for an empty
 * field, and nothing when nothing can measure.
 *
 * Rounded up so a box made exactly this wide never wraps the line it was measured for over a
 * fraction of a pixel.
 */
export function naturalWidth(
  value: RichText,
  style: TextStyle,
  measure: Measure,
): number | undefined {
  const runs = runsIn(value, style);
  if (runs === undefined) return 0;
  const measured = measure(text({ runs, box: {} }));
  return measured === undefined ? undefined : Math.ceil(measured.width);
}

/**
 * A brief's words in capitals, as Portuguese sets them (`ç` → `Ç`), whatever the brief typed.
 * Only the words change: emphasis, marks and line breaks stay where they were (TYTO-860).
 */
export function capitals(value: RichText): RichText {
  return value.map((inline) =>
    inline.kind === 'text' ? { ...inline, value: inline.value.toLocaleUpperCase('pt-BR') } : inline,
  );
}
