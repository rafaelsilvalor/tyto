import {
  type DiagnosticCode,
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
