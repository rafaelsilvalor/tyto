/**
 * The one value that passes between recipe verbs (ADR 0128).
 *
 * Plain JSON on purpose: a table crosses the plugin boundary, and IPC from Electron to Node
 * needs JSON, and it is what the cache stores.
 */

export type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'list' | 'link';

/** A cell's value is whatever the source holds, as JSON. */
export type CellValue = string | number | boolean | null | readonly CellValue[];

export interface Column {
  /** English, and the contract with `where`, `select` and a saved recipe. */
  readonly name: string;
  readonly type: ColumnType;
  /** Who made the column: a source (`jira`) or a verb (`derive kind`). */
  readonly origin: string;
}

/**
 * Where a row came from. A write verb needs it to find the issue or sheet row a table row
 * stands for, after any number of `where` and `join` steps.
 */
export interface Provenance {
  readonly source: string;
  readonly id: string;
  /** ISO 8601. */
  readonly fetchedAt: string;
}

export interface Row {
  readonly key: string;
  /** By canonical column name. */
  readonly values: Readonly<Record<string, CellValue>>;
  readonly provenance: Provenance;
}

export interface Table {
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
}

/** The column whose name matches, ignoring case, as JQL does. */
export function findColumn(table: Table, name: string): Column | undefined {
  const wanted = name.toLowerCase();
  return table.columns.find((column) => column.name.toLowerCase() === wanted);
}

/** A cell as text: empty for nothing, a list joined the way a person would write it. */
export function cellText(value: CellValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((item) => cellText(item)).join(', ');
  return String(value);
}

/**
 * The form values compare in: no accents, no case, no surrounding blanks, so `Anúncio`,
 * `ANUNCIO` and ` anuncio ` are one value. JQL ignores case in values too; the accent rule
 * is the team's, whose values are Portuguese.
 */
export function comparable(value: CellValue | undefined): string {
  return cellText(value)
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .trim()
    .toLowerCase();
}
