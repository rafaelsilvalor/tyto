import type { Locale } from '../../shared/i18n/index.js';
import { RECIPE_VIEWS, type RecipeViewName } from '../../shared/recipe-views.js';
import type { RecipeRunAnswer } from './recipe-notebook.js';
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
}

/** What a view draws from: a cell that ran, with its table and the run main keeps. */
export interface ViewCell {
  readonly index: number;
  readonly ranAt: string;
  readonly table: WireTable;
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
    });

export const VIEW_RENDERERS: Readonly<Record<RecipeViewName, ViewRenderer>> = {
  table: tableOf(false),
  summary: tableOf(true),
};

const isViewName = (name: string): name is RecipeViewName => Object.hasOwn(RECIPE_VIEWS, name);

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
  return VIEW_RENDERERS[name]({ index: cell.index, ranAt: cell.ranAt, table }, context);
}
