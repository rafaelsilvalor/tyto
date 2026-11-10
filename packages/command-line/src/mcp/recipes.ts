import type { Diagnostic } from '@tyto/core';
import type { RunHeld, RunnerAnswer, RunnerCell } from '@tyto/io';
import type { CellValue, Plan, Table } from '@tyto/recipe';

import { type LocatedDiagnostic, diagnosticsDocument } from '../report.js';

/**
 * What `run_recipe` answers an agent (ADR 0185, note of 2026-11-10): each cell's table and plan,
 * cut to what an agent's context holds, with no row's provenance and no plan's payload.
 *
 * A plan's payload is the plugin's own data for applying it (ADR 0170): the host never reads it,
 * and what a plugin keeps there is not the agent's to see. A row's provenance names where the
 * row came from and when; the table's values are the answer. Nothing else leaves: no section, no
 * state, no credential, none of which a cell carries.
 */

/** Rows a cell answers at most; the rest are counted in `omitted`. */
export const RECIPE_ROWS_MAX = 50;
/** Planned operations a cell answers at most; the rest are counted in `omitted`. */
export const RECIPE_OPERATIONS_MAX = 50;
/** The longest text a value keeps; a longer one is cut and ends in `…`. */
export const RECIPE_TEXT_MAX = 500;

export interface RecipeTableAnswer {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  /** Each row's key and values, in the table's order, at most {@link RECIPE_ROWS_MAX}. */
  readonly rows: readonly {
    readonly key: string;
    readonly values: Readonly<Record<string, CellValue>>;
  }[];
  readonly total: number;
  readonly omitted: number;
}

export interface RecipePlanAnswer {
  /** The id `apply` names, with the cell's index; a run that plans again gives a new one. */
  readonly id: number | null;
  /** The plan may be applied now: the cell ran, is not applied, and its verb can apply. */
  readonly applicable: boolean;
  readonly target: string;
  readonly count: number;
  readonly operations: readonly {
    readonly write: string;
    readonly rowKey?: string;
    readonly description: string;
  }[];
  readonly omitted: number;
}

export interface RecipeAppliedAnswer {
  readonly at: string;
  readonly operations: readonly {
    readonly rowKey?: string;
    readonly status: 'applied' | 'failed' | 'skipped';
    readonly reason?: string;
  }[];
}

export interface RecipeCellAnswer {
  readonly index: number;
  readonly line: number;
  readonly status: RunnerCell['status'];
  readonly diagnostics: readonly LocatedDiagnostic[];
  readonly table?: RecipeTableAnswer;
  readonly plan?: RecipePlanAnswer;
  readonly applied?: RecipeAppliedAnswer;
}

export interface RecipeRunAnswer {
  /** The recipe as the person would type its path. */
  readonly recipe: string;
  /** Always false for a run: a run changes nothing outside the session (ADR 0172 decision 2). */
  readonly applied: false;
  /** Why cells were left stale; `apply` is never set by this tool, which runs no `apply auto`. */
  readonly held?: RunHeld;
  /** The whole file's: a syntax error, a parameter without a value. */
  readonly diagnostics: readonly LocatedDiagnostic[];
  readonly cells: readonly RecipeCellAnswer[];
}

export interface RecipeApplyAnswer {
  readonly recipe: string;
  /** Whether the plan was handed to its verb; false when it was refused. */
  readonly applied: boolean;
  readonly cell: RecipeCellAnswer;
}

const cut = (value: CellValue): CellValue => {
  if (typeof value === 'string') {
    return value.length > RECIPE_TEXT_MAX ? `${value.slice(0, RECIPE_TEXT_MAX - 1)}…` : value;
  }
  return Array.isArray(value) ? value.map(cut) : value;
};

function tableAnswer(table: Table): RecipeTableAnswer {
  const kept = table.rows.slice(0, RECIPE_ROWS_MAX);
  return {
    columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
    rows: kept.map((row) => ({
      key: row.key,
      values: Object.fromEntries(
        Object.entries(row.values).map(([name, value]) => [name, cut(value)]),
      ),
    })),
    total: table.rows.length,
    omitted: table.rows.length - kept.length,
  };
}

function planAnswer(plan: Plan, cell: RunnerCell): RecipePlanAnswer {
  const kept = plan.operations.slice(0, RECIPE_OPERATIONS_MAX);
  return {
    id: cell.planId ?? null,
    applicable: cell.applicable === true,
    target: plan.target,
    count: plan.count,
    // The payload is left out on purpose: see the module comment.
    operations: kept.map((operation) => ({
      write: operation.write,
      ...(operation.rowKey === undefined ? {} : { rowKey: operation.rowKey }),
      description: operation.description,
    })),
    omitted: plan.operations.length - kept.length,
  };
}

/** The recipe's text and path, which every located diagnostic points into. */
export interface RecipeSource {
  readonly shown: string;
  readonly text: string;
}

function located(
  diagnostics: readonly Diagnostic[],
  source: RecipeSource,
): readonly LocatedDiagnostic[] {
  return diagnosticsDocument(diagnostics, { primary: { path: source.shown, source: source.text } })
    .diagnostics;
}

export function cellAnswer(cell: RunnerCell, source: RecipeSource): RecipeCellAnswer {
  return {
    index: cell.index,
    line: cell.line,
    status: cell.status,
    diagnostics: located(cell.diagnostics, source),
    ...(cell.table === undefined ? {} : { table: tableAnswer(cell.table) }),
    ...(cell.plan === undefined ? {} : { plan: planAnswer(cell.plan, cell) }),
    ...(cell.applied === undefined
      ? {}
      : {
          applied: {
            at: cell.applied.at,
            operations: cell.applied.operations.map((operation) => ({
              ...(operation.rowKey === undefined ? {} : { rowKey: operation.rowKey }),
              status: operation.status,
              ...(operation.reason === undefined ? {} : { reason: operation.reason }),
            })),
          },
        }),
  };
}

export function runAnswer(answer: RunnerAnswer, source: RecipeSource): RecipeRunAnswer {
  return {
    recipe: source.shown,
    applied: false,
    ...(answer.held === undefined ? {} : { held: answer.held }),
    diagnostics: located(answer.diagnostics, source),
    cells: answer.cells.map((cell) => cellAnswer(cell, source)),
  };
}
