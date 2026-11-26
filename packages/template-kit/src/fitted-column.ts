import { group } from '@tyto/core/template';

import { type Block, block } from './blocks.js';
import { FIT_TEXT_PARAMETERS, fitSizes } from './fit-text.js';
import { type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';
import { ORPHAN_LIMITS, reportOrphan, settle, spaceByWeight } from './rhythm.js';

import type { Measure } from './text.js';
import type { TemplateContext, TextRun } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';

/**
 * A column of pieces set at the largest size at which it fits its room with every gap above a
 * floor (TYTO-889, ADR 0224 decision 2): questao-estrategica's `fitStack`, as a kit arrangement.
 *
 * The caller builds its pieces at a trial setting (`stackAt`); this tries sizes from the ceiling
 * down, spaces each try by weight (`spaceByWeight`), and keeps the first whose smallest gap unit
 * is at least `gapFloor`. Then the text the column is fitted by is settled for an orphan, and each
 * extra (a text that follows its size, as a question's options follow its statement) by a break
 * or its letter spacing alone. When not even the floor fits, the floor, reported as an overflow.
 */

/** One piece of the column: how tall it is, and its nodes once its top is known. */
export interface ColumnPiece {
  readonly height: number;
  readonly place: (top: number) => NodeDraft[];
}

/** A text the column reads for an orphan, at the size it is set at. */
export interface ColumnExtra {
  readonly text: Parameters<Measure>[0];
  readonly size: number;
}

/** The column at one trial setting. */
export interface ColumnStack {
  readonly pieces: readonly ColumnPiece[];
  /** One more than the pieces: over the first, between each pair, under the last. */
  readonly weights: readonly number[];
  /** The text the column is fitted by, read for an orphan by size and letter spacing. */
  readonly text?: Parameters<Measure>[0];
  /** The texts that follow its size, each read for an orphan by spacing or a break alone. */
  readonly extras: readonly ColumnExtra[];
}

/** A trial setting: the size, the text's letter spacing and each extra's, and rebroken runs. */
export interface ColumnTuning {
  readonly size: number;
  readonly letterSpacing: number;
  readonly extras: readonly number[];
  /** The text's runs as `settle` rebroke them, drawn instead of its own. */
  readonly runs?: readonly TextRun[];
  /** Each extra's rebroken runs, the same way. */
  readonly extraRuns?: readonly (readonly TextRun[] | undefined)[];
}

/** The numbers a fitted column uses. */
export const FITTED_COLUMN_PARAMETERS = {
  floor: FIT_TEXT_PARAMETERS.floor,
  ceiling: FIT_TEXT_PARAMETERS.ceiling,
  step: FIT_TEXT_PARAMETERS.step,
  start: FIT_TEXT_PARAMETERS.start,
  floorLast: FIT_TEXT_PARAMETERS.floorLast,
  gapFloor: {
    kind: 'length',
    default: 24,
    min: 0,
    description: "The least a gap's unit may be, in px: a gap of weight w is at least w × this.",
  },
  orphanShrink: {
    kind: 'ratio',
    default: ORPHAN_LIMITS.shrink,
    min: 0,
    description: 'How far under its fitted size the text may go to keep a word off a line alone.',
  },
  orphanTracking: {
    kind: 'length',
    default: ORPHAN_LIMITS.tracking,
    min: 0,
    description: 'The most letter spacing, in em, a text may take or give for the same.',
  },
} as const satisfies ParameterSchema;

export type FittedColumnParameters = ValuesOf<typeof FITTED_COLUMN_PARAMETERS>;

/**
 * The column `stackAt` builds, fitted to `room` and drawn there: a layer as wide as the room and
 * as tall as its bottom, its pieces at the tops the spacing gave them. Place it at (0, 0).
 */
export function fittedColumn(
  stackAt: (tuning: ColumnTuning) => ColumnStack,
  room: { readonly width: number; readonly top: number; readonly bottom: number },
  given: Partial<FittedColumnParameters> = {},
  options: {
    readonly measure?: Measure;
    readonly report?: TemplateContext['report'];
    readonly name?: string;
  } = {},
): Block & { readonly tuning: ColumnTuning } {
  const values = parameterValues(FITTED_COLUMN_PARAMETERS, given);
  const measure: Measure = options.measure ?? (() => undefined);
  const report: TemplateContext['report'] = options.report ?? (() => undefined);
  const limits = { shrink: values.orphanShrink, tracking: values.orphanTracking };
  const arrange = (tuning: ColumnTuning) => {
    const stacked = stackAt(tuning);
    const heights = stacked.pieces.map((piece) => piece.height);
    const spaced = spaceByWeight({
      top: room.top,
      bottom: room.bottom,
      heights,
      weights: stacked.weights,
    });
    return { stacked, spaced, fits: spaced.unit >= values.gapFloor };
  };
  const plainAt = (size: number): ColumnTuning => ({ size, letterSpacing: 0, extras: [] });
  const drawn = (tuning: ColumnTuning, stacked: ColumnStack, tops: readonly number[]) => ({
    ...block(
      room.width,
      room.bottom,
      group({
        ...(options.name === undefined ? {} : { name: options.name }),
        children: stacked.pieces.flatMap((piece, index) => piece.place(tops[index] ?? room.top)),
      }),
    ),
    tuning,
  });

  const fitted = fitSizes(values).find((size) => arrange(plainAt(size)).fits);
  if (fitted === undefined) {
    const tuning = plainAt(values.floor);
    const arranged = arrange(tuning);
    const weight = arranged.stacked.weights.reduce((sum, each) => sum + each, 0);
    report({
      code: 'W_TEMPLATE_OVERFLOW',
      overflow: (values.gapFloor - arranged.spaced.unit) * weight,
    });
    return drawn(tuning, arranged.stacked, arranged.spaced.tops);
  }

  // The text first, by a break one word earlier, letter spacing and size (TYTO-521); then each
  // extra at that size by a break or its letter spacing alone, since the extras follow its size.
  let tuning = plainAt(fitted);
  const orphans: string[] = [];
  const main = arrange(tuning).stacked.text;
  if (main !== undefined) {
    const settled = settle({
      size: fitted,
      measure,
      limits,
      layout: (setting) => {
        const tried = { ...setting, extras: [] };
        const arranged = arrange(tried);
        return { text: arranged.stacked.text ?? main, fits: arranged.fits, laid: tried };
      },
    });
    tuning = settled.laid;
    if (settled.orphan !== undefined) orphans.push(settled.orphan);
  }
  for (const [index, extra] of arrange(tuning).stacked.extras.entries()) {
    const settled = settle({
      size: extra.size,
      measure,
      limits: { shrink: 0, tracking: limits.tracking },
      layout: (setting) => {
        const spacing = [...tuning.extras];
        spacing[index] = setting.letterSpacing;
        const rebroken = [...(tuning.extraRuns ?? [])];
        rebroken[index] = setting.runs;
        const tried = { ...tuning, extras: spacing, extraRuns: rebroken };
        const arranged = arrange(tried);
        const read = arranged.stacked.extras[index]?.text ?? extra.text;
        return { text: read, fits: arranged.fits, laid: tried };
      },
    });
    tuning = settled.laid;
    if (settled.orphan !== undefined) orphans.push(settled.orphan);
  }
  for (const word of orphans) reportOrphan(report, word);
  const arranged = arrange(tuning);
  return drawn(tuning, arranged.stacked, arranged.spaced.tops);
}
