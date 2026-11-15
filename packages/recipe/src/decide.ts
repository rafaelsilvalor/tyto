import { type Diagnostic, type Result, type SourceRange, diagnostic, ok } from '@tyto/core';
import { z } from 'zod';

import type { NamedArgument } from './ast.js';
import { isWritableColumnName, resolveColumn } from './columns.js';
import { isDataReference, readDataArgument } from './data.js';
import type { VerbContext, VerbResult } from './registry.js';
import {
  type Problems,
  argumentsProblem,
  columnNames,
  locate,
  refuseNamed,
  requireTable,
} from './support.js';
import { type CellValue, type Column, type Row, cellText, comparable } from './table.js';

const VALUES = z.array(z.string());

const NAMES = [
  'local',
  'remote',
  'last',
  'values',
  'first-run-wins',
  'hold-when-empty',
  'tie',
  'clear',
  'clear-limit',
] as const;
const TIES = ['local', 'remote'] as const;
const CLEARS = ['push', 'pull'] as const;
const REQUIRED = ['local', 'remote', 'last'] as const;
/**
 * The most clears one run of `decide` pushes when `clear-limit=` is not given (TYTO-714). A
 * person clears a handful of cells between runs; a sheet read that lost cells clears dozens.
 */
export const DEFAULT_CLEAR_LIMIT = 5;
const USAGE =
  'takes one column and local=, remote= and last=, as in decide status local=sheet ' +
  'remote=tracker last=last_status values=todo,doing,done first-run-wins=done; ' +
  'it also takes hold-when-empty=<column>, tie=local|remote, clear=push|pull and, with ' +
  'clear=push, clear-limit=<n>|none';

/**
 * What a sync does with a row: write the local value to the remote side (`push`), write the
 * remote value to the local side (`pull`), nothing (`same`), or nothing yet because the remote
 * side did not return the row this run (`hold`).
 */
export type DecideAction = 'push' | 'pull' | 'same' | 'hold';

/** The side that wins a row both sides changed since the last run. */
export type DecideTie = (typeof TIES)[number];

/** What a local value cleared since the last run does: reach the remote side, or not. */
export type DecideClear = (typeof CLEARS)[number];

export interface Decision {
  readonly action: DecideAction;
  /** What the local side holds after the run, spelt as the side it came from spells it. */
  readonly value: CellValue;
  /** Both sides changed since the last run, and the winner overwrites the other's change. */
  readonly overrides: boolean;
  /** When `overrides`, the losing side's value, as it spells it; empty otherwise. */
  readonly overwritten: CellValue;
  /** The rule that fired, in a few words. */
  readonly reason: string;
}

export interface DecideSides {
  /** The local side's value now: a sheet's cell. */
  readonly local: CellValue | undefined;
  /** The remote side's value now, already mapped; empty when it maps to nothing. */
  readonly remote: CellValue | undefined;
  /** What the local side held after the last applied run; empty when nothing is known. */
  readonly last: CellValue | undefined;
}

export interface DecideRules {
  /** Whether a non-empty local value, folded by `comparable`, is one the sync recognises. */
  readonly isValid: (folded: string) => boolean;
  /** The folded value that beats the remote side on a first run, when there is one. */
  readonly firstRunWins?: string;
  /** The side that wins when both changed since the last run; `local` when not given. */
  readonly tie?: DecideTie;
  /**
   * `push` makes a local value cleared since the last run a local change that pushes the
   * empty value; `pull`, the default, lets the remote or the last value refill it.
   */
  readonly clear?: DecideClear;
}

/**
 * Which side wins a row, ported from Buraqueira's `decidir` (`lib_status.py`): whichever side
 * moved since the last run wins, and when both moved the side `tie` names does (the local one
 * unless told otherwise), saying it overrides and which value it overwrote.
 * Values compare by `comparable`, so accents, case and surrounding blanks do not count.
 *
 * With no last value, a first run or a lost state, any local value may be a stale mirror of
 * the remote one, so only `firstRunWins` beats the remote side; without `firstRunWins` the
 * remote side fills every row it has a value for, as `decidir_responsavel` did. An empty remote
 * value is an intermediate status: it never wins, and a local change still pushes over it. A
 * local value that is empty or not recognised never pushes; it is replaced by the remote
 * value, or by the last one. The one exception is `clear: 'push'`: an empty local value where
 * the last one was not is a local change, cleared since the last run, and pushes the empty
 * value as any local change pushes (TYTO-647). It never applies without a last value.
 */
export function decideValue(sides: DecideSides, rules: DecideRules): Decision {
  const local = comparable(sides.local);
  const remote = comparable(sides.remote);
  const last = comparable(sides.last);
  const valid = local !== '' && rules.isValid(local);
  const hasRemote = remote !== '';
  const push = (reason: string, overwritten?: CellValue): Decision => ({
    action: 'push',
    value: spelt(sides.local),
    overrides: overwritten !== undefined,
    overwritten: overwritten === undefined ? null : spelt(overwritten),
    reason,
  });
  const pull = (
    value: CellValue | undefined,
    reason: string,
    overwritten?: CellValue,
  ): Decision => ({
    action: 'pull',
    value: spelt(value),
    overrides: overwritten !== undefined,
    overwritten: overwritten === undefined ? null : spelt(overwritten),
    reason,
  });
  const same = (reason: string): Decision => ({
    action: 'same',
    value: spelt(sides.local),
    overrides: false,
    overwritten: null,
    reason,
  });

  if (last === '') {
    if (!valid) {
      return hasRemote
        ? pull(sides.remote, 'no state, local value not recognised')
        : same('no state, no value recognised');
    }
    if (local === remote) return same('no state, both agree');
    if (rules.firstRunWins !== undefined && local === rules.firstRunWins) {
      return push('no state, local first-run value wins');
    }
    if (!hasRemote) return same('no state, remote intermediate');
    return pull(
      sides.remote,
      rules.firstRunWins === undefined
        ? 'no state, remote fills'
        : 'no state, only the first-run value beats remote',
    );
  }

  const remoteChanged = hasRemote && remote !== last;
  if (local === '' && rules.clear === 'push') {
    if (!hasRemote) return same('both already agree');
    if (!remoteChanged) return push('local cleared');
    return (rules.tie ?? 'local') === 'local'
      ? push('both changed, local cleared and wins', sides.remote ?? null)
      : pull(sides.remote, 'both changed, remote wins', sides.local ?? null);
  }
  const localChanged = valid && local !== last;
  if (localChanged) {
    if (local === remote) return same('both already agree');
    if (!remoteChanged) return push('local changed');
    return (rules.tie ?? 'local') === 'local'
      ? push('both changed, local wins', sides.remote ?? null)
      : pull(sides.remote, 'both changed, remote wins', sides.local ?? null);
  }
  if (remoteChanged) return pull(sides.remote, 'remote changed');
  if (!valid) {
    return pull(hasRemote ? sides.remote : sides.last, 'local value not recognised');
  }
  return same('nothing changed');
}

/** A decided value as text, as the side it came from spells it; empty is null. */
function spelt(value: CellValue | undefined): CellValue {
  const text = cellText(value);
  return text.trim() === '' ? null : text;
}

/**
 * `decide <column> local=<column> remote=<column> last=<column> [values=a,b|@ref]
 * [first-run-wins=<value>] [hold-when-empty=<column>] [tie=local|remote] [clear=push|pull]`
 * decides, for each row, which side of a
 * sync wins (ADR 0140), as in `decide status local=sheet remote=tracker last=last_status
 * values=@./flows.json#/statuses first-run-wins=done hold-when-empty=tracker_key`.
 *
 * `local` is the local side's value now, `remote` the remote side's, already mapped to the
 * local side's values (empty where it maps to nothing), and `last` what the last applied run
 * left on the local side, which `last` reads (empty where nothing is known). `values=` lists
 * the local values the sync recognises, written inline or as a data reference to a list of
 * strings; without it, every non-empty local value is recognised. `first-run-wins=` is the one
 * value that beats the remote side when nothing is known (see `decideValue`).
 *
 * `hold-when-empty=` names a column that is empty on a row the remote side did not return:
 * there a push becomes `hold`, the decided value stays the local one, and a `remember` with
 * `when="<column>_action != hold"` leaves the row's state as it was, so the next run tries again.
 *
 * `tie=` names the side that wins a row both sides changed since the last run: `local`, the
 * default, pushes the local value; `remote` pulls the remote one. Either way the row says it
 * overrides, and which value it overwrote (TYTO-421).
 *
 * `clear=` says what a local value cleared since the last run does: `pull`, the default, lets
 * the remote value (or the last one) fill it again, so clearing a cell never reaches the remote
 * side; `push` pushes the empty value, a change like any other, which `tie=` settles when the
 * remote side changed too. With no last value an empty local value never pushes (TYTO-647).
 *
 * With `clear=push`, two guards hold clears that look like a lost read rather than a person's
 * edits (TYTO-714). When the `local=` column is missing from the table, or empty on every row
 * while `last` holds values, no clear is pushed that run, and one warning names the column. When
 * a run would push more clears than `clear-limit=` (5 when not given; `none` lifts it), none is
 * pushed, and one warning gives the count and how to release them. A held clear is a `hold`
 * row, as `hold-when-empty=` holds one, whose decided value is the last one: `_push` is empty,
 * `_pushes` false, and a `remember` of the decided column stores the value it already held,
 * with or without `when=`, so the next run sees the same clear again. A missing `local=` column
 * is an error without `clear=push`, as any unknown column is.
 *
 * It writes seven columns: `<column>`, the decided value; `<column>_action`, push, pull, same or
 * hold; `<column>_push`, the decided value on a push row and empty on every other, which is what
 * a write to the remote side reads; `<column>_pushes`, true exactly on a push row whatever its
 * value, so a write can tell a push of an empty value from no push at all, which `_push` alone
 * cannot (TYTO-647); `<column>_overrides`, true where both sides changed and the
 * winner overwrites the other's change; `<column>_overwritten`, the losing side's value there,
 * and empty elsewhere; and `<column>_reason`, the rule that fired. `<column>` may be the `local=`
 * column itself, which is then rewritten in place, as `map` rewrites its `into=`, so a synced
 * sheet's column keeps its header; every other column must be new to the table.
 */
export async function decide(context: VerbContext): Promise<VerbResult> {
  const named = refuseNamed(context, [...NAMES]);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);

  const [nameArgument, extra] = context.step.positional;
  if (nameArgument === undefined || extra !== undefined) {
    return argumentsProblem(context, USAGE, extra === undefined ? undefined : at(extra.range));
  }
  const name = nameArgument.value;
  if (!isWritableColumnName(name, nameArgument.quoted)) {
    return argumentsProblem(
      context,
      `names its columns with letters, digits, - and _, starting with a letter or _, not '${name}'`,
      at(nameArgument.range),
    );
  }

  const written = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (written.has(argument.name)) {
      return argumentsProblem(context, `was given '${argument.name}=' twice`, at(argument.range));
    }
    written.set(argument.name, argument);
  }
  const missing = REQUIRED.filter((required) => !written.has(required));
  if (missing.length > 0) {
    return argumentsProblem(context, `needs ${missing.map((each) => `${each}=`).join(', ')}`);
  }

  const clearArgument = written.get('clear');
  const clear = clearArgument === undefined ? 'pull' : clearArgument.value;
  if (!isClear(clear)) {
    return argumentsProblem(
      context,
      `takes clear=push or clear=pull, not clear=${clear}`,
      clearArgument === undefined ? undefined : at(clearArgument.range),
    );
  }
  const limitArgument = written.get('clear-limit');
  if (limitArgument !== undefined && clear !== 'push') {
    return argumentsProblem(
      context,
      'takes clear-limit= only with clear=push, the one setting that pushes a clear',
      at(limitArgument.range),
    );
  }
  const clearLimit = limitArgument === undefined ? DEFAULT_CLEAR_LIMIT : readLimit(limitArgument);
  if (clearLimit === undefined) {
    return argumentsProblem(
      context,
      `takes clear-limit=<a whole number> or clear-limit=none, not clear-limit=${limitArgument?.value ?? ''}`,
      limitArgument === undefined ? undefined : at(limitArgument.range),
    );
  }

  const sides: (Column | undefined)[] = [];
  let missingLocal: string | undefined;
  for (const side of REQUIRED) {
    const argument = written.get(side);
    if (argument === undefined) return argumentsProblem(context, USAGE);
    const column = resolveColumn(table.value, argument.value, at(argument.range), context.aliases);
    if (!column.ok) {
      // A sheet whose read lost the local column must not error out of a sync, nor clear the
      // remote side: with clear=push the run goes on and holds every clear (TYTO-714).
      const unknown = column.error.every((each) => each.code === 'E_RECIPE_UNKNOWN_COLUMN');
      if (side === 'local' && clear === 'push' && unknown) {
        missingLocal = argument.value;
        sides.push(undefined);
        continue;
      }
      return column;
    }
    sides.push(column.value);
  }
  const holdArgument = written.get('hold-when-empty');
  let holdColumn: Column | undefined;
  if (holdArgument !== undefined) {
    const column = resolveColumn(
      table.value,
      holdArgument.value,
      at(holdArgument.range),
      context.aliases,
    );
    if (!column.ok) return column;
    holdColumn = column.value;
  }
  const [localColumn, remoteColumn, lastColumn] = sides;
  if (remoteColumn === undefined || lastColumn === undefined) {
    return argumentsProblem(context, USAGE);
  }
  const localName = localColumn?.name ?? missingLocal ?? '';

  const tieArgument = written.get('tie');
  const tie = tieArgument === undefined ? 'local' : tieArgument.value;
  if (!isTie(tie)) {
    return argumentsProblem(
      context,
      `takes tie=local or tie=remote, not tie=${tie}`,
      tieArgument === undefined ? undefined : at(tieArgument.range),
    );
  }

  const origin = `decide ${name}`;
  const inPlace =
    localColumn !== undefined && name.toLowerCase() === localColumn.name.toLowerCase();
  const decidedColumn: Column = { name: inPlace ? localName : name, type: 'text', origin };
  const added: Column[] = [
    { name: `${name}_action`, type: 'text', origin },
    { name: `${name}_push`, type: 'text', origin },
    { name: `${name}_pushes`, type: 'boolean', origin },
    { name: `${name}_overrides`, type: 'boolean', origin },
    { name: `${name}_overwritten`, type: 'text', origin },
    { name: `${name}_reason`, type: 'text', origin },
  ];
  const taken = (inPlace ? added : [decidedColumn, ...added]).filter((column) =>
    table.value.columns.some(
      (existing) => existing.name.toLowerCase() === column.name.toLowerCase(),
    ),
  );
  if (taken.length > 0) {
    return argumentsProblem(
      context,
      `would add ${taken.map((column) => column.name).join(', ')}, which the table already ` +
        `has; choose another name than '${name}'`,
      at(nameArgument.range),
    );
  }

  const valuesArgument = written.get('values');
  const values =
    valuesArgument === undefined ? undefined : await readValues(context, valuesArgument);
  if (values !== undefined && !values.ok) return values;
  const recognised =
    values === undefined ? undefined : new Set(values.value.map((value) => comparable(value)));
  if (recognised !== undefined && valuesArgument !== undefined) {
    recognised.delete('');
    if (recognised.size === 0) {
      return argumentsProblem(
        context,
        'lists at least one value in values=',
        at(valuesArgument.range),
      );
    }
  }

  const firstRunArgument = written.get('first-run-wins');
  const firstRunWins =
    firstRunArgument === undefined ? undefined : comparable(firstRunArgument.value);
  if (firstRunArgument !== undefined) {
    if (firstRunWins === '') {
      return argumentsProblem(
        context,
        'needs a value in first-run-wins=',
        at(firstRunArgument.range),
      );
    }
    if (recognised !== undefined && firstRunWins !== undefined && !recognised.has(firstRunWins)) {
      return argumentsProblem(
        context,
        `lets '${firstRunArgument.value}' win a first run, which values= does not list`,
        at(firstRunArgument.range),
      );
    }
  }

  const rules: DecideRules = {
    isValid: (folded) => recognised === undefined || recognised.has(folded),
    ...(firstRunWins === undefined ? {} : { firstRunWins }),
    tie,
    clear,
  };
  const decisions = table.value.rows.map((row): Decision => {
    const decision = decideValue(
      {
        local: localColumn === undefined ? null : row.values[localColumn.name],
        remote: row.values[remoteColumn.name],
        last: row.values[lastColumn.name],
      },
      rules,
    );
    if (
      decision.action === 'push' &&
      holdColumn !== undefined &&
      comparable(row.values[holdColumn.name]) === ''
    ) {
      return {
        ...decision,
        action: 'hold',
        overrides: false,
        overwritten: null,
        reason: 'remote did not return the row',
      };
    }
    return decision;
  });
  const guarded =
    clear === 'push'
      ? guardClears(table.value.rows, decisions, {
          localName,
          missing: missingLocal !== undefined,
          lastName: lastColumn.name,
          limit: clearLimit,
          range: context.written.range,
        })
      : { decisions, warnings: [] };
  const rows = table.value.rows.map((row, index): Row => {
    const decision = guarded.decisions[index] ?? decisions[index];
    if (decision === undefined) return row;
    const decided: Record<string, CellValue> = {
      [decidedColumn.name]: decision.value,
      [`${name}_action`]: decision.action,
      [`${name}_push`]: decision.action === 'push' ? decision.value : null,
      [`${name}_pushes`]: decision.action === 'push',
      [`${name}_overrides`]: decision.overrides,
      [`${name}_overwritten`]: decision.overwritten,
      [`${name}_reason`]: decision.reason,
    };
    return { ...row, values: { ...row.values, ...decided } };
  });
  const columns = inPlace
    ? table.value.columns.map((column) => (column.name === localName ? decidedColumn : column))
    : [...table.value.columns, decidedColumn];
  return ok({ table: { columns: [...columns, ...added], rows } }, guarded.warnings);
}

interface ClearGuard {
  /** The `local=` column, as the table names it, or as the step wrote it when it is missing. */
  readonly localName: string;
  readonly missing: boolean;
  readonly lastName: string;
  /** The most clears one run pushes; `Infinity` for `clear-limit=none`. */
  readonly limit: number;
  readonly range: SourceRange;
}

/**
 * Holds every clear of a run that looks like a lost read rather than a person's edits
 * (TYTO-714): the local column missing, or empty on every row while `last` holds values, or
 * more clears than the limit. A clear is a push of the empty value; nothing else pushes one.
 */
function guardClears(
  rows: readonly Row[],
  decisions: readonly Decision[],
  guard: ClearGuard,
): { readonly decisions: readonly Decision[]; readonly warnings: readonly Diagnostic[] } {
  const clears = decisions.filter(isClearPush).length;
  const lostColumn =
    guard.missing ||
    (rows.length > 0 &&
      rows.every((row) => comparable(row.values[guard.localName]) === '') &&
      rows.some((row) => comparable(row.values[guard.lastName]) !== ''));
  const warnings: Diagnostic[] = [];
  let reason: string | undefined;
  if (lostColumn && (guard.missing || clears > 0)) {
    reason = 'clear held, local column lost';
    warnings.push(
      diagnostic(
        'W_RECIPE_DECIDE_CLEAR_COLUMN',
        {
          column: guard.localName,
          problem: guard.missing ? 'is missing from the table' : 'is empty on every row',
          count: clears,
        },
        { range: guard.range },
      ),
    );
  } else if (clears > guard.limit) {
    reason = 'clear held, over clear-limit';
    warnings.push(
      diagnostic(
        'W_RECIPE_DECIDE_CLEAR_LIMIT',
        { count: clears, limit: String(guard.limit) },
        { range: guard.range },
      ),
    );
  }
  if (reason === undefined || clears === 0) return { decisions, warnings };
  const held = reason;
  return {
    decisions: decisions.map((decision, index) =>
      isClearPush(decision)
        ? {
            action: 'hold',
            // The last value, so that remembering the decided column keeps the state as it was.
            value: spelt(rows[index]?.values[guard.lastName]),
            overrides: false,
            overwritten: null,
            reason: held,
          }
        : decision,
    ),
    warnings,
  };
}

function isClearPush(decision: Decision): boolean {
  return decision.action === 'push' && decision.value === null;
}

/** `clear-limit=`'s value: a whole number, or `none` for no limit; undefined otherwise. */
function readLimit(argument: NamedArgument): number | undefined {
  const value = argument.value.trim().toLowerCase();
  if (value === 'none') return Number.POSITIVE_INFINITY;
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

function isTie(value: string): value is DecideTie {
  return (TIES as readonly string[]).includes(value);
}

function isClear(value: string): value is DecideClear {
  return (CLEARS as readonly string[]).includes(value);
}

async function readValues(
  context: VerbContext,
  argument: NamedArgument,
): Promise<Result<readonly string[], Problems>> {
  if (isDataReference(argument.value)) return readDataArgument(context, argument, VALUES);
  return ok(columnNames([argument]).map((value) => value.value));
}
