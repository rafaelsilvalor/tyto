/**
 * @tyto/core — the vocabulary every other package speaks.
 *
 * Today: `Result`, `Diagnostic`, the diagnostic catalog and source ranges. The Scene IR,
 * the visitor, the ports and the template SDK follow in epics E2 and E4. Pure: no Node,
 * no DOM (ADR 0010).
 */

export {
  type DiagnosticCode,
  type DiagnosticCodeDefinition,
  type DiagnosticParams,
  type DiagnosticSeverity,
  diagnosticCodeDefinition,
  diagnosticCodeList,
  diagnosticCodes,
  formatDiagnosticMessage,
  placeholderNames,
} from './diagnostics/codes.js';

export {
  type Diagnostic,
  type DiagnosticOptions,
  diagnostic,
  hasErrors,
  isError,
  isWarning,
  sortDiagnostics,
} from './diagnostics/diagnostic.js';

export {
  type Diagnostics,
  type Err,
  type Ok,
  type Result,
  all,
  andThen,
  err,
  fromDiagnostics,
  isErr,
  isOk,
  map,
  mapError,
  match,
  ok,
  unwrapOr,
  unwrapOrElse,
  withWarnings,
} from './result/result.js';

export {
  type LineColumn,
  type LineColumnRange,
  type LineIndex,
  type SourceRange,
  compareRanges,
  createLineIndex,
  emptyRangeAt,
  isEmptyRange,
  lineColumnAt,
  lineColumnAtIndex,
  lineColumnRange,
  lineColumnRangeAtIndex,
  rangeContains,
  rangeContainsRange,
  rangeLength,
  rangesIntersect,
  sliceRange,
  sourceRange,
  unionRanges,
} from './source/range.js';
