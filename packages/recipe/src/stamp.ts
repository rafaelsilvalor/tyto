import { ok } from '@tyto/core';

import { compileFormat, formatStamp } from './age.js';
import type { NamedArgument } from './ast.js';
import { systemClock, wallClock } from './clock.js';
import { resolveColumn } from './columns.js';
import { withColumns } from './compose.js';
import type { VerbContext, VerbResult } from './registry.js';
import {
  argumentsProblem,
  locate,
  namedValueOffset,
  refuseNamed,
  requireTable,
  rowFilter,
} from './support.js';
import { type CellValue, type Row, cellText } from './table.js';

const NAMES = ['when', 'format', 'clear-when'] as const;

/**
 * `stamp <column> when="<where>" format="dd-MM HH:mm" [clear-when="<where>"]` writes the run's
 * wall-clock time (ADR 0139) into the empty cells of `<column>` on the rows `when` keeps, as
 * Buraqueira's `carimbo` wrote when a task was first seen done: `stamp done_at when="status =
 * done" format="dd-MM HH:mm"`. The format takes the tokens `age` reads (dd, MM, yyyy, HH, mm),
 * so `age` reads back what `stamp` wrote with the same format.
 *
 * A cell that holds anything is never overwritten: a date a person typed is the date the work
 * was done, and stamping again would erase it. `clear-when=` empties the cell on the rows it
 * keeps instead, and those rows are not stamped. A flow clears only a stamp it wrote, which it
 * knows because it remembered it (ADR 0140 decision 9): `clear-when="status != done AND
 * last_done_at is not empty"`, after `last` and before `remember … columns=done_at`.
 */
export function stamp(context: VerbContext): VerbResult {
  const named = refuseNamed(context, [...NAMES]);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes one column, when= the rows it stamps and format= how it writes the time, as in ' +
    'stamp done_at when="status = done" format="dd-MM HH:mm"';

  const written = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (written.has(argument.name)) {
      return argumentsProblem(context, `was given '${argument.name}=' twice`, at(argument.range));
    }
    written.set(argument.name, argument);
  }
  const [target, extra] = context.step.positional;
  const whenArgument = written.get('when');
  const formatArgument = written.get('format');
  if (target === undefined || whenArgument === undefined || formatArgument === undefined) {
    return argumentsProblem(context, usage);
  }
  if (extra !== undefined) return argumentsProblem(context, usage, at(extra.range));

  const format = compileFormat(formatArgument.value.trim());
  if (!format.ok) return argumentsProblem(context, format.error, at(formatArgument.range));
  const column = resolveColumn(table.value, target.value, at(target.range), context.aliases);
  if (!column.ok) return column;
  const source = table.value;
  const filterOf = (argument: NamedArgument) =>
    rowFilter(context, source, argument.value, namedValueOffset(argument));
  const stamped = filterOf(whenArgument);
  if (!stamped.ok) return stamped;
  const clearArgument = written.get('clear-when');
  const cleared = clearArgument === undefined ? ok((_row: Row) => false) : filterOf(clearArgument);
  if (!cleared.ok) return cleared;

  const clock = context.clock ?? systemClock;
  const now = formatStamp(format.value, wallClock(clock, clock.now()));
  const name = column.value.name;
  const result = withColumns(
    source,
    [{ name, type: column.value.type }],
    `stamp ${name}`,
    (row) => {
      const cell: CellValue = row.values[name] ?? null;
      if (cleared.value(row)) return { [name]: null };
      if (cellText(cell).trim() === '' && stamped.value(row)) return { [name]: now };
      return { [name]: cell };
    },
  );
  return ok({ table: result });
}
