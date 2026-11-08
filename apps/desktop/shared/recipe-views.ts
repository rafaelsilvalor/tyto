import type { ViewSpecs } from '@tyto/recipe';

/**
 * The views the recipe notebook draws, and the arguments each reads (TYTO-379, ADR 0171).
 *
 * The notebook owns the view names (ADR 0128), so the list lives here and main hands it to every
 * run: `show` checks its view and arguments against it, at their range, while the recipe is
 * written. A card that adds a view adds its entry here, with the renderer that draws it.
 */
export const RECIPE_VIEWS = {
  /** Every row and column, sorted, filtered and picked in the window only. */
  table: [],
  /** The table, with a grand total for each number column over the rows the filter keeps. */
  summary: [],
  /**
   * TYTO-381, ADR 0177: one column per value of `by=`, counted in main; `order=` the values
   * placed first (inline or `@./file.json#/pointer`), the rest by first appearance and an empty
   * value last; `fields=` the columns a card shows, the first three besides `by=` when absent.
   */
  board: [
    { name: 'by', kind: 'column', required: true },
    { name: 'order', kind: 'values' },
    { name: 'fields', kind: 'columns' },
  ],
} as const satisfies ViewSpecs;

export type RecipeViewName = keyof typeof RECIPE_VIEWS;
