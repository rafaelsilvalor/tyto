import type { Locale } from '../../shared/i18n/index.js';
import { RECIPE_VIEWS, type RecipeViewName } from '../../shared/recipe-views.js';
import { boardOptions } from './recipe-board-model.js';
import { type FacetsAnswer, type FacetsRequest, boardView } from './recipe-board-view.js';
import { calendarOptions } from './recipe-calendar-model.js';
import { calendarView } from './recipe-calendar-view.js';
import { cardFields } from './recipe-cards-model.js';
import { type RowAnswer, type RowRequest, cardsView } from './recipe-cards-view.js';
import type { RecipeRunAnswer, ViewMemory } from './recipe-notebook.js';
import {
  type CopyAnswer,
  type CopyRequest,
  type RowsAnswer,
  type RowsRequest,
  tableView,
} from './recipe-table-view.js';

/**
 * Which renderer draws a cell's view (TYTO-379, ADR 0171): one per name in
 * `shared/recipe-views.ts`, the list `show` is checked against. The record's type is keyed by
 * that list, so a view added there without a renderer here does not compile. Board, Calendar
 * and loose cards (TYTO-381, 383, 384) each add an entry to both.
 */

type WireCell = RecipeRunAnswer['cells'][number];
type WireTable = NonNullable<WireCell['table']>;

export interface ViewContext {
  readonly locale: Locale;
  readonly rows: (request: RowsRequest) => Promise<RowsAnswer>;
  readonly copy: (request: CopyRequest) => Promise<CopyAnswer>;
  /** A column's groups and their counts, from main (TYTO-381, ADR 0177). */
  readonly facets: (request: FacetsRequest) => Promise<FacetsAnswer>;
  /** One row whole, every column and its provenance, for a card opened (TYTO-384). */
  readonly row: (request: RowRequest) => Promise<RowAnswer>;
  /**
   * Drawn in a tab of its own rather than under the cell (TYTO-379, ADR 0171's dated note): the
   * Table and Summary stretch their viewport to the tab; Board, Calendar and Cards need no word
   * of it, since the stylesheet lifts their in-cell height caps inside the tab.
   */
  readonly fullSize?: boolean;
  /**
   * What the view keeps across a rebuild of its element (TYTO-639): its quick filter, the
   * Calendar's span, the loose card opened. Absent, it keeps nothing.
   */
  readonly memory?: ViewMemory | undefined;
}

/** What a view draws from: a cell that ran, with its table and the run main keeps. */
export interface ViewCell {
  readonly index: number;
  readonly ranAt: string;
  readonly table: WireTable;
  /** The view's arguments as `show` read them (TYTO-381). */
  readonly options: NonNullable<WireCell['view']>['options'];
}

export type ViewRenderer = (cell: ViewCell, context: ViewContext) => HTMLElement;

const tableOf =
  (summary: boolean): ViewRenderer =>
  (cell, context) =>
    tableView({
      index: cell.index,
      ranAt: cell.ranAt,
      columns: cell.table.columns,
      total: cell.table.total,
      locale: context.locale,
      summary,
      rows: context.rows,
      copy: context.copy,
      fullSize: context.fullSize === true,
      memory: context.memory,
    });

/** TYTO-381: a board `show` did not give `by=` (no notebook checked it) keeps the table. */
const board: ViewRenderer = (cell, context) => {
  const options = boardOptions(
    cell.options,
    cell.table.columns.map((column) => column.name),
  );
  if (options === undefined) return tableOf(false)(cell, context);
  return boardView({
    index: cell.index,
    ranAt: cell.ranAt,
    columns: cell.table.columns,
    total: cell.table.total,
    locale: context.locale,
    board: options,
    facets: context.facets,
    rows: context.rows,
    memory: context.memory,
  });
};

/** TYTO-383: a calendar `show` did not give `date=` keeps the table, as a board without `by=`. */
const calendar: ViewRenderer = (cell, context) => {
  const options = calendarOptions(
    cell.options,
    cell.table.columns.map((column) => column.name),
  );
  if (options === undefined) return tableOf(false)(cell, context);
  return calendarView({
    index: cell.index,
    ranAt: cell.ranAt,
    columns: cell.table.columns,
    total: cell.table.total,
    locale: context.locale,
    calendar: options,
    facets: context.facets,
    rows: context.rows,
    memory: context.memory,
  });
};

/** TYTO-384: loose cards showing `fields=`, each opening onto its whole row. */
const cards: ViewRenderer = (cell, context) =>
  cardsView({
    index: cell.index,
    ranAt: cell.ranAt,
    columns: cell.table.columns,
    total: cell.table.total,
    locale: context.locale,
    fields: cardFields(
      cell.options,
      cell.table.columns.map((column) => column.name),
    ),
    rows: context.rows,
    row: context.row,
    memory: context.memory,
  });

export const VIEW_RENDERERS: Readonly<Record<RecipeViewName, ViewRenderer>> = {
  table: tableOf(false),
  summary: tableOf(true),
  board,
  calendar,
  cards,
};

const isViewName = (name: string): name is RecipeViewName => Object.hasOwn(RECIPE_VIEWS, name);

/**
 * What a cell drawn full size shows (TYTO-379): the view its `show` chose, the Table under no
 * `show` — a tab is room enough for every row, where the cell keeps a preview — and `undefined`
 * for a cell with no table main holds, which has no rows to page through.
 */
export function fullSizeBody(cell: WireCell, context: ViewContext): HTMLElement | undefined {
  const table = cell.status === 'ok' || cell.status === 'stale' ? cell.table : undefined;
  if (table === undefined || cell.ranAt === undefined) return undefined;
  const name = cell.view?.name;
  const view = name !== undefined && isViewName(name) ? name : 'table';
  return VIEW_RENDERERS[view](
    { index: cell.index, ranAt: cell.ranAt, table, options: cell.view?.options ?? {} },
    { ...context, fullSize: true },
  );
}

/**
 * The body a cell's view draws, or `undefined` for the preview a cell under no `show` keeps
 * (TYTO-377): a cell with no run main holds (`ranAt`) has no rows to page through either.
 */
export function viewBody(
  cell: WireCell,
  table: WireTable,
  context: ViewContext,
): HTMLElement | undefined {
  const name = cell.view?.name;
  if (name === undefined || !isViewName(name) || cell.ranAt === undefined) return undefined;
  return VIEW_RENDERERS[name](
    { index: cell.index, ranAt: cell.ranAt, table, options: cell.view?.options ?? {} },
    context,
  );
}
