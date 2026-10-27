import { ok } from '@tyto/core';

import type { NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import { withColumns } from './compose.js';
import type { VerbContext, VerbResult } from './registry.js';
import { argumentsProblem, columnNames, locate, refuseNamed, requireTable } from './support.js';
import {
  type CellValue,
  type Column,
  type Row,
  type Table,
  comparable,
  findColumn,
} from './table.js';

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;

/**
 * `group by=a,b [into=rows]` collapses the table to one row per group of rows whose `by=`
 * columns hold the same values (ADR 0146), as in `group by=kind,team`. Values compare as
 * `where` compares them (`comparable`), so `anúncio`, `ANÚNCIO` and `Anuncio` are one group and
 * the cell shows the spelling seen first. An empty cell is a group of its own, never dropped,
 * and a list cell groups by its text.
 *
 * The result has the `by=` columns, with their type and origin, and `into=` (default `rows`), a
 * list of the member rows' keys, which `count` turns into a number. Groups come in the order
 * their first row appears; `sort` reorders them.
 *
 * Grouping ends row identity: a group row stands for no source item. Its key is the JSON of the
 * compared values, `["anuncio","design"]`, so it never changes with the spelling seen first and
 * `remember` keeps finding it run after run (ADR 0140). Its provenance is `group`, the key as the
 * id, and the oldest `fetchedAt` among its members, since the group is only as fresh as that.
 */
export function group(context: VerbContext): VerbResult {
  const named = refuseNamed(context, ['by', 'into']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes by= the columns to group on and, optionally, into= the list column of member keys, ' +
    'as in group by=kind,team';

  const written = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (written.has(argument.name)) {
      return argumentsProblem(context, `was given '${argument.name}=' twice`, at(argument.range));
    }
    written.set(argument.name, argument);
  }
  const [stray] = context.step.positional;
  if (stray !== undefined) return argumentsProblem(context, usage, at(stray.range));
  const byArgument = written.get('by');
  if (byArgument === undefined) return argumentsProblem(context, usage);

  const columns: Column[] = [];
  for (const name of columnNames([byArgument])) {
    const column = resolveColumn(table.value, name.value, at(name.range), context.aliases);
    if (!column.ok) return column;
    // A repeated name is a clear intention, not a mistake, as in `select`.
    if (!columns.includes(column.value)) columns.push(column.value);
  }
  if (columns.length === 0) return argumentsProblem(context, usage, at(byArgument.range));

  const intoArgument = written.get('into');
  const into = intoArgument?.value ?? 'rows';
  const intoRange = intoArgument === undefined ? undefined : at(intoArgument.range);
  if (!COLUMN_NAME.test(into)) {
    return argumentsProblem(context, `cannot write a column named '${into}'`, intoRange);
  }
  const taken = columns.find((column) => column.name.toLowerCase() === into.toLowerCase());
  if (taken !== undefined) {
    return argumentsProblem(
      context,
      `would write the member keys over '${taken.name}', a column it groups by; name another ` +
        'with into=',
      intoRange,
    );
  }

  const groups = new Map<string, { values: Record<string, CellValue>; members: Row[] }>();
  for (const row of table.value.rows) {
    const compared = columns.map((column) => comparable(row.values[column.name]));
    const key = JSON.stringify(compared);
    const found = groups.get(key);
    if (found === undefined) {
      const values = Object.fromEntries(
        columns.map((column) => [column.name, row.values[column.name] ?? null]),
      );
      groups.set(key, { values, members: [row] });
    } else {
      found.members.push(row);
    }
  }

  const rows = [...groups.entries()].map(([key, { values, members }]): Row => ({
    key,
    values: { ...values, [into]: members.map((member) => member.key) },
    provenance: { source: 'group', id: key, fetchedAt: oldest(members) },
  }));
  const result: Table = {
    columns: [...columns, { name: into, type: 'list', origin: 'group' }],
    rows,
  };
  return ok({ table: result });
}

/** The earliest `fetchedAt` among the members, read as a date when both sides are one. */
function oldest(members: readonly Row[]): string {
  return members
    .map((member) => member.provenance.fetchedAt)
    .reduce((earliest, candidate) => (earlier(candidate, earliest) ? candidate : earliest));
}

function earlier(candidate: string, than: string): boolean {
  const left = Date.parse(candidate);
  const right = Date.parse(than);
  if (Number.isNaN(left) || Number.isNaN(right)) return candidate < than;
  return left < right;
}

/**
 * `count <list-column> [into=count]` writes into a number column how many items each row's list
 * holds (ADR 0146), as in `count rows into=tasks` after a `group`, or `count labels` on any
 * table. An empty cell holds no items and counts 0; an item that is itself empty still counts,
 * since `collect` writes one per column read. A list column is required: counting the
 * characters of a text would read as a count of something else. `into=` must name a column the
 * table lacks, so a count never replaces a column in silence.
 */
export function count(context: VerbContext): VerbResult {
  const named = refuseNamed(context, ['into']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes one list column and, optionally, into= the column to write, as in count rows';

  const intos = context.step.named.filter((argument) => argument.name === 'into');
  const [second] = intos.slice(1);
  if (second !== undefined) {
    return argumentsProblem(context, "was given 'into=' twice", at(second.range));
  }
  const [source, extra] = context.step.positional;
  if (source === undefined) return argumentsProblem(context, usage);
  if (extra !== undefined) return argumentsProblem(context, usage, at(extra.range));
  const column = resolveColumn(table.value, source.value, at(source.range), context.aliases);
  if (!column.ok) return column;
  if (column.value.type !== 'list') {
    return argumentsProblem(
      context,
      `counts the items of a list column, and '${column.value.name}' is ${column.value.type}`,
      at(source.range),
    );
  }

  const [intoArgument] = intos;
  const into = intoArgument?.value ?? 'count';
  const intoRange = intoArgument === undefined ? undefined : at(intoArgument.range);
  if (!COLUMN_NAME.test(into)) {
    return argumentsProblem(context, `cannot write a column named '${into}'`, intoRange);
  }
  const taken = findColumn(table.value, into);
  if (taken !== undefined) {
    return argumentsProblem(
      context,
      `would overwrite '${taken.name}', which the table has; name another with into=`,
      intoRange,
    );
  }

  const result = withColumns(
    table.value,
    [{ name: into, type: 'number' }],
    `count ${column.value.name}`,
    (row) => {
      const cell = row.values[column.value.name];
      return { [into]: Array.isArray(cell) ? cell.length : 0 };
    },
  );
  return ok({ table: result });
}
