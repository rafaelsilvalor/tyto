import {
  type Diagnostic,
  type Diagnostics,
  type LineIndex,
  createLineIndex,
  hasErrors,
  lineColumnAtIndex,
  sortDiagnostics,
} from '@tyto/core';

/**
 * Diagnostics as a person reads them, and as a program reads them.
 *
 * `path:line:col: severity CODE message` is the shape every editor, every `make` and
 * every CI log scraper already knows how to jump to, which is the only reason to prefer
 * it over something prettier.
 *
 * ## Which file a range indexes
 *
 * A `Diagnostic.range` is a pair of offsets and says nothing about what it offsets *into*
 * (`docs/conventions.md`). A render produces diagnostics about the brief and about the
 * template in one flat list, so line 12 means two different lines depending on which. The
 * CLI knows, because it is the composition root: it registers an origin for the
 * diagnostics a source produced as that source produces them ({@link registerOrigin}),
 * and falls back to the run's primary file for everything else. A diagnostic with no
 * range prints without a position rather than with a made-up one.
 */

export interface DiagnosticOrigin {
  /** As it should be printed — relative to the cwd where the command was run. */
  readonly path: string;
  /** The text the range offsets into. */
  readonly source: string;
}

/**
 * Keyed on the diagnostic object itself, which survives the journey: `runJob` collects
 * diagnostics by pushing the same objects into one array rather than rebuilding them.
 * A `WeakMap` so a long-running `tyto watch` does not accumulate one entry per task.
 */
const origins = new WeakMap<Diagnostic, DiagnosticOrigin>();

/** Records where these diagnostics' ranges point, for whoever prints them later. */
export function registerOrigin(items: Diagnostics, origin: DiagnosticOrigin): void {
  for (const item of items) origins.set(item, origin);
}

export interface ReportOptions {
  /** The file a range indexes when nothing more specific was registered for it. */
  readonly primary?: DiagnosticOrigin;
}

/** One `LineIndex` per source, because building one is a pass over the whole text. */
function indexer(): (source: string) => LineIndex {
  const cache = new Map<string, LineIndex>();
  return (source) => {
    const found = cache.get(source);
    if (found !== undefined) return found;
    const built = createLineIndex(source);
    cache.set(source, built);
    return built;
  };
}

/** `path:line:col: error E_CODE Message.` plus an indented hint when there is one. */
export function formatDiagnostics(items: Diagnostics, options: ReportOptions = {}): string {
  const indexOf = indexer();

  return sortDiagnostics(items)
    .map((item) => {
      const origin = origins.get(item) ?? options.primary;
      const position =
        item.range === undefined || origin === undefined
          ? undefined
          : lineColumnAtIndex(indexOf(origin.source), item.range.start);

      const where =
        origin === undefined
          ? ''
          : position === undefined
            ? `${origin.path}: `
            : `${origin.path}:${String(position.line)}:${String(position.column)}: `;

      const hint = item.hint === undefined ? '' : `\n    ${item.hint}`;
      return `${where}${item.severity} ${item.code} ${item.message}${hint}\n`;
    })
    .join('');
}

/** What `--json` prints for a command that has no artifacts to report. */
export interface DiagnosticsDocument {
  readonly status: 'ok' | 'error';
  readonly diagnostics: readonly {
    readonly severity: string;
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly line?: number;
    readonly column?: number;
    readonly hint?: string;
  }[];
}

export function diagnosticsDocument(
  items: Diagnostics,
  options: ReportOptions = {},
): DiagnosticsDocument {
  const indexOf = indexer();

  return {
    status: hasErrors(items) ? 'error' : 'ok',
    diagnostics: sortDiagnostics(items).map((item) => {
      const origin = origins.get(item) ?? options.primary;
      const position =
        item.range === undefined || origin === undefined
          ? undefined
          : lineColumnAtIndex(indexOf(origin.source), item.range.start);

      // Spread rather than assigned `undefined`: `exactOptionalPropertyTypes` tells an
      // absent key from an undefined one, and a reader of the JSON should see neither.
      return {
        severity: item.severity,
        code: item.code,
        message: item.message,
        ...(origin === undefined ? {} : { path: origin.path }),
        ...(position === undefined ? {} : { line: position.line, column: position.column }),
        ...(item.hint === undefined ? {} : { hint: item.hint }),
      };
    }),
  };
}

/** Two spaces of indent and a trailing newline, the shape every `--json` here prints. */
export function json(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
