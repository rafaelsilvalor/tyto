import { AsyncLocalStorage } from 'node:async_hooks';

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

/**
 * Records where these diagnostics' ranges point, for whoever prints them later.
 *
 * **The first claim wins.** A source registers what it produced as it produces it, and
 * the caller that later registers everything a stage handed back — `renderTask` naming the
 * brief — is the fallback for whatever nobody claimed. Overwriting was the bug: a markup
 * error at `template.html` line 15 printed as `promo.brief:15:1`, a real line of the wrong
 * file (TYTO-174).
 */
export function registerOrigin(items: Diagnostics, origin: DiagnosticOrigin): void {
  for (const item of items) if (!origins.has(item)) origins.set(item, origin);
}

/**
 * Diagnostics about no file the run names: a plugin file's source that could not be fetched,
 * say. The fallback to the run's primary file would print them under the brief's name, which
 * points at a file that has nothing to do with them (TYTO-456).
 */
const unplaced = new WeakSet<Diagnostic>();

/** Marks these diagnostics as printed with no path when no source claimed them. */
export function registerUnplaced(items: Diagnostics): void {
  for (const item of items) unplaced.add(item);
}

function originOf(item: Diagnostic, options: ReportOptions): DiagnosticOrigin | undefined {
  return origins.get(item) ?? (unplaced.has(item) ? undefined : options.primary);
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

/** A diagnostic with the file and the line it points at, as `--json` and the sink carry it. */
export interface LocatedDiagnostic {
  readonly severity: string;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  readonly hint?: string;
}

/**
 * Where each diagnostic points, sorted: the one reading both the printed text and the
 * `--json` document are made from, so the two can never place a diagnostic differently.
 */
function locate(items: Diagnostics, options: ReportOptions): LocatedDiagnostic[] {
  const indexOf = indexer();

  return sortDiagnostics(items).map((item) => {
    const origin = originOf(item, options);
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
  });
}

/**
 * The run's diagnostics sink (`environment.diagnostics`, ADR 0159 decision 7), held for the
 * run's own asynchronous work and nobody else's: two runs at once in the window each reach
 * their own. Carried this way rather than threaded through every command, so every place that
 * prints diagnostics reaches it, and what it prints is not touched.
 */
const sinks = new AsyncLocalStorage<(items: readonly LocatedDiagnostic[]) => void>();

/** Runs `work` with `sink` receiving every diagnostic the run prints. */
export function withDiagnosticsSink<T>(
  sink: ((items: readonly LocatedDiagnostic[]) => void) | undefined,
  work: () => T,
): T {
  return sink === undefined ? work() : sinks.run(sink, work);
}

function reported(located: readonly LocatedDiagnostic[]): void {
  if (located.length > 0) sinks.getStore()?.(located);
}

/** `path:line:col: error E_CODE Message.` plus an indented hint when there is one. */
export function formatDiagnostics(items: Diagnostics, options: ReportOptions = {}): string {
  const located = locate(items, options);
  reported(located);

  return located
    .map((item) => {
      const where =
        item.path === undefined
          ? ''
          : item.line === undefined || item.column === undefined
            ? `${item.path}: `
            : `${item.path}:${String(item.line)}:${String(item.column)}: `;

      const hint = item.hint === undefined ? '' : `\n    ${item.hint}`;
      return `${where}${item.severity} ${item.code} ${item.message}${hint}\n`;
    })
    .join('');
}

/** What `--json` prints for a command that has no artifacts to report. */
export interface DiagnosticsDocument {
  readonly status: 'ok' | 'error';
  readonly diagnostics: readonly LocatedDiagnostic[];
}

export function diagnosticsDocument(
  items: Diagnostics,
  options: ReportOptions = {},
): DiagnosticsDocument {
  const located = locate(items, options);
  reported(located);
  return { status: hasErrors(items) ? 'error' : 'ok', diagnostics: located };
}

/** Two spaces of indent and a trailing newline, the shape every `--json` here prints. */
export function json(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
