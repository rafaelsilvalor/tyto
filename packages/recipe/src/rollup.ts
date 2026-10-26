import { type Diagnostic, diagnostic, ok } from '@tyto/core';

import type { NamedArgument } from './ast.js';
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
import { type Row, cellText } from './table.js';

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;
const NAMED_IN_WARNING = 5;

/**
 * `rollup <column> parent=<column> [when="<where>"]` counts, for each row that is another row's
 * parent, its children that `when` keeps, and writes the count into `<column>` on the parent's
 * row (ADR 0140), as in `rollup open_artwork parent=parent when="kind = artwork AND ready = no"`.
 *
 * A child is a row whose `parent=` cell holds another row's key, compared as text without
 * surrounding blanks. A row no child names is no parent and gets an empty cell; a parent whose
 * children `when` all rejects gets 0, so `open_artwork > 0` reads "some artwork is open" and
 * `open_artwork is not empty` reads "this row is a parent". One step writes one count:
 * Buraqueira's `decidir_pai` is a few rollups and an ordered `rules` table over them.
 *
 * A child whose parent is not a row of the table counts nowhere, and one warning per step says
 * how many there are, since a recipe that never fetched the parents would otherwise read as
 * parents without children.
 */
export function rollup(context: VerbContext): VerbResult {
  const named = refuseNamed(context, ['parent', 'when']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    "takes one column to write and parent= the column naming each row's parent, as in " +
    'rollup open_artwork parent=parent when="kind = artwork AND ready = no"';

  const written = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (written.has(argument.name)) {
      return argumentsProblem(context, `was given '${argument.name}=' twice`, at(argument.range));
    }
    written.set(argument.name, argument);
  }
  const [target, extra] = context.step.positional;
  const parentArgument = written.get('parent');
  if (target === undefined || parentArgument === undefined) {
    return argumentsProblem(context, usage);
  }
  if (extra !== undefined) return argumentsProblem(context, usage, at(extra.range));
  if (!COLUMN_NAME.test(target.value)) {
    return argumentsProblem(
      context,
      `cannot write a column named '${target.value}'`,
      at(target.range),
    );
  }
  const parent = resolveColumn(
    table.value,
    parentArgument.value,
    at(parentArgument.range),
    context.aliases,
  );
  if (!parent.ok) return parent;
  if (parent.value.name.toLowerCase() === target.value.toLowerCase()) {
    return argumentsProblem(
      context,
      `would overwrite '${parent.value.name}', the column it reads parents from`,
      at(target.range),
    );
  }
  const whenArgument = written.get('when');
  const counted =
    whenArgument === undefined
      ? ok((_row: Row) => true)
      : rowFilter(context, table.value, whenArgument.value, namedValueOffset(whenArgument));
  if (!counted.ok) return counted;

  const keys = new Set(table.value.rows.map((row) => row.key));
  const counts = new Map<string, number>();
  const orphans: string[] = [];
  for (const row of table.value.rows) {
    const parentKey = cellText(row.values[parent.value.name]).trim();
    if (parentKey === '' || parentKey === row.key) continue;
    if (!keys.has(parentKey)) {
      orphans.push(`${row.key} → ${parentKey}`);
      continue;
    }
    counts.set(parentKey, (counts.get(parentKey) ?? 0) + (counted.value(row) ? 1 : 0));
  }

  const result = withColumns(
    table.value,
    [{ name: target.value, type: 'number' }],
    `rollup ${target.value}`,
    (row) => ({ [target.value]: counts.get(row.key) ?? null }),
  );
  return ok({ table: result }, orphanWarning(context, parent.value.name, orphans));
}

function orphanWarning(
  context: VerbContext,
  column: string,
  orphans: readonly string[],
): readonly Diagnostic[] {
  if (orphans.length === 0) return [];
  const named = orphans.slice(0, NAMED_IN_WARNING).join(', ');
  const more =
    orphans.length > NAMED_IN_WARNING ? ` and ${orphans.length - NAMED_IN_WARNING} more` : '';
  return [
    diagnostic(
      'W_RECIPE_ROLLUP_ORPHANS',
      { count: orphans.length, column, parents: `${named}${more}` },
      { range: context.written.textRange },
    ),
  ];
}
