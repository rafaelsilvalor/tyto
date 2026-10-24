import { type Diagnostic, type Result, diagnostic, err, ok } from '@tyto/core';

import type { Table } from './table.js';

/**
 * What an action or a sink answers instead of writing (ADR 0129, ADR 0135 decision 10): the
 * target, one line per operation, and how many there are. Running the cell writes nothing; the
 * notebook shows the plan, and applying it is TYTO-378's, which may add fields here and never
 * remove or retype one.
 */
export interface Plan {
  /** What the writes land on, in the plugin's words: `Jira project MKT`, `sheet Pauta`. */
  readonly target: string;
  readonly operations: readonly PlannedOperation[];
  /** `operations.length`, said again so a plan cut in transit cannot pass as a smaller one. */
  readonly count: number;
}

export interface PlannedOperation {
  /** One of the kinds of write the verb declared (`transition`, `assign`). */
  readonly write: string;
  /** The row the operation stands for, when it stands for one; a key of the table it read. */
  readonly rowKey?: string;
  /** One line a person reads before applying it. */
  readonly description: string;
}

export interface PlanLimits {
  readonly maxOperations: number;
  /** Of one operation's `description`, in characters. */
  readonly maxDescriptionLength: number;
}

/**
 * Provisional, like the page ceilings (ADR 0135, amended in its second pull request): a plan
 * is read by a person before it is applied, and ten thousand lines is already more than anybody
 * reads. A plan past it is an error at a known number, never a plan shown in part.
 */
export const PLAN_LIMITS: PlanLimits = {
  maxOperations: 10_000,
  maxDescriptionLength: 500,
};

export interface PlanContext {
  /** The verb's name, for the diagnostic. */
  readonly verb: string;
  /** The kinds of write the verb declared; an operation of any other kind is refused. */
  readonly writes: readonly string[];
  /** The table the verb read, whose keys a `rowKey` must name. */
  readonly table: Table;
}

/**
 * Whether a plan is one the host may show (ADR 0129 decision 3): every operation a kind of
 * write the verb declared, a count that is the number of operations, a row key the table holds,
 * and no more operations than the ceiling. Pure, so it guards a built-in action the same way.
 *
 * Up to {@link REPORTED} problems are named, so one undeclared write repeated a thousand times
 * is one line and not a thousand.
 */
export function checkPlan(
  plan: Plan,
  context: PlanContext,
  limits: PlanLimits = PLAN_LIMITS,
): Result<Plan, readonly Diagnostic[]> {
  const refuse = (problem: string) =>
    err([diagnostic('E_RECIPE_PLAN', { verb: context.verb, problem })]);
  if (plan.target.trim() === '') return refuse('names no target');
  if (plan.operations.length > limits.maxOperations) {
    return refuse(
      `has ${String(plan.operations.length)} operations, over ${String(limits.maxOperations)}`,
    );
  }
  if (plan.count !== plan.operations.length) {
    return refuse(
      `counts ${String(plan.count)} operations and lists ${String(plan.operations.length)}`,
    );
  }

  const declared = new Set(context.writes);
  const keys = new Set(context.table.rows.map((row) => row.key));
  const problems: string[] = [];
  for (const [index, operation] of plan.operations.entries()) {
    if (problems.length >= REPORTED) break;
    const where = `operation ${String(index + 1)}`;
    if (!declared.has(operation.write)) {
      problems.push(
        `${where} writes '${operation.write}', and the verb declares ${
          context.writes.length > 0 ? context.writes.join(', ') : 'none'
        }`,
      );
    }
    if (operation.rowKey !== undefined && !keys.has(operation.rowKey)) {
      problems.push(`${where} names the row '${operation.rowKey}', which the table does not hold`);
    }
    if (operation.description.trim() === '') problems.push(`${where} has no description`);
    else if (operation.description.length > limits.maxDescriptionLength) {
      problems.push(
        `${where} has a description of ${String(operation.description.length)} characters, ` +
          `over ${String(limits.maxDescriptionLength)}`,
      );
    }
  }
  return problems.length === 0 ? ok(plan) : refuse(problems.join('; '));
}

/** How many problems one diagnostic names. */
const REPORTED = 8;
