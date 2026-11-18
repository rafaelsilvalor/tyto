import type { FormatCatalogue } from '../config/formats.js';
import type { Size } from '../scene/primitives.js';
import type { DeliveryFormatCount } from './delivery-record.js';

/**
 * A delivery's exports checked against its record (TYTO-757, ADR 0215): what landed in the
 * delivery's exports folder, by pixel size, against the formats and counts the record owes.
 *
 * Pure: the host reads each image's width and height from its header and counts the editables;
 * this decides. Every problem is a sentence naming the file or the format, so a person reads
 * what is missing without opening anything.
 */

/**
 * The aspect ratios an image snaps to, as `[width, height]`: the usual post and story shapes.
 * A ratio within {@link ASPECT_TOLERANCE} of one of them reads as it, so `1081x1350` reads `4:5`.
 *
 * The same table, tolerance and words as the shapes a plugin counts on a remote folder, so a
 * recipe maps an export found here and one found there through one vocabulary table. A plugin
 * imports `aspectOf` from `@tyto/plugin-api` rather than keeping a copy that drifts.
 */
export const ASPECT_RATIOS: readonly (readonly [number, number])[] = [
  [1, 1],
  [4, 5],
  [9, 16],
  [16, 9],
  [3, 2],
  [2, 3],
];

/** How far, relative to a usual ratio, an image's ratio may stray and still read as it. */
export const ASPECT_TOLERANCE = 0.02;

/** Wider than this reads `wide`: a banner, whose exact ratio varies with every placement. */
const WIDE_ABOVE = 2;

/**
 * An image's shape: a usual ratio it snaps to, `wide` past 2:1, its own ratio reduced
 * otherwise, and `?` when its size is unknown.
 */
export function aspectOf(width: number | undefined, height: number | undefined): string {
  if (width === undefined || height === undefined) return '?';
  const ratio = width / height;
  for (const [across, down] of ASPECT_RATIOS) {
    const usual = across / down;
    if (Math.abs(ratio - usual) <= ASPECT_TOLERANCE * usual) return `${across}:${down}`;
  }
  if (ratio > WIDE_ABOVE) return 'wide';
  const divisor = greatestCommonDivisor(width, height);
  return `${String(width / divisor)}:${String(height / divisor)}`;
}

/** `ratio:count` pairs joined by `,`, the most frequent first, ties by ratio. */
export function aspectsText(aspects: ReadonlyMap<string, number>): string {
  return [...aspects]
    .sort(([ratioA, countA], [ratioB, countB]) =>
      countA !== countB ? countB - countA : ratioA < ratioB ? -1 : ratioA > ratioB ? 1 : 0,
    )
    .map(([ratio, count]) => `${ratio}:${String(count)}`)
    .join(',');
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * Each format of a catalogue by its id and pixel size: what a format name `delivery.sizes` leaves
 * out falls back to (ADR 0215), so a host hands the catalogue it renders with.
 */
export function catalogueSizes(catalogue: FormatCatalogue): Readonly<Record<string, Size>> {
  const sizes: Record<string, Size> = {};
  for (const { id, w, h } of catalogue.list()) sizes[id] = { w, h };
  return sizes;
}

/** One image at the root of a delivery's exports folder; no size when its header did not read. */
export interface DeliveryImage {
  readonly name: string;
  readonly size?: Size;
}

/**
 * - `ready`: every format owed is there at its size, nothing extra, and an editable is kept.
 * - `incomplete`: images landed and something is missing, extra or the wrong size.
 * - `in-progress`: nothing has landed yet, or the record owes no formats to check against.
 */
export const DELIVERY_CHECK_STATES = ['ready', 'incomplete', 'in-progress'] as const;
export type DeliveryCheckState = (typeof DELIVERY_CHECK_STATES)[number];

export interface DeliveryCheckInput {
  /** What the record owes, in its order; absent when it names none. */
  readonly formats?: readonly DeliveryFormatCount[] | undefined;
  /** The pixel size of each format name: `delivery.sizes` over the format catalogue. */
  readonly sizes: Readonly<Record<string, Size>>;
  /** The images at the root of the exports folder. */
  readonly images: readonly DeliveryImage[];
  /** How many files besides the record sit in the record's folder. */
  readonly editables: number;
}

export interface DeliveryCheck {
  readonly state: DeliveryCheckState;
  /** Each problem in a sentence: setup first, then formats in the record's order, then files. */
  readonly problems: readonly string[];
  /** The shapes found, as {@link aspectsText} writes them; `''` when nothing landed. */
  readonly found: string;
}

/** The images against what the record owes; see {@link DeliveryCheckState}. */
export function checkDelivery(input: DeliveryCheckInput): DeliveryCheck {
  const images = [...input.images].sort((a, b) => compare(a.name, b.name));
  const aspects = new Map<string, number>();
  for (const image of images) {
    const aspect = aspectOf(image.size?.w, image.size?.h);
    aspects.set(aspect, (aspects.get(aspect) ?? 0) + 1);
  }
  const found = aspectsText(aspects);
  const formats = input.formats ?? [];
  if (formats.length === 0) {
    return { state: 'in-progress', problems: ['the record owes no formats to check'], found };
  }

  const sizeOf = (format: string): Size | undefined =>
    Object.hasOwn(input.sizes, format) ? input.sizes[format] : undefined;
  const setup = formats
    .filter(({ format }) => sizeOf(format) === undefined)
    .map(({ format }) => `no size is known for '${format}'; add it to delivery.sizes`);
  if (images.length === 0) return { state: 'in-progress', problems: setup, found };

  // Each image goes to the first format of its size that still owes one, in the record's order,
  // so two formats of one size share the images before either counts an extra.
  const counted = new Map<string, number>();
  const strays: DeliveryImage[] = [];
  for (const image of images) {
    const owed = formats.find(
      ({ format, count }) =>
        sameSize(sizeOf(format), image.size) && (counted.get(format) ?? 0) < count,
    );
    if (owed === undefined) strays.push(image);
    else counted.set(owed.format, (counted.get(owed.format) ?? 0) + 1);
  }

  const problems = [...setup];
  for (const { format, count } of formats) {
    const size = sizeOf(format);
    const have = counted.get(format) ?? 0;
    if (size !== undefined && have < count) {
      problems.push(`'${format}' has ${String(have)} of ${String(count)} at ${sizeText(size)}`);
    }
  }
  const owedSizes = formats.flatMap(({ format }) => {
    const size = sizeOf(format);
    return size === undefined ? [] : [`${format} ${sizeText(size)}`];
  });
  for (const image of strays) {
    if (image.size === undefined) {
      problems.push(`'${image.name}' is an image whose size cannot be read`);
    } else if (formats.some(({ format }) => sameSize(sizeOf(format), image.size))) {
      problems.push(`'${image.name}' is one ${sizeText(image.size)} more than the record owes`);
    } else {
      const owed = owedSizes.length === 0 ? 'no size Tyto knows' : owedSizes.join(', ');
      problems.push(`'${image.name}' is ${sizeText(image.size)}, and the record owes ${owed}`);
    }
  }
  if (input.editables === 0) problems.push('no editable is kept beside the record');
  return { state: problems.length === 0 ? 'ready' : 'incomplete', problems, found };
}

function sameSize(expected: Size | undefined, actual: Size | undefined): boolean {
  return (
    expected !== undefined &&
    actual !== undefined &&
    expected.w === actual.w &&
    expected.h === actual.h
  );
}

function sizeText(size: Size): string {
  return `${String(size.w)}×${String(size.h)}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
