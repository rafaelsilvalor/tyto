import { InvalidArgumentError } from 'commander';

import type { OutputRequest } from '@tyto/pipeline';

/**
 * Turning what a shell can carry — strings — into what the pipeline takes.
 *
 * Every one of these throws `InvalidArgumentError`, which commander prints as a usage
 * error and exits on. That is deliberately **not** a diagnostic: `--scale banana` is not
 * something a brief could have caused, and reporting it in `result.json` would put a
 * typo on the command line into a document about the artwork.
 */

/** The encodings `--types` accepts. `svg` is not a raster format; the other three are. */
export const OUTPUT_KINDS = ['png', 'jpeg', 'webp', 'svg'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

function isOutputKind(value: string): value is OutputKind {
  return (OUTPUT_KINDS as readonly string[]).includes(value);
}

/** `a, b ,c` → `['a','b','c']`, with the blanks a trailing comma leaves dropped. */
export function commaSeparated(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export function parseTypes(value: string): readonly OutputKind[] {
  const listed = commaSeparated(value);
  if (listed.length === 0) {
    throw new InvalidArgumentError(`--types needs at least one of ${OUTPUT_KINDS.join(', ')}.`);
  }

  const kinds: OutputKind[] = [];
  for (const entry of listed) {
    if (!isOutputKind(entry)) {
      throw new InvalidArgumentError(
        `'${entry}' is not an output type. Available: ${OUTPUT_KINDS.join(', ')}.`,
      );
    }
    // Deduplicated: asking for `png,png` would write the same file twice and count it
    // twice in `result.json`.
    if (!kinds.includes(entry)) kinds.push(entry);
  }
  return kinds;
}

export function parseFormatList(value: string): readonly string[] {
  const listed = commaSeparated(value);
  if (listed.length === 0) {
    throw new InvalidArgumentError('--formats needs at least one format id.');
  }
  return listed;
}

export function parsePositiveInteger(name: string): (value: string) => number {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new InvalidArgumentError(`${name} must be a positive whole number, got '${value}'.`);
    }
    return parsed;
  };
}

export function parseQuality(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError(
      `--quality must be a whole number from 1 to 100, got '${value}'.`,
    );
  }
  return parsed;
}

export interface OutputOptions {
  readonly types: readonly OutputKind[];
  readonly scale?: number;
  /** Refused on `png` by the rasterizer port, so it is only ever sent with jpeg or webp. */
  readonly quality?: number;
  readonly textAsPaths?: boolean;
}

/** One `OutputRequest` per requested encoding, in the order `--types` listed them. */
export function outputRequests(options: OutputOptions): readonly OutputRequest[] {
  return options.types.map((kind): OutputRequest => {
    if (kind === 'svg') {
      return {
        kind,
        ...(options.textAsPaths === undefined ? {} : { textAsPaths: options.textAsPaths }),
      };
    }
    return {
      kind,
      ...(options.scale === undefined ? {} : { scale: options.scale }),
      // Never on `png`: `resolveRasterOptions` throws a `TypeError` for it rather than
      // dropping it, and a `--quality` alongside `--types png,webp` means the webp.
      ...(options.quality === undefined || kind === 'png' ? {} : { quality: options.quality }),
    };
  });
}

/** True when any requested encoding needs a browser. */
export function needsRasterizer(types: readonly OutputKind[]): boolean {
  return types.some((kind) => kind !== 'svg');
}
