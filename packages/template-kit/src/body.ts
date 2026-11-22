import type { Block } from './blocks.js';
import {
  type Level,
  type LevelGap,
  type LevelItem,
  type LevelLook,
  type LevelPart,
  levelStack,
} from './levels.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';
import type { Measure } from './text.js';

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

/** The reference size of each marked level: `#`, `##` and `###`. */
export type MarkedSizes = Readonly<Record<Exclude<Level, 0>, number>>;

export interface BodyOptions {
  /** The body's lines, as `levelsOf` reads them. */
  readonly items: readonly LevelItem[];
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

/** The size a part is drawn at, at scale 1: its level's, or the unmarked size. */
export function bodySize(
  level: Level,
  sizes: MarkedSizes,
  parameters: Partial<BodyParameters> = {},
): number {
  if (level !== 0) return sizes[level];
  const values = parameterValues(BODY_PARAMETERS, parameters);
  return Math.min(sizes[1], sizes[2], sizes[3]) * values.unmarkedRatio;
}

/**
 * The body as one block inside the area's width, every size and gap times `scale`; `undefined`
 * when it has nothing to draw, so a column leaves no room for it.
 */
export function bodyBlock(area: Area, scale: number, options: BodyOptions): Block | undefined {
  if (options.items.length === 0) return undefined;
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
    options.items,
    {
      name: options.name ?? 'body',
      look: (part) => options.look(part, bodySize(part.level, options.sizes, values) * scale),
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
