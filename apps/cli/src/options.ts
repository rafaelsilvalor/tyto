import { InvalidArgumentError } from 'commander';

import type { ArtifactKind, OutputRequest } from '@tyto/pipeline';
import type { ExporterRegistry } from '@tyto/plugin-api';

/**
 * Turning what a shell can carry — strings — into what the pipeline takes.
 *
 * Every one of these throws `InvalidArgumentError`, which commander prints as a usage
 * error and exits on. That is deliberately **not** a diagnostic: `--scale banana` is not
 * something a brief could have caused, and reporting it in `result.json` would put a
 * typo on the command line into a document about the artwork.
 */

/**
 * What `--types` holds: the built-in four, or a kind an installed exporter declares.
 *
 * Which kinds exist is not known when the command line is parsed — it is whatever the
 * registry holds once the installed plugins are activated (TYTO-47) — so {@link parseTypes}
 * checks only that a word is shaped like a kind, and {@link unavailableTypes} asks the
 * registry afterwards.
 */
export type OutputKind = ArtifactKind;

/** Lowercase letters, digits and hyphens: a kind becomes a file extension's neighbour. */
const KIND = /^[a-z0-9][a-z0-9-]*$/u;

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
    throw new InvalidArgumentError('--types needs at least one output type, such as png or svg.');
  }

  const kinds: OutputKind[] = [];
  for (const entry of listed) {
    if (!KIND.test(entry)) {
      throw new InvalidArgumentError(
        `'${entry}' is not an output type: a type is lowercase letters, digits and hyphens.`,
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

/**
 * The sentence to refuse a run with when a requested type has no exporter, or nothing.
 *
 * Exit 1 and not a diagnostic, exactly as when the list was hard-coded: `--types pdf` on a
 * machine with no pdf exporter is a command line to fix, not something the brief caused.
 */
export function unavailableTypes(
  types: readonly OutputKind[],
  exporters: ExporterRegistry,
): string | undefined {
  const missing = types.filter((kind) => exporters.forKind(kind) === undefined);
  if (missing.length === 0) return undefined;

  const available = exporters.list().flatMap((exporter) => exporter.kinds);
  return (
    `${missing.map((kind) => `'${kind}'`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} ` +
    `not an output type any installed exporter produces. Available: ${available.join(', ')}.`
  );
}

/** True when any requested encoding comes from an exporter whose document needs a browser. */
export function needsRasterizer(
  types: readonly OutputKind[],
  exporters: ExporterRegistry,
): boolean {
  return types.some((kind) => exporters.forKind(kind)?.rasterized === true);
}
