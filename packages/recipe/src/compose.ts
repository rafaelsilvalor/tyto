import { type Result, err, ok } from '@tyto/core';
import { z } from 'zod';

import type { Argument } from './ast.js';
import { resolveColumn } from './columns.js';
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
import {
  type CellValue,
  type Column,
  type ColumnType,
  type Row,
  type Table,
  cellText,
} from './table.js';
import { bindTemplate, parseTemplate, templateProblem } from './template.js';

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;

/**
 * The table with `values` written into the columns named, each added at the end, or recomputed
 * in place when the table has it already (in any case), as a derivation recomputes one.
 */
export function withColumns(
  table: Table,
  produced: readonly { readonly name: string; readonly type: ColumnType }[],
  origin: string,
  values: (row: Row) => Readonly<Record<string, CellValue>>,
): Table {
  const columns = [...table.columns];
  const names = produced.map(({ name, type }) => {
    const at = columns.findIndex((column) => column.name.toLowerCase() === name.toLowerCase());
    const column: Column = { name: at === -1 ? name : (columns[at]?.name ?? name), type, origin };
    if (at === -1) columns.push(column);
    else columns[at] = column;
    return [name, column.name] as const;
  });
  const rows = table.rows.map((row): Row => {
    const computed = values(row);
    const written = Object.fromEntries(
      names.map(([name, canonical]) => [canonical, computed[name] ?? null]),
    );
    return { ...row, values: { ...row.values, ...written } };
  });
  return { columns, rows };
}

/** The flags a verb takes as bare words, or the problem with one that is not among them. */
function flags(
  context: VerbContext,
  allowed: readonly string[],
): Result<ReadonlySet<string>, Problems> {
  const found = new Set<string>();
  for (const argument of context.step.positional) {
    if (!allowed.includes(argument.value)) {
      const result = argumentsProblem(
        context,
        `takes the words ${allowed.join(' and ')}, not '${argument.value}'`,
        locate(context)(argument.range),
      );
      if (!result.ok) return result;
    }
    found.add(argument.value);
  }
  return ok(found);
}

/**
 * `compose <column>="<template>" [skip-empty] [required]` writes one text column from a
 * template (see `template.ts`), as in `compose folder="{course|slug}_{phase|slug}" skip-empty`.
 * The template may be read from a data file instead, `compose folder=@./names.json#/folder`.
 * `skip-empty` drops an empty placeholder with the separator before it; `required` leaves the
 * cell empty when any placeholder is. Both together: `required` decides first.
 */
export async function compose(context: VerbContext): Promise<VerbResult> {
  const table = requireTable(context);
  if (!table.ok) return table;
  const usage =
    'takes one column and its template, as in compose folder="{course|slug}_{phase|slug}", ' +
    'and the words skip-empty and required';
  const [target, extra] = context.step.named;
  if (target === undefined || extra !== undefined) return argumentsProblem(context, usage);
  const flagged = flags(context, ['skip-empty', 'required']);
  if (!flagged.ok) return flagged;

  const range = locate(context)(target.range);
  const text = await templateText(context, target);
  if (!text.ok) return text;
  const template = parseTemplate(text.value);
  if (!template.ok) return err(templateProblem(text.value, template.error, range));
  const bound = bindTemplate(template.value, table.value, context.aliases, range, {
    skipEmpty: flagged.value.has('skip-empty'),
    required: flagged.value.has('required'),
  });
  if (!bound.ok) return bound;
  const result = withColumns(
    table.value,
    [{ name: target.name, type: 'text' }],
    'compose',
    (row) => ({
      [target.name]: bound.value.fill(row),
    }),
  );
  return ok({ table: result });
}

async function templateText(
  context: VerbContext,
  argument: Argument,
): Promise<Result<string, Problems>> {
  if (!isDataReference(argument.value)) return ok(argument.value);
  return readDataArgument(context, argument, z.string());
}

/**
 * `collect <column> from=a,b,c [skip-empty]` writes a list column of those columns' values, in
 * the order named: the several keys one row offers the right side of a `join` (ADR 0133). A
 * cell that holds a list adds its items. Without `skip-empty` an empty cell is a `null` item,
 * so every row's list has a slot per column; with it, empty items are left out.
 */
export function collect(context: VerbContext): VerbResult {
  const named = refuseNamed(context, ['from']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);

  const [target, ...words] = context.step.positional;
  const sources = context.step.named.filter((argument) => argument.name === 'from');
  if (target === undefined || sources.length !== 1 || !COLUMN_NAME.test(target.value)) {
    return argumentsProblem(
      context,
      'takes one column to write and from= the columns to read, as in collect keys ' +
        'from=first_key,second_key, and the word skip-empty',
    );
  }
  const stray = words.find((word) => word.value !== 'skip-empty');
  if (stray !== undefined) {
    return argumentsProblem(
      context,
      `takes the word skip-empty, not '${stray.value}'`,
      at(stray.range),
    );
  }
  const skipEmpty = words.length > 0;

  const columns: Column[] = [];
  for (const name of columnNames(sources)) {
    const column = resolveColumn(table.value, name.value, at(name.range), context.aliases);
    if (!column.ok) return column;
    columns.push(column.value);
  }
  if (columns.length === 0) return argumentsProblem(context, 'reads at least one column from=');

  const result = withColumns(
    table.value,
    [{ name: target.value, type: 'list' }],
    'collect',
    (row) => {
      const items = columns.flatMap((column): CellValue[] => {
        const cell = row.values[column.name] ?? null;
        return Array.isArray(cell) ? [...(cell as readonly CellValue[])] : [cell];
      });
      return {
        [target.value]: skipEmpty ? items.filter((item) => cellText(item).trim() !== '') : items,
      };
    },
  );
  return ok({ table: result });
}
