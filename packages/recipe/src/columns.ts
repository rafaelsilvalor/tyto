import {
  type Diagnostic,
  type Result,
  type SourceRange,
  diagnostic,
  didYouMean,
  err,
  ok,
} from '@tyto/core';

import { type Column, type Table, findColumn } from './table.js';

/**
 * The column a name written in a recipe means, ignoring case, through an alias if one exists.
 *
 * Aliases are input-only and fenced the way `flow.py` fences them: an alias only renames, so
 * a canonical column the table lacks is the usual unknown-column error; an alias spelled
 * like one of the table's own columns is refused, because it would make `where status = …`
 * filter another column without a word; and an alias that points at another alias is
 * refused, because resolution is one pass. What comes back is always the canonical column,
 * so an output header never varies with the machine that ran the recipe.
 */
export function resolveColumn(
  table: Table,
  written: string,
  range: SourceRange,
  aliases: ReadonlyMap<string, string>,
): Result<Column, readonly Diagnostic[]> {
  const target = aliases.get(written.toLowerCase());
  if (target !== undefined) {
    const aliasProblem = (problem: string) =>
      err([diagnostic('E_RECIPE_ALIAS', { alias: written, problem }, { range })]);
    if (findColumn(table, written) !== undefined) {
      return aliasProblem(
        'is also the name of a column of this table, so it would hide that column; choose ' +
          'another alias',
      );
    }
    if (aliases.has(target.toLowerCase())) {
      return aliasProblem(
        `points to '${target}', which is itself an alias; aliases resolve in one pass, so ` +
          'point it at the column',
      );
    }
    const column = findColumn(table, target);
    if (column !== undefined) return ok(column);
    return unknownColumn(table, target, range, `'${written}' is an alias for '${target}'.`);
  }
  const column = findColumn(table, written);
  return column === undefined ? unknownColumn(table, written, range) : ok(column);
}

function unknownColumn(
  table: Table,
  name: string,
  range: SourceRange,
  aliasNote?: string,
): Result<Column, readonly Diagnostic[]> {
  const names = table.columns.map((column) => column.name);
  const guess = didYouMean(name, names);
  const hint = [aliasNote, guess === undefined ? undefined : `Did you mean '${guess}'?`]
    .filter((part) => part !== undefined)
    .join(' ');
  return err([
    diagnostic(
      'E_RECIPE_UNKNOWN_COLUMN',
      { column: name, available: names.length > 0 ? names.join(', ') : '(none)' },
      hint === '' ? { range } : { range, hint },
    ),
  ]);
}
