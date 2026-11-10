/**
 * The notebook's views (TYTO-379, ADR 0171), which live in `@tyto/recipe` since every host that
 * runs a recipe checks `show` against them (ADR 0188). Re-exported here so the renderer and main
 * keep one import for the list their views are drawn from.
 */
export { RECIPE_VIEWS, type RecipeViewName } from '@tyto/recipe';
