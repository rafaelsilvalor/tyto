import type { Diagnostic } from '@tyto/core';
import { type CellValue, type Table, cellText } from '@tyto/recipe';

import { type IpcResponse, RECIPE_WIRE_LIMITS } from '../../shared/ipc.js';
import type { AppliedRecord } from './recipe-apply.js';
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

export function cellToWire(cell: RunnerCell): WireCell {
  return {
    index: cell.index,
    line: cell.line,
    status: cell.status,
    ...(cell.table === undefined ? {} : { table: tableToWire(cell.table) }),
    ...(cell.plan === undefined ? {} : { plan: planToWire(cell) }),
    ...(cell.applied === undefined ? {} : { applied: appliedToWire(cell.applied) }),
    diagnostics: diagnosticsToWire(cell.diagnostics),
    ...(cell.ranAt === undefined ? {} : { ranAt: cell.ranAt }),
    ...(cell.oldestFetchedAt === undefined ? {} : { oldestFetchedAt: cell.oldestFetchedAt }),
    ...(cell.source === true ? { source: true } : {}),
    ...(cell.view === undefined ? {} : { view: viewToWire(cell.view) }),
  };
}

// TYTO-379, ADR 0171: the cell's view and its arguments, every word cut as a value is.

function viewToWire(view: NonNullable<RunnerCell['view']>): NonNullable<WireCell['view']> {
  return {
    name: cut(view.name),
    options: Object.fromEntries(
      Object.entries(view.options).map(([name, value]) => [
        cut(name),
        typeof value === 'string'
          ? cut(value)
          : value.slice(0, RECIPE_WIRE_LIMITS.columns).map((word) => cut(word)),
      ]),
    ),
  };
}

// TYTO-378, ADR 0170: a plan's first lines and the id Apply names; an Apply's outcome, counted.

function planToWire(cell: RunnerCell): NonNullable<WireCell['plan']> {
  const plan = cell.plan as NonNullable<RunnerCell['plan']>;
  return {
    target: cut(plan.target),
    count: plan.count,
    operations: plan.operations.slice(0, RECIPE_WIRE_LIMITS.operations).map((operation) => ({
      write: cut(operation.write),
      ...(operation.rowKey === undefined ? {} : { rowKey: cut(operation.rowKey) }),
      description: cut(operation.description),
    })),
    ...(cell.planId === undefined ? {} : { planId: cell.planId }),
    applicable: cell.applicable === true,
  };
}

function appliedToWire(applied: AppliedRecord): NonNullable<WireCell['applied']> {
  const count = (status: string) =>
    applied.operations.filter((operation) => operation.status === status).length;
  return {
    at: applied.at,
    applied: count('applied'),
    failed: count('failed'),
    skipped: count('skipped'),
    operations: applied.operations.slice(0, RECIPE_WIRE_LIMITS.operations).map((operation) => ({
      status: operation.status,
      ...(operation.reason === undefined ? {} : { reason: cut(operation.reason) }),
    })),
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
