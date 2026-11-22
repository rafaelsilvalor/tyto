import type { LevelItem, LevelLook, LevelPart } from './levels.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';
import { type Measure, naturalWidth } from './text.js';

/**
 * The scale at which a title's main line fills its width (TYTO-825, ADR 0224).
 *
 * A head drawn at the reference's sizes leaves a short exam name small in a wide panel and lets
 * a long one wrap. The maintainer wants the main line — the part written `#` — to grow until it
 * fills the usable width, between a minimum and a maximum, the supporting lines following in the
 * same proportion, and never so tall that the head takes more than its share of the height
 * (2026-11-21). This piece answers the one number: the scale to build every level at.
 */

export const MAIN_LINE_FIT_PARAMETERS = {
  minScale: {
    kind: 'ratio',
    default: 0.7,
    min: 0,
    description: 'The smallest the main line may be drawn, as a share of its reference size.',
  },
  maxScale: {
    kind: 'ratio',
    default: 1.6,
    min: 0,
    description: 'The largest the main line may be drawn, as a share of its reference size.',
  },
} as const satisfies ParameterSchema;

export type MainLineFitParameters = ValuesOf<typeof MAIN_LINE_FIT_PARAMETERS>;

export interface MainLineFitOptions {
  /** The head's lines, as `levelsOf` reads them. */
  readonly items: readonly LevelItem[];
  /** How each part looks at the reference's sizes: the `look` handed to `levelStack`. */
  readonly look: (part: LevelPart) => LevelLook;
  readonly measure: Measure;
  /**
   * How tall the head comes out at a scale. When given, the scale is lowered until the head is
   * no taller than the area's height (the cap); without it the height is not checked.
   */
  readonly heightAt?: (scale: number) => number;
  readonly parameters?: Partial<MainLineFitParameters>;
}

/** The search for the height cap stops when two scales are this close. */
const PRECISION = 0.001;

/**
 * The scale at which the first part written `#` fills the area's width on one line, kept between
 * the minimum and the maximum, then lowered until the head fits the area's height. 1 when the
 * head has no `#` part or nothing can measure: the reference's sizes. Below the minimum it never
 * goes; a head still too tall there is the caller's to shrink or report.
 *
 * The main line is measured as one line of its words in its own style, transformed as it is
 * drawn (capitals, say); letter spacing is not counted.
 */
export function mainLineScale(area: Area, options: MainLineFitOptions): number {
  const values = parameterValues(MAIN_LINE_FIT_PARAMETERS, options.parameters);
  const minimum = Math.min(values.minScale, values.maxScale);
  const maximum = Math.max(values.minScale, values.maxScale);

  const main = mainPart(options.items);
  if (main === undefined) return 1;
  const look = options.look(main);
  const words = look.transform === undefined ? main.words : look.transform(main.words);
  const natural = naturalWidth(words, look.style, options.measure);
  if (natural === undefined || natural <= 0) return 1;

  const filling = Math.min(maximum, Math.max(minimum, area.width / natural));
  const heightAt = options.heightAt;
  if (heightAt === undefined || !Number.isFinite(area.height)) return filling;
  if (heightAt(filling) <= area.height) return filling;
  if (heightAt(minimum) > area.height) return minimum;

  // The largest scale between the minimum and the filling one at which the head fits.
  let fits = minimum;
  let tooTall = filling;
  while (tooTall - fits > PRECISION) {
    const middle = (fits + tooTall) / 2;
    if (heightAt(middle) <= area.height) fits = middle;
    else tooTall = middle;
  }
  return fits;
}

/** The first part written `#`: the main line's. */
function mainPart(items: readonly LevelItem[]): LevelPart | undefined {
  for (const item of items) {
    if (item.kind !== 'line') continue;
    const found = item.parts.find((part) => part.level === 1);
    if (found !== undefined) return found;
  }
  return undefined;
}
