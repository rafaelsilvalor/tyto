import { diagnostic, ok } from '@tyto/core';

import { age } from './age.js';
import { resolveColumn } from './columns.js';
import { collect, compose } from './compose.js';
import { derive } from './derive.js';
import { extract, rewrite } from './extract.js';
import { include } from './include.js';
import { join } from './join.js';
import { map } from './map.js';
import { last, remember } from './memory.js';
import { nearest } from './nearest.js';
import { path } from './path.js';
import type { Verb, VerbContext, VerbResult } from './registry.js';
import { rules } from './rules.js';
import { argumentsProblem, columnNames, refuseNamed, requireTable, rowFilter } from './support.js';
import { type CellValue, type Column, type Row, type Table, comparable } from './table.js';
import { urls } from './urls.js';

/**
 * The generic verbs this build implements (ADR 0128). Each reads the previous cell's table and
 * hands on a new one; none mutates what it was given, so a notebook can keep every cell's table.
 */
export const genericVerbs: Readonly<Record<string, Verb>> = {
  run: { kind: 'transform', run: include },
  where: { kind: 'transform', run: where },
  select: { kind: 'transform', run: select },
  join: { kind: 'transform', run: join },
  sort: { kind: 'transform', run: sort },
  derive: { kind: 'transform', run: derive },
  show: { kind: 'transform', run: show },
  keep: { kind: 'transform', run: keep },
  rules: { kind: 'transform', run: rules },
  compose: { kind: 'transform', run: compose },
  collect: { kind: 'transform', run: collect },
  extract: { kind: 'transform', run: extract },
  rewrite: { kind: 'transform', run: rewrite },
  urls: { kind: 'transform', run: urls },
  nearest: { kind: 'transform', run: nearest },
  map: { kind: 'transform', run: map },
  path: { kind: 'transform', run: path },
  age: { kind: 'transform', run: age },
  last: { kind: 'transform', run: last },
  remember: { kind: 'transform', run: remember },
};

/** `where <expression>`: keeps the rows that satisfy every predicate. */
function where(context: VerbContext): VerbResult {
  const table = requireTable(context);
  if (!table.ok) return table;
  // The expression is the whole argument text; a fully quoted one is read inside its quotes,
  // which is how `flow.py` wrote it on a command line.
  const text = context.step.text;
  const quoted = /^"[^"]*"$/u.test(text);
  const expression = quoted ? text.slice(1, -1) : text;
  const offset = context.written.textRange.start + (quoted ? 1 : 0);
  // Named arguments are not checked here: `kind=ad` tokenises as one, and here it is a predicate.
  const passes = rowFilter(context, table.value, expression, offset);
  if (!passes.ok) return passes;
  const rows = table.value.rows.filter(passes.value);
  const result: Table = { columns: table.value.columns, rows };
  const warnings =
    rows.length === 0 && table.value.rows.length > 0
      ? [diagnostic('W_RECIPE_WHERE_EMPTY', { expression }, { range: context.written.textRange })]
      : [];
  return ok({ table: result }, warnings);
}

/**
 * `select a, b` keeps those columns in that order; `select without=a,b` drops those and keeps
 * the rest in place. A name the table lacks aborts in both modes: dropping a misspelt column
 * in silence would leave it in the table looking removed.
 */
function select(context: VerbContext): VerbResult {
  const named = refuseNamed(context, ['without']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;

  const keepNames = columnNames(context.step.positional);
  const dropNames = columnNames(
    context.step.named.filter((argument) => argument.name === 'without'),
  );
  if (keepNames.length > 0 === dropNames.length > 0) {
    return argumentsProblem(
      context,
      'takes exactly one of two forms: the columns to keep (select key, status), or the ' +
        'columns to drop (select without=description,comment)',
    );
  }

  const resolved: Column[] = [];
  for (const name of keepNames.length > 0 ? keepNames : dropNames) {
    const column = resolveColumn(table.value, name.value, name.range, context.aliases);
    if (!column.ok) return column;
    // A repeated name is a clear intention, not a mistake.
    if (!resolved.includes(column.value)) resolved.push(column.value);
  }
  const columns =
    keepNames.length > 0
      ? resolved
      : table.value.columns.filter((column) => !resolved.includes(column));
  if (columns.length === 0) {
    return argumentsProblem(context, 'would leave the table without any column');
  }
  const rows = table.value.rows.map((row): Row => ({
    ...row,
    values: Object.fromEntries(
      columns.map((column) => [column.name, row.values[column.name] ?? null]),
    ),
  }));
  return ok({ table: { columns, rows } });
}

/**
 * `sort <column> [asc|desc]`. Stable, so a second `sort` before it decides ties. Numbers
 * compare as numbers and everything else as text without case or accents; an empty cell goes
 * last in both directions, because "no date" is not the earliest date.
 */
function sort(context: VerbContext): VerbResult {
  const named = refuseNamed(context, []);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;

  const [written, direction, extra] = context.step.positional;
  if (written === undefined || extra !== undefined) {
    return argumentsProblem(context, 'takes one column and, optionally, asc or desc');
  }
  const order = direction?.value.toLowerCase() ?? 'asc';
  if (order !== 'asc' && order !== 'desc') {
    return argumentsProblem(
      context,
      `sorts asc or desc, not '${direction?.value}'`,
      direction?.range,
    );
  }
  const column = resolveColumn(table.value, written.value, written.range, context.aliases);
  if (!column.ok) return column;

  const sign = order === 'desc' ? -1 : 1;
  const rows = [...table.value.rows].sort((first, second) =>
    compareCells(first.values[column.value.name], second.values[column.value.name], sign),
  );
  return ok({ table: { columns: table.value.columns, rows } });
}

function compareCells(first: CellValue | undefined, second: CellValue | undefined, sign: number) {
  const left = comparable(first);
  const right = comparable(second);
  if (left === '' || right === '') return (left === '' ? 1 : 0) - (right === '' ? 1 : 0);
  if (typeof first === 'number' && typeof second === 'number') return (first - second) * sign;
  if (left === right) return 0;
  return (left < right ? -1 : 1) * sign;
}

/**
 * `show <view>` picks how the notebook draws the table, and never which rows or columns it
 * has (ADR 0128). The view's name is the notebook's to check, since views arrive with it.
 */
function show(context: VerbContext): VerbResult {
  const named = refuseNamed(context, []);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const [view, extra] = context.step.positional;
  if (view === undefined || extra !== undefined) {
    return argumentsProblem(context, 'takes the name of one view, as in show table');
  }
  return ok({ table: table.value, view: view.value });
}

const KEPT_NAME = /^[A-Za-z0-9][\w-]*$/u;

/**
 * `keep <name>` asks for the table to be written into the workspace. It writes nothing
 * itself: the request rides the run's result, and the host writes it (ADR 0130).
 */
function keep(context: VerbContext): VerbResult {
  const named = refuseNamed(context, []);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const [name, extra] = context.step.positional;
  if (name === undefined || extra !== undefined || !KEPT_NAME.test(name.value)) {
    return argumentsProblem(
      context,
      'takes one name of letters, digits, - and _, as in keep open-tasks',
      name?.range,
    );
  }
  return ok({ table: table.value, keeps: [{ name: name.value, table: table.value }] });
}
