import { type Diagnostic, type Result, diagnostic, didYouMean, err, ok } from '@tyto/core';
import { z } from 'zod';

import type { Argument, NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import { isDataReference, readDataArgument } from './data.js';
import type { VerbContext } from './registry.js';
import { type Problems, columnNames, locate } from './support.js';
import type { ColumnType, Table } from './table.js';

/**
 * What `show` checks a view against (ADR 0171). The notebook owns the view names (ADR 0128) and
 * passes them in as data, so a view the window cannot draw, or an argument it does not read, is
 * a diagnostic at its range while the recipe is written, never a blank cell later.
 *
 * Not plugin-api's `ArgumentSpec` (ADR 0135): a view's arguments name columns of the table it
 * draws, which a contributed verb's arguments never do.
 */
export type ViewArgumentKind = 'column' | 'columns' | 'values' | 'choice';

export interface ViewArgumentSpec {
  /** Written as `name=value` after the view's name. */
  readonly name: string;
  /**
   * `column` is one column of the table and `columns` a comma list of them, both resolved
   * through the aliases to the canonical name; `values` is a comma list of words, or a data
   * file's list of strings (`order=@./board.json#/order`, TYTO-381); `choice` is one of `values`.
   */
  readonly kind: ViewArgumentKind;
  readonly required?: boolean;
  /** For `column` and `columns`: the column types the view can draw from. */
  readonly types?: readonly ColumnType[];
  /** For `choice`: the words accepted, as written. */
  readonly values?: readonly string[];
}

/** By view name, the arguments that view reads; an empty list is a view that takes none. */
export type ViewSpecs = Readonly<Record<string, readonly ViewArgumentSpec[]>>;

/** A `columns` or `values` argument is a list; the others are one word. */
export type ViewOptionValue = string | readonly string[];

/** The view a cell is drawn in: the last `show` at or above it, with its arguments read. */
export interface CellView {
  readonly name: string;
  readonly options: Readonly<Record<string, ViewOptionValue>>;
}

/**
 * Reads `show <view> [name=value …]` against the host's views. The view's name is the first
 * word; a second word is a stray one; each named argument is checked against the view's specs,
 * its columns resolved against `table`.
 */
export async function readView(
  context: VerbContext,
  table: Table,
  views: ViewSpecs,
): Promise<Result<CellView, Problems>> {
  const at = locate(context);
  const [written, extra] = context.step.positional;
  if (written === undefined) {
    return refuse(context, 'takes the name of one view, as in show table');
  }
  const specs = Object.hasOwn(views, written.value) ? views[written.value] : undefined;
  if (specs === undefined) return err([unknownView(written, Object.keys(views), at)]);
  if (extra !== undefined) {
    return refuse(
      context,
      `takes one view and name=value arguments, and '${extra.value}' is a stray word`,
      at(extra.range),
    );
  }

  const given = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (!specs.some((spec) => spec.name === argument.name)) {
      const accepted = specs.map((spec) => spec.name).join(', ') || 'none';
      return refuse(
        context,
        `does not take '${argument.name}=' for the ${written.value} view; it accepts ${accepted}`,
        at(argument.range),
      );
    }
    if (given.has(argument.name)) {
      return refuse(context, `was given '${argument.name}=' twice`, at(argument.range));
    }
    given.set(argument.name, argument);
  }

  const options: Record<string, ViewOptionValue> = {};
  for (const spec of specs) {
    const argument = given.get(spec.name);
    if (argument === undefined) {
      if (spec.required === true) {
        return refuse(context, `needs ${spec.name}= for the ${written.value} view`);
      }
      continue;
    }
    const value = await optionValue(context, table, spec, argument);
    if (!value.ok) return value;
    options[spec.name] = value.value;
  }
  return ok({ name: written.value, options });
}

/** A `values` argument read from a data file: a list of strings, as `decide values=` reads. */
const DATA_VALUES = z.array(z.string()).min(1);

async function optionValue(
  context: VerbContext,
  table: Table,
  spec: ViewArgumentSpec,
  argument: NamedArgument,
): Promise<Result<ViewOptionValue, Problems>> {
  const at = locate(context);
  const range = at(argument.range);
  switch (spec.kind) {
    case 'column':
    case 'columns': {
      const names = columnNames([argument]);
      if (names.length === 0 || (spec.kind === 'column' && names.length > 1)) {
        const wanted = spec.kind === 'column' ? 'one column' : 'one or more columns';
        return refuse(context, `${spec.name}= takes ${wanted}`, range);
      }
      const resolved: string[] = [];
      for (const name of names) {
        const column = resolveColumn(table, name.value, range, context.aliases);
        if (!column.ok) return column;
        if (spec.types !== undefined && !spec.types.includes(column.value.type)) {
          return refuse(
            context,
            `${spec.name}= reads a ${spec.types.join(' or ')} column, and '${column.value.name}' ` +
              `is ${column.value.type}`,
            range,
          );
        }
        if (!resolved.includes(column.value.name)) resolved.push(column.value.name);
      }
      return ok(spec.kind === 'column' ? (resolved[0] as string) : resolved);
    }
    case 'values': {
      // TYTO-381: a list kept in the workspace, such as a status order, is read through the
      // host's data files, as every other verb's `@./file.json#/pointer` argument is.
      if (isDataReference(argument.value)) return readDataArgument(context, argument, DATA_VALUES);
      const words = columnNames([argument]).map((word) => word.value);
      return words.length === 0
        ? refuse(context, `${spec.name}= takes a comma list of values`, range)
        : ok(words);
    }
    case 'choice': {
      const allowed = spec.values ?? [];
      return allowed.includes(argument.value)
        ? ok(argument.value)
        : refuse(
            context,
            `${spec.name}= is '${argument.value}', and may be ${allowed.join(', ')}`,
            range,
          );
    }
  }
}

function unknownView(
  written: Argument,
  available: readonly string[],
  at: ReturnType<typeof locate>,
): Diagnostic {
  const guess = didYouMean(written.value, available);
  const range = at(written.range);
  return diagnostic(
    'E_RECIPE_VIEW',
    { view: written.value, available: available.length > 0 ? available.join(', ') : '(none)' },
    guess === undefined ? { range } : { range, hint: `Did you mean '${guess}'?` },
  );
}

function refuse<T>(
  context: VerbContext,
  problem: string,
  range?: Argument['range'],
): Result<T, Problems> {
  return err([
    diagnostic(
      'E_RECIPE_ARGUMENTS',
      { verb: context.step.verb, problem },
      { range: range ?? context.written.textRange },
    ),
  ]);
}
