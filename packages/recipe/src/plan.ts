import { type Diagnostic, type Result, diagnostic, err, ok } from '@tyto/core';

import type { Table } from './table.js';

/**
 * What an action or a sink answers instead of writing (ADR 0129, ADR 0135 decision 10): the
 * target, one line per operation, and how many there are. Running the cell writes nothing; the
 * notebook shows the plan, and Apply hands this same plan back to the verb (ADR 0170). Fields may
 * be added here, never removed or retyped.
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
  /**
   * The plugin's own data for applying this operation as it was shown (ADR 0170): the issue's
   * id and the status it read, a join's right-hand target. The host never reads it; it is kept
   * with the plan and handed back on Apply, so the plugin need not plan again.
   */
  readonly payload?: JsonValue;
}

/** A value that survives `JSON.stringify` and back unchanged. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface PlanLimits {
  readonly maxOperations: number;
  /** Of one operation's `description`, in characters. */
  readonly maxDescriptionLength: number;
  /** Of one operation's `payload` written as JSON, in UTF-8 bytes. */
  readonly maxPayloadBytes: number;
}

/**
 * Provisional, like the page ceilings (ADR 0135, amended in its second pull request): a plan
 * is read by a person before it is applied, and ten thousand lines is already more than anybody
 * reads. A plan past it is an error at a known number, never a plan shown in part.
 */
export const PLAN_LIMITS: PlanLimits = {
  maxOperations: 10_000,
  maxDescriptionLength: 500,
  // A payload names what to write and what was read, not the row: ten thousand of them stay
  // near 20 MB, which a plan kept until Apply can afford (ADR 0170).
  maxPayloadBytes: 2048,
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
 * a payload within its ceiling, and no more operations than the ceiling. Pure, so it guards a built-in action the same way.
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
    if (operation.payload !== undefined) {
      const bytes = utf8Length(JSON.stringify(operation.payload));
      if (bytes > limits.maxPayloadBytes) {
        problems.push(
          `${where} has a payload of ${String(bytes)} bytes, over ${String(limits.maxPayloadBytes)}`,
        );
      }
    }
  }
  return problems.length === 0 ? ok(plan) : refuse(problems.join('; '));
}

/** How many problems one diagnostic names. */
const REPORTED = 8;

/** Counted by hand, since this package may not reach for a runtime's `TextEncoder`. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
