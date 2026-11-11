import { type Diagnostic, diagnostic } from '@tyto/core';
import type { RecipeRegistries, RecipeState } from '@tyto/plugin-api';
import {
  type AppliedOperation,
  type ApplyOutcome,
  type Plan,
  type StateWrite,
  stateToCommit,
} from '@tyto/recipe';

/**
 * Apply in the recipe notebook (TYTO-378, ADR 0170): one plan cell's plan handed back to its
 * verb, and the recipe's state committed from the outcome of every plan cell the notebook keeps.
 *
 * The plan applied is the **object the run kept**, never a copy and never one rebuilt from what
 * the window sent: `recipeRegistriesOf` finds the arguments and the table it was planned from by
 * that object, and refuses any other (ADR 0170 decision 3). The window names a cell and the
 * `planId` main stamped on its plan; this module refuses a plan replaced since, one applied
 * already, and one whose cell did not run this time.
 *
 * The state is committed only when every cell is `ok`: a stale or failed cell means the run's
 * `remember` writes are not the ones the plan was made with (ADR 0170 decision 4). Then the plan
 * is applied all the same, the person asked for it, and the cell says it was not remembered.
 */

/** A plan cell's Apply as the runner keeps it with the cell. */
export interface AppliedRecord {
  /** The host clock's instant when the verb answered. */
  readonly at: string;
  /** One per planned operation, in the plan's order; rows are the shown plan's (ADR 0170). */
  readonly operations: readonly AppliedOperation[];
}

/** What Apply reads of a kept cell. */
export interface ApplyCell {
  readonly status: 'ok' | 'failed' | 'skipped' | 'stale';
  /** The verb the cell's step names, which the plan is handed back to. */
  readonly verb?: string | undefined;
  readonly plan?: Plan | undefined;
  /** Main's id for the plan, stamped when the cell planned it. */
  readonly planId?: number | undefined;
  /** The cell's `remember` writes (`Cell.remembers`), kept so a reused cell still has them. */
  readonly remembers?: readonly StateWrite[] | undefined;
  readonly applied?: AppliedRecord | undefined;
}

export interface ApplyRequest {
  /** Every cell the notebook keeps for the document, in order. */
  readonly cells: readonly ApplyCell[];
  readonly index: number;
  readonly planId: number;
  /** Built for this Apply, over the live plugins, with the host clock as `now`. */
  readonly registries: RecipeRegistries;
  /** The recipe's state, **writable**; `undefined` outside a workspace or in no file. */
  readonly state: RecipeState | undefined;
  /** The host clock, as ISO 8601 in UTC. */
  readonly now: () => string;
}

export interface ApplyAnswer {
  /** Present when the verb was handed the plan and answered for it. */
  readonly applied?: AppliedRecord;
  /** Why it was refused, or why it was applied and not remembered. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The reason an operation of a plan nobody applied carries in the run's outcome. */
export const NOT_APPLIED = 'its plan was not applied';

export async function applyCell(request: ApplyRequest): Promise<ApplyAnswer> {
  const cell = request.cells[request.index];
  const verbName = cell?.verb ?? 'plan';
  const refuse = (problem: string): ApplyAnswer => ({
    diagnostics: [diagnostic('E_RECIPE_APPLY', { verb: verbName, problem })],
  });
  if (cell?.plan === undefined || cell.planId === undefined) {
    return refuse('the cell holds no plan');
  }
  if (cell.planId !== request.planId) {
    return refuse('the plan shown is not the one this cell holds now; look at the cell again');
  }
  if (cell.applied !== undefined) {
    return refuse('it was applied already; run the cell again for a new plan');
  }
  if (cell.status !== 'ok') return refuse('its cell did not run this time; run it again');
  const verb = cell.verb === undefined ? undefined : request.registries.verbs.get(cell.verb);
  if (verb?.apply === undefined) return refuse('the verb only plans; nothing applies it');

  // The kept object itself: the registries know it by identity, and refuse a copy.
  const answered = await verb.apply(cell.plan);
  if (!answered.ok) return { diagnostics: answered.error };
  const applied: AppliedRecord = { at: request.now(), operations: answered.value.operations };
  const remembered = await commitState(request, applied, verbName);
  return { applied, diagnostics: [...answered.diagnostics, ...remembered] };
}

/**
 * The run's outcome as ADR 0170 decision 4 reads it: this Apply's operations for its cell, the
 * last Apply of every other plan cell, and every operation of a plan never applied `skipped`,
 * so its rows keep their old state.
 */
export function runOutcome(
  cells: readonly ApplyCell[],
  index: number,
  applied: AppliedRecord,
): ApplyOutcome {
  const operations: AppliedOperation[] = [];
  cells.forEach((cell, at) => {
    if (cell.plan === undefined) return;
    if (at === index) {
      operations.push(...applied.operations);
    } else if (cell.applied !== undefined) {
      operations.push(...cell.applied.operations);
    } else {
      operations.push(
        ...cell.plan.operations.map((operation): AppliedOperation => ({
          ...(operation.rowKey === undefined ? {} : { rowKey: operation.rowKey }),
          status: 'skipped',
          reason: NOT_APPLIED,
        })),
      );
    }
  });
  return { operations };
}

/** Commits the recipe's state after an Apply, or says why it did not. */
function commitState(
  request: ApplyRequest,
  applied: AppliedRecord,
  verb: string,
): Promise<readonly Diagnostic[]> {
  return commitRemembers(
    request.cells,
    request.state,
    () => runOutcome(request.cells, request.index, applied),
    verb,
  );
}

/**
 * Whether a run's kept cells commit their `remember` writes with no Apply (TYTO-650, ADR 0170
 * note of 2026-11-11): every cell is ok, at least one holds a plan, every plan holds no
 * operation, and none was applied (an applied one committed already). A recipe with no plan
 * cell commits nothing, as ADR 0140 decision 4 keeps for a notebook that only reads. The run
 * being explicit, in a trusted folder and still the current one is the runner's to check.
 */
export function commitsWithoutApply(cells: readonly ApplyCell[]): boolean {
  const plans = cells.filter((cell) => cell.plan !== undefined);
  return (
    plans.length > 0 &&
    cells.every((cell) => cell.status === 'ok') &&
    plans.every((cell) => cell.plan?.operations.length === 0 && cell.applied === undefined)
  );
}

/**
 * Commits the `remember` writes of a run that planned nothing to write, as an Apply of its empty
 * plans would: the outcome is empty, so every write is stored and none is stamped `applied_at`,
 * since nothing was applied. Call it only when {@link commitsWithoutApply} holds.
 */
export function commitWithoutApply(
  cells: readonly ApplyCell[],
  state: RecipeState | undefined,
): Promise<readonly Diagnostic[]> {
  const verb = cells.find((cell) => cell.plan !== undefined)?.verb ?? 'plan';
  return commitRemembers(cells, state, () => ({ operations: [] }), verb);
}

/** Commits the run's `remember` writes against an outcome, or says why it did not. */
async function commitRemembers(
  cells: readonly ApplyCell[],
  state: RecipeState | undefined,
  outcomeOf: () => ApplyOutcome,
  verb: string,
): Promise<readonly Diagnostic[]> {
  const remembers = cells.flatMap((cell) => cell.remembers ?? []);
  if (remembers.length === 0) return [];
  const notRemembered = (problem: string) => [
    diagnostic('W_RECIPE_NOT_REMEMBERED', { verb, problem }),
  ];
  if (cells.some((cell) => cell.status !== 'ok')) {
    return notRemembered('a cell of the recipe is stale or failed; run the recipe again first');
  }
  if (state === undefined) return notRemembered('the recipe keeps no state here');
  for (const commit of stateToCommit(remembers, outcomeOf())) {
    const written = await state.write(commit.store, commit.puts, commit.deletes);
    if (!written.ok) {
      const why = written.error.map((found) => found.message.replace(/\.$/u, '')).join('; ');
      return notRemembered(`writing store '${commit.store}' failed (${why})`);
    }
  }
  return [];
}
