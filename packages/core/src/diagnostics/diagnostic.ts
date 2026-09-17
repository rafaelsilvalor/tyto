import {
  type DiagnosticCode,
  type DiagnosticCodeDefinition,
  type DiagnosticParams,
  type DiagnosticSeverity,
  diagnosticCodes,
  formatDiagnosticMessage,
} from './codes.js';
import { compareRanges, type SourceRange } from '../source/range.js';

/**
 * An error or warning as data.
 *
 * Diagnostics are values, not exceptions: they travel from a pure stage to the editor
 * gutter, to the CLI's stderr and into `result.json` without anyone catching anything.
 */
export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly range?: SourceRange;
  /** What the author should do about it, when there is a concrete suggestion. */
  readonly hint?: string;
}

export interface DiagnosticOptions {
  readonly range?: SourceRange;
  readonly hint?: string;
}

/**
 * The only way to build a `Diagnostic`. Severity and wording come from the catalog, so a
 * code cannot drift from its message and the generated doc stays true.
 */
export function diagnostic<Code extends DiagnosticCode>(
  code: Code,
  params: DiagnosticParams<Code>,
  options: DiagnosticOptions = {},
): Diagnostic {
  const base = {
    severity: diagnosticCodes[code].severity,
    code,
    message: formatDiagnosticMessage(code, params),
  };
  // Built by spreading rather than by assigning undefined, because
  // exactOptionalPropertyTypes distinguishes an absent key from an undefined one.
  return {
    ...base,
    ...(options.range !== undefined ? { range: options.range } : {}),
    ...(options.hint !== undefined ? { hint: options.hint } : {}),
  };
}

export function isError(item: Diagnostic): boolean {
  return item.severity === 'error';
}

export function isWarning(item: Diagnostic): boolean {
  return item.severity === 'warning';
}

export function hasErrors(items: readonly Diagnostic[]): boolean {
  return items.some(isError);
}

/**
 * Whether this one stops a stage from producing anything at all (ADR 0025).
 *
 * Read out of the catalogue rather than off the occurrence, for the same reason severity
 * is: a code means one thing everywhere, and `docs/diagnostic-codes.md` can only publish
 * the list because the list is data. Where one code needed two answers — a syntax error in
 * the frontmatter against one in the body — the answer was to split the code.
 *
 * A warning is never fatal, whatever its entry says: warnings have ridden the ok branch
 * since ADR 0013 and nothing about this card moves them.
 *
 * An unrecognised code counts as fatal. A `Diagnostic` can arrive from a `result.json` or
 * across the desktop's bridge, and a code this build has never heard of is one whose
 * consequences it cannot weigh — refusing to draw is the answer that cannot mislead.
 */
export function isFatal(item: Diagnostic): boolean {
  if (item.severity === 'warning') return false;
  // Read through a widened view of the catalogue, because a code that is not in it is
  // exactly the case this has to answer and the keyed type says that cannot happen.
  const catalogue: Readonly<Record<string, DiagnosticCodeDefinition>> = diagnosticCodes;
  return catalogue[item.code]?.fatal ?? true;
}

export function hasFatal(items: readonly Diagnostic[]): boolean {
  return items.some(isFatal);
}

/** `[fatal, survivable]` — what a stage sends to `err`, and what rides with its value. */
export function partitionByFatality(
  items: readonly Diagnostic[],
): readonly [readonly Diagnostic[], readonly Diagnostic[]] {
  return [items.filter(isFatal), items.filter((item) => !isFatal(item))];
}

/**
 * Source order first, then severity, then code — the order a reader wants when a brief
 * produces a screenful of diagnostics. Positionless diagnostics sort last, since there is
 * nowhere in the file to look for them.
 */
export function sortDiagnostics(items: readonly Diagnostic[]): readonly Diagnostic[] {
  return [...items].sort((a, b) => {
    if (a.range && b.range) {
      const byRange = compareRanges(a.range, b.range);
      if (byRange !== 0) return byRange;
    } else if (a.range) {
      return -1;
    } else if (b.range) {
      return 1;
    }
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return a.code.localeCompare(b.code);
  });
}
