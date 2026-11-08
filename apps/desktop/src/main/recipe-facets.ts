import { type CellValue, type Table, cellText, comparable } from '@tyto/recipe';

import { RECIPE_WIRE_LIMITS } from '../../shared/ipc.js';

/**
 * The groups a view draws a table in, counted in main (TYTO-381, ADR 0177).
 *
 * The window holds a cell's first rows only (ADR 0148), so a Board cannot count its columns: it
 * asks main, which counts over the rows the view's quick filter keeps (`recipe-rows.ts`) and
 * never moves a row of the kept table. Values group as `where` compares them, no case and no
 * accents, so `Done` and `done` are one column.
 */

export interface Facet {
  /** The group's name on the wire: JSON of the compared value, handed back to `recipe:rows`. */
  readonly key: string;
  /** The value as its first row wrote it. */
  readonly label: string;
  readonly count: number;
}

export interface Facets {
  readonly facets: readonly Facet[];
  /** Groups left out past the limit. */
  readonly more: number;
}

/**
 * The key of a value's group. Cut as a value on the wire is cut, so two values that share their
 * first `RECIPE_WIRE_LIMITS.text` compared characters share a group: no Board column is that wide.
 */
export function facetKey(value: CellValue | undefined): string {
  return JSON.stringify(comparable(value).slice(0, RECIPE_WIRE_LIMITS.text));
}

/** The key of the group of rows whose value is empty: last on a Board, as "(none)". */
export const EMPTY_FACET = facetKey(null);

/**
 * The groups of `column` over the rows `permutation` names, in this order: the ones `order`
 * names, in its order, matched as values are compared; then the others by first appearance;
 * the empty value last. A word of `order` no row holds draws no group. At most `limit` groups.
 */
export function facetsOf(
  table: Table,
  permutation: readonly number[],
  column: string,
  order: readonly string[] = [],
  limit: number = RECIPE_WIRE_LIMITS.facets,
): Facets {
  const groups = new Map<string, { label: string; count: number }>();
  for (const index of permutation) {
    const value = table.rows[index]?.values[column];
    const key = facetKey(value);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { label: cellText(value), count: 1 });
    else group.count += 1;
  }
  const ordered: string[] = [];
  for (const word of order) {
    const key = facetKey(word);
    if (key !== EMPTY_FACET && groups.has(key) && !ordered.includes(key)) ordered.push(key);
  }
  for (const key of groups.keys()) {
    if (key !== EMPTY_FACET && !ordered.includes(key)) ordered.push(key);
  }
  if (groups.has(EMPTY_FACET)) ordered.push(EMPTY_FACET);
  const facets = ordered.slice(0, limit).map((key) => {
    const group = groups.get(key) ?? { label: '', count: 0 };
    return { key, label: group.label, count: group.count };
  });
  return { facets, more: ordered.length - facets.length };
}

/** The rows of `permutation`, in its order, whose `column` falls in one of the groups `keys`. */
export function rowsInFacets(
  table: Table,
  permutation: readonly number[],
  column: string,
  keys: readonly string[],
): number[] {
  const wanted = new Set(keys);
  return permutation.filter((index) => wanted.has(facetKey(table.rows[index]?.values[column])));
}
