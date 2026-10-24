/**
 * `@tyto/recipe`: the table that passes between verbs, the `*.recipe` parser, the filter
 * grammar and the generic verbs (ADR 0128). Pure: no Node, no DOM, so the notebook, the CLI
 * and a cloud worker run the same chain.
 */

export type { Argument, NamedArgument, RecipeAst, RecipeParam, Step } from './ast.js';
export { resolveColumn } from './columns.js';
export { parseRecipe } from './parse.js';
export type {
  Derivation,
  DerivationRegistry,
  KeepRequest,
  RecipeResolver,
  Verb,
  VerbContext,
  VerbKind,
  VerbOutput,
  VerbRegistry,
  VerbResult,
} from './registry.js';
export { GENERIC_VERBS, createDerivationRegistry, createVerbRegistry } from './registry.js';
export type { Cell, RecipeRun, RunOptions } from './run.js';
export { runRecipe } from './run.js';
export type { CellValue, Column, ColumnType, Provenance, Row, Table } from './table.js';
export { cellText, comparable, findColumn } from './table.js';
export type { Operator, Predicate } from './where.js';
export { parseWhere, satisfies } from './where.js';
