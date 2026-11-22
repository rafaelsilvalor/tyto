import type { Block } from './blocks.js';
import {
  type Level,
  type LevelGap,
  type LevelItem,
  type LevelLook,
  type LevelPart,
  levelStack,
  levelsOf,
} from './levels.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';
import type { Measure } from './text.js';

import type { RichText } from '@tyto/core';

/**
 * A body: the lines of general information under a title, as one block of its own (TYTO-831,
 * ADR 0224).
 *
 * An ad's head used to carry two roles in one block: the title (the exam's name, its status)
 * and the general information (vacancies, exam board, roles, salary). One block scales as one,
 * so a long name that shrank to fit its width took "146 vagas" down with it, and a short name
 * that grew made the supporting lines huge. A body is the second of those blocks: it reads the
 * same marks (`|`, `#` to `###`, `---`) with `levelsOf`, takes its own scale, and so enters a
 * `blockColumn` as an entry with its own weight.
 *
 * **The unmarked level is the smallest.** A line written with no `#` is drawn smaller than every
 * marked level, so the marked ones gain importance (maintainer, 2026-11-22): its size is the
 * smallest marked size times `unmarkedRatio`, whatever sizes the template gives the marks.
 *
 * Nothing here knows a slot, a brand or a face: the template says each level's reference size
 * and how a part looks at a size.
 */

export const BODY_PARAMETERS = {
  unmarkedRatio: {
    kind: 'ratio',
    default: 0.8,
    min: 0,
    max: 1,
    description:
      'The size of a line with no # mark, as a share of the smallest marked size: below 1, the unmarked level is always the smallest.',
  },
  partGap: {
    kind: 'length',
    default: 8,
    min: 0,
    description: 'The room between two parts of one line, at scale 1.',
  },
  lineGap: {
    kind: 'length',
    default: 12,
    min: 0,
    description: 'The room between two lines, or a line and the divider, at scale 1.',
  },
} as const satisfies ParameterSchema;

export type BodyParameters = ValuesOf<typeof BODY_PARAMETERS>;

/**
 * The reference size of each marked level: `#`, `##` and `###` always, `####` to `######` when
 * the template draws them (TYTO-834). A deeper level the template gives no size takes the size of
 * the nearest level above it that has one.
 */
export type MarkedSizes = Readonly<Record<1 | 2 | 3, number>> &
  Partial<Readonly<Record<4 | 5 | 6, number>>>;

/** A marked level's size, or the nearest level above it that has one. */
function markedSize(level: Exclude<Level, 0>, sizes: MarkedSizes): number {
  for (let at = level; at >= 1; at--) {
    const size = (sizes as Readonly<Record<number, number | undefined>>)[at];
    if (size !== undefined) return size;
  }
  return sizes[1];
}

export interface BodyOptions {
  /**
   * The body's words. They are read with `levelsOf` with no positional reading: a line with no
   * mark is always the base level, the first one included, since a body's first line is a fact
   * and never a name.
   */
  readonly words: RichText;
  /** Each marked level's size at scale 1. */
  readonly sizes: MarkedSizes;
  /** How a part looks at the size the body chose for its level: face, weight, colour. */
  readonly look: (part: LevelPart, size: number) => LevelLook;
  readonly measure: Measure;
  /** The template's divider at a scale; without it `---` draws nothing. */
  readonly divider?: (width: number, scale: number) => Block;
  /** The room between two lines, overriding the `lineGap` parameter for this pair. */
  readonly lineGapBetween?: LevelGap<LevelItem>;
  readonly parameters?: Partial<BodyParameters>;
  /** The wrapping group's name. Defaults to `corpo`'s English, `body`. */
  readonly name?: string;
}

/**
 * The size a part is drawn at, at scale 1: its level's, or the unmarked size — `unmarkedRatio`
 * times the smallest of the marked levels **used** (TYTO-834), so a block that uses `##` alone is
 * not shrunk by a `######` it never wrote. With no level given, the smallest of `#` to `###`.
 */
export function bodySize(
  level: Level,
  sizes: MarkedSizes,
  parameters: Partial<BodyParameters> = {},
  used: readonly Level[] = [1, 2, 3],
): number {
  if (level !== 0) return markedSize(level, sizes);
  const values = parameterValues(BODY_PARAMETERS, parameters);
  const marked = used.filter((each): each is Exclude<Level, 0> => each !== 0);
  const reference = marked.length === 0 ? ([1, 2, 3] as const) : marked;
  return Math.min(...reference.map((each) => markedSize(each, sizes))) * values.unmarkedRatio;
}

/**
 * The body as one block inside the area's width, every size and gap times `scale`; `undefined`
 * when it has nothing to draw, so a column leaves no room for it.
 */
export function bodyBlock(area: Area, scale: number, options: BodyOptions): Block | undefined {
  const items = levelsOf(options.words, { readByPosition: false });
  if (items.length === 0) return undefined;
  const used = items.flatMap((item) =>
    item.kind === 'line' ? item.parts.map((part) => part.level) : [],
  );
  const values = parameterValues(BODY_PARAMETERS, options.parameters);
  const lineGap: LevelGap<LevelItem> =
    options.lineGapBetween === undefined
      ? values.lineGap * scale
      : typeof options.lineGapBetween === 'number'
        ? options.lineGapBetween * scale
        : (above, below) =>
            (options.lineGapBetween as (a: LevelItem, b: LevelItem) => number)(above, below) *
            scale;
  const drawn = levelStack(
    items,
    {
      name: options.name ?? 'body',
      look: (part) => options.look(part, bodySize(part.level, options.sizes, values, used) * scale),
      gap: values.partGap * scale,
      lineGap,
      ...(options.divider === undefined
        ? {}
        : { divider: (width: number) => options.divider!(width, scale) }),
    },
    area.width,
    options.measure,
  );
  return drawn.height > 0 ? drawn : undefined;
}
