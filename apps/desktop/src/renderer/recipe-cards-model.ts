import { externalUrlAllowed } from '../../shared/external-url.js';

/**
 * The Cards view's arithmetic (TYTO-384, ADR 0177 note of 2026-11-08), apart from the DOM so it
 * is tested alone: which columns a card shows, the page the grid asks next, and which address
 * an opened card offers as the row's link.
 */

/** Cards the grid draws before "N more" asks for the next ones: four rows of a wide window. */
export const CARDS_PAGE = 48;

/** A value of `show`'s arguments as the cell on the wire carries it. */
export type ViewOption = string | readonly string[];

/** The columns a card shows, the first one as its title: `fields=`, else the first four. */
export function cardFields(
  options: Readonly<Record<string, ViewOption>>,
  columns: readonly string[],
): readonly string[] {
  const fields = options['fields'];
  if (typeof fields === 'string') return [fields];
  return fields ?? columns.slice(0, 4);
}

/** The page the grid asks next, or `undefined` once every matched row is drawn. */
export function nextCards(
  drawn: number,
  matched: number,
): { readonly offset: number; readonly limit: number } | undefined {
  if (drawn >= matched) return undefined;
  return { offset: drawn, limit: Math.min(CARDS_PAGE, matched - drawn) };
}

/**
 * The row's link, the first `link` column whose value the system browser may open
 * (`externalUrlAllowed`): a `file:` or custom-scheme address is never offered. Provenance has
 * no address of its own, so the link is a column the source wrote.
 */
export function rowLink(
  columns: readonly { readonly name: string; readonly type: string }[],
  values: readonly (string | number | boolean | null)[],
): string | undefined {
  for (const [at, column] of columns.entries()) {
    const value = values[at];
    if (column.type === 'link' && typeof value === 'string' && externalUrlAllowed(value)) {
      return value;
    }
  }
  return undefined;
}
