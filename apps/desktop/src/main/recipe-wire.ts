import type { Diagnostic } from '@tyto/core';
import { type CellValue, type Table, cellText } from '@tyto/recipe';

import { type IpcResponse, RECIPE_WIRE_LIMITS } from '../../shared/ipc.js';
import type { RunnerAnswer, RunnerCell } from './recipe-runner.js';

/**
 * A recipe run as it crosses to the window (TYTO-377, ADR 0148): each cell's first rows and how
 * many it has, every value already as the notebook shows it, every text cut to a length a cell
 * can hold. The runner keeps whole tables in main; the window is shown a preview of each, and
 * the bounds are `RECIPE_WIRE_LIMITS`, which the channel's schema checks again.
 */

type WireAnswer = Omit<IpcResponse<'recipe:run'>, 'requestId'>;
type WireCell = WireAnswer['cells'][number];
type WireDiagnostic = WireAnswer['diagnostics'][number];
type WireValue = string | number | boolean | null;

export function recipeAnswerToWire(answer: RunnerAnswer): WireAnswer {
  return {
    cells: answer.cells.slice(0, RECIPE_WIRE_LIMITS.cells).map(cellToWire),
    diagnostics: diagnosticsToWire(answer.diagnostics),
    ...(answer.held === undefined ? {} : { held: answer.held }),
    ranAt: answer.ranAt,
  };
}

function cellToWire(cell: RunnerCell): WireCell {
  return {
    index: cell.index,
    line: cell.line,
    status: cell.status,
    ...(cell.table === undefined ? {} : { table: tableToWire(cell.table) }),
    ...(cell.plan === undefined
      ? {}
      : { plan: { target: cut(cell.plan.target), count: cell.plan.count } }),
    diagnostics: diagnosticsToWire(cell.diagnostics),
    ...(cell.ranAt === undefined ? {} : { ranAt: cell.ranAt }),
    ...(cell.oldestFetchedAt === undefined ? {} : { oldestFetchedAt: cell.oldestFetchedAt }),
    ...(cell.source === true ? { source: true } : {}),
  };
}

function tableToWire(table: Table): NonNullable<WireCell['table']> {
  const columns = table.columns.slice(0, RECIPE_WIRE_LIMITS.columns);
  return {
    columns: columns.map((column) => ({ name: cut(column.name), type: column.type })),
    rows: table.rows.slice(0, RECIPE_WIRE_LIMITS.rows).map((row) => ({
      key: cut(row.key),
      values: columns.map((column) => valueToWire(row.values[column.name])),
    })),
    total: table.rows.length,
  };
}

/** A list joined the way a person writes it, a long text cut; numbers and booleans as they are. */
export function valueToWire(value: CellValue | undefined): WireValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return cut(typeof value === 'string' ? value : cellText(value));
}

/** At most `RECIPE_WIRE_LIMITS.text` characters, the last an ellipsis when it was cut. */
export function cut(text: string): string {
  const limit = RECIPE_WIRE_LIMITS.text;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function diagnosticsToWire(diagnostics: readonly Diagnostic[]): WireDiagnostic[] {
  return diagnostics.slice(0, RECIPE_WIRE_LIMITS.diagnostics).map((item) => ({
    severity: item.severity,
    code: item.code,
    message: item.message,
    ...(item.range === undefined ? {} : { range: item.range }),
    ...(item.hint === undefined ? {} : { hint: item.hint }),
  }));
}
