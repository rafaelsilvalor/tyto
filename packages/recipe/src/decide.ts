import { type Result, ok } from '@tyto/core';
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
] as const;
const TIES = ['local', 'remote'] as const;
const REQUIRED = ['local', 'remote', 'last'] as const;
const USAGE =
  'takes one column and local=, remote= and last=, as in decide status local=sheet ' +
  'remote=tracker last=last_status values=todo,doing,done first-run-wins=done';

/**
 * What a sync does with a row: write the local value to the remote side (`push`), write the
 * remote value to the local side (`pull`), nothing (`same`), or nothing yet because the remote
 * side did not return the row this run (`hold`).
 */
export type DecideAction = 'push' | 'pull' | 'same' | 'hold';

/** The side that wins a row both sides changed since the last run. */
export type DecideTie = (typeof TIES)[number];

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
 * value, or by the last one.
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

  const localChanged = valid && local !== last;
  const remoteChanged = hasRemote && remote !== last;
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
 * [first-run-wins=<value>] [hold-when-empty=<column>] [tie=local|remote]` decides, for each row, which side of a
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
 * It writes six columns: `<column>`, the decided value; `<column>_action`, push, pull, same or
 * hold; `<column>_push`, the decided value on a push row and empty on every other, which is what
 * a write to the remote side reads; `<column>_overrides`, true where both sides changed and the
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

  const sides: Column[] = [];
  for (const side of [...REQUIRED, 'hold-when-empty'] as const) {
    const argument = written.get(side);
    if (argument === undefined) continue;
    const column = resolveColumn(table.value, argument.value, at(argument.range), context.aliases);
    if (!column.ok) return column;
    sides.push(column.value);
  }
  const [localColumn, remoteColumn, lastColumn, holdColumn] = sides;
  if (localColumn === undefined || remoteColumn === undefined || lastColumn === undefined) {
    return argumentsProblem(context, USAGE);
  }

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
  const inPlace = name.toLowerCase() === localColumn.name.toLowerCase();
  const decidedColumn: Column = { name: inPlace ? localColumn.name : name, type: 'text', origin };
  const added: Column[] = [
    { name: `${name}_action`, type: 'text', origin },
    { name: `${name}_push`, type: 'text', origin },
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
  };
  const rows = table.value.rows.map((row): Row => {
    let decision = decideValue(
      {
        local: row.values[localColumn.name],
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
      decision = {
        ...decision,
        action: 'hold',
        overrides: false,
        overwritten: null,
        reason: 'remote did not return the row',
      };
    }
    const decided: Record<string, CellValue> = {
      [decidedColumn.name]: decision.value,
      [`${name}_action`]: decision.action,
      [`${name}_push`]: decision.action === 'push' ? decision.value : null,
      [`${name}_overrides`]: decision.overrides,
      [`${name}_overwritten`]: decision.overwritten,
      [`${name}_reason`]: decision.reason,
    };
    return { ...row, values: { ...row.values, ...decided } };
  });
  const columns = inPlace
    ? table.value.columns.map((column) =>
        column.name === localColumn.name ? decidedColumn : column,
      )
    : [...table.value.columns, decidedColumn];
  return ok({ table: { columns: [...columns, ...added], rows } });
}

function isTie(value: string): value is DecideTie {
  return (TIES as readonly string[]).includes(value);
}

async function readValues(
  context: VerbContext,
  argument: NamedArgument,
): Promise<Result<readonly string[], Problems>> {
  if (isDataReference(argument.value)) return readDataArgument(context, argument, VALUES);
  return ok(columnNames([argument]).map((value) => value.value));
}
