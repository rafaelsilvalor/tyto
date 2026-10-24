import { type Diagnostic, type Result, diagnostic, err, ok } from '@tyto/core';

import type { CellValue, ColumnType, Table } from './table.js';

/**
 * Whether a value that claims to be a table is one a verb can read (ADR 0135).
 *
 * A plugin's answer crosses as JSON and is checked for shape on the host; this is the half a
 * schema cannot say: column names unique without case, every row key present and unique, every
 * value under a declared column and of that column's type. It guards a built-in the same way,
 * because a verb downstream trusts all of it — `where` reads a column by name, `join` keys rows
 * by `key`, and a write finds its target through the provenance.
 *
 * Up to {@link REPORTED} problems are named, so one bad column in a page of five thousand rows
 * is one line and not five thousand.
 */
export function checkTable(table: Table, origin: string): Result<Table, readonly Diagnostic[]> {
  const problems: string[] = [];
  const types = new Map<string, ColumnType>();
  const lowered = new Set<string>();
  for (const column of table.columns) {
    const name = column.name.toLowerCase();
    if (column.name.trim() === '') problems.push('a column has an empty name');
    else if (lowered.has(name)) problems.push(`column '${column.name}' appears twice`);
    lowered.add(name);
    types.set(column.name, column.type);
  }

  const keys = new Set<string>();
  for (const [index, row] of table.rows.entries()) {
    if (problems.length >= REPORTED) break;
    const where = `row ${String(index + 1)}`;
    if (row.key.trim() === '') problems.push(`${where} has an empty key`);
    else if (keys.has(row.key)) problems.push(`${where} repeats the key '${row.key}'`);
    keys.add(row.key);
    const { source, id, fetchedAt } = row.provenance;
    if (source === '' || id === '' || fetchedAt === '') {
      problems.push(`${where} ('${row.key}') has an incomplete provenance`);
    }
    for (const [name, value] of Object.entries(row.values)) {
      const type = types.get(name);
      if (type === undefined) {
        problems.push(`${where} ('${row.key}') has a value for '${name}', which is not a column`);
      } else if (!fits(type, value)) {
        problems.push(
          `${where} ('${row.key}') holds ${describe(value)} in ${type} column '${name}'`,
        );
      }
    }
  }

  if (problems.length === 0) return ok(table);
  return err([
    diagnostic('E_RECIPE_TABLE', { origin, problem: problems.slice(0, REPORTED).join('; ') }),
  ]);
}

/** How many problems one diagnostic names. */
const REPORTED = 8;

/** A cell may always be empty; otherwise its JSON type follows the column's. */
function fits(type: ColumnType, value: CellValue): boolean {
  if (value === null) return true;
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'list':
      return Array.isArray(value);
    case 'text':
    case 'date':
    case 'datetime':
    case 'link':
      return typeof value === 'string';
  }
}

function describe(value: CellValue): string {
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'string' ? `the text '${value}'` : `${typeof value} ${String(value)}`;
}
