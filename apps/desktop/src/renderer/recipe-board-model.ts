/**
 * The Board view's arithmetic (TYTO-381, ADR 0177), apart from the DOM so it is tested alone.
 *
 * The board never counts: main says which groups a column holds and how many rows each has
 * (`recipe:facets`), and each column asks main for its own rows a page at a time (`recipe:rows`
 * with `facet`). What is left here is which columns a card shows, the page a column asks next,
 * and how many of its rows are not drawn yet.
 */

/** Cards a column draws before "N more" asks for the next ones. */
export const BOARD_PAGE = 50;

/** A value of `show`'s arguments as the cell on the wire carries it. */
export type ViewOption = string | readonly string[];

export interface BoardOptions {
  /** The column whose values are the board's columns. */
  readonly by: string;
  /** The values placed first, in this order; main matches them as `where` compares. */
  readonly order: readonly string[] | undefined;
  /** The columns a card shows, the first one as its title. */
  readonly fields: readonly string[];
}

/**
 * The board `show board` asked for, or `undefined` when its options lack `by=` (a recipe the
 * notebook did not check). Without `fields=`, a card shows the first three columns besides `by`.
 */
export function boardOptions(
  options: Readonly<Record<string, ViewOption>>,
  columns: readonly string[],
): BoardOptions | undefined {
  const by = options['by'];
  if (typeof by !== 'string') return undefined;
  const order = options['order'];
  const fields = options['fields'];
  return {
    by,
    order: typeof order === 'string' ? [order] : order,
    fields: (typeof fields === 'string'
      ? [fields]
      : (fields ?? columns.filter((name) => name !== by).slice(0, 3))
    ).filter((name) => name !== by),
  };
}

/** The columns every board query names: `by` and the fields, so the filter matches over them. */
export function askedColumns(board: BoardOptions): string[] {
  return [board.by, ...board.fields];
}

/** A group main counted, as `recipe:facets` answers it. */
export interface BoardGroup {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

/** The empty value's group: JSON of the empty compared text, drawn last as "(none)". */
export const EMPTY_GROUP = '""';

/** The page a column asks next, or `undefined` once every row of its group is drawn. */
export function nextPage(
  group: BoardGroup,
  drawn: number,
): { readonly offset: number; readonly limit: number } | undefined {
  if (drawn >= group.count) return undefined;
  return { offset: drawn, limit: Math.min(BOARD_PAGE, group.count - drawn) };
}

/** How many of a group's rows are not drawn yet: what "N more" says. */
export function notDrawn(group: BoardGroup, drawn: number): number {
  return Math.max(0, group.count - drawn);
}
