import { type Result, ok } from '@tyto/core';
import { z } from 'zod';

import type { NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import { withColumns } from './compose.js';
import { isDataReference, readDataArgument, readInlineJson } from './data.js';
import type { VerbContext, VerbResult } from './registry.js';
import { type Problems, argumentsProblem, argumentsUpTo, locate, requireTable } from './support.js';
import { type CellValue, comparable } from './table.js';

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;
const NAMES = ['using', 'also', 'into'] as const;

/** A lookup table: each key's value, as the file writes both. */
const LOOKUP = z.record(z.string(), z.string());

type Lookup = z.infer<typeof LOOKUP>;

/**
 * Each value of `entries` by its key folded, or each key by its value folded when `reverse`;
 * the first in file order wins when two fold to one, as `planilha_de` read its table.
 */
function indexOf(entries: Lookup, reverse: boolean): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const [key, value] of Object.entries(entries)) {
    const [from, to] = reverse ? [value, key] : [key, value];
    const folded = comparable(from);
    if (!index.has(folded)) index.set(folded, to);
  }
  return index;
}

/**
 * What a cell maps to: `using` first, then `also`, each compared without accents, case or
 * surrounding blanks; none for an empty cell or a value neither table names.
 */
function mapper(
  using: Lookup,
  also: Lookup,
  reverse: boolean,
): (value: CellValue | undefined) => string | null {
  const indexes = [indexOf(using, reverse), indexOf(also, false)];
  return (value) => {
    const folded = comparable(value);
    if (folded === '') return null;
    for (const index of indexes) {
      const found = index.get(folded);
      if (found !== undefined) return found;
    }
    return null;
  };
}

/**
 * `map <column> using=<table> [reverse] [also=<table>] into=<column>` translates a column by a
 * lookup table (ADR 0136), as in `map status using=@./flows.json#/first/map into=target`, where
 * the table is an object of text to text: `{ "todo": "TO DO", "review": "DOING 2" }`.
 *
 * A cell is compared with the keys without accents, case or surrounding blanks, and the value
 * is written as the table spells it, into a text column added at the end or recomputed in
 * place. `reverse` reads the table from value to key; when two keys share a value, the first in
 * file order wins. `also=` is a second table consulted after the first, read from key to value
 * whatever the direction, for the names only one direction has (`{ "FINISHED": "done" }`). A
 * value neither table names, and an empty cell, map to an empty cell.
 *
 * `using=` is a data reference or JSON written inline as the last argument of the line; `also=`
 * is a data reference, since only one argument can run to the end of the line.
 */
export async function map(context: VerbContext): Promise<VerbResult> {
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes one column, using= its table and into= the column it writes, and optionally ' +
    'reverse and also=, as in map status using=@./flows.json#/first/map into=target';

  const usingWritten = context.step.named.find((argument) => argument.name === 'using');
  const inline =
    usingWritten !== undefined && !isDataReference(usingWritten.value) ? usingWritten : undefined;
  const { named, positional } = argumentsUpTo(context, inline);

  const written = new Map<string, NamedArgument>();
  for (const argument of named) {
    if (!(NAMES as readonly string[]).includes(argument.name)) {
      return argumentsProblem(
        context,
        `does not take '${argument.name}='; ${usage}`,
        at(argument.range),
      );
    }
    if (written.has(argument.name)) {
      return argumentsProblem(context, `was given '${argument.name}=' twice`, at(argument.range));
    }
    written.set(argument.name, argument);
  }
  const using = written.get('using');
  const into = written.get('into');
  const [source, flag, extra] = positional;
  if (using === undefined || into === undefined || source === undefined) {
    return argumentsProblem(context, usage);
  }
  if (extra !== undefined || (flag !== undefined && flag.value !== 'reverse')) {
    const stray = extra ?? flag;
    return argumentsProblem(
      context,
      `takes the word reverse after the column, not '${stray?.value ?? ''}'`,
      stray === undefined ? undefined : at(stray.range),
    );
  }
  if (!COLUMN_NAME.test(into.value)) {
    return argumentsProblem(context, `cannot write a column named '${into.value}'`, at(into.range));
  }
  const alsoArgument = written.get('also');
  if (alsoArgument !== undefined && !isDataReference(alsoArgument.value)) {
    return argumentsProblem(
      context,
      "reads also= from a data file, written '@./file.json#/pointer'",
      at(alsoArgument.range),
    );
  }

  const column = resolveColumn(table.value, source.value, at(source.range), context.aliases);
  if (!column.ok) return column;

  const usingTable = await readLookup(context, using);
  if (!usingTable.ok) return usingTable;
  let alsoTable: Lookup = {};
  if (alsoArgument !== undefined) {
    const read = await readDataArgument(context, alsoArgument, LOOKUP);
    if (!read.ok) return read;
    alsoTable = read.value;
  }

  const translate = mapper(usingTable.value, alsoTable, flag !== undefined);
  const result = withColumns(table.value, [{ name: into.value, type: 'text' }], 'map', (row) => ({
    [into.value]: translate(row.values[column.value.name]),
  }));
  return ok({ table: result });
}

function readLookup(
  context: VerbContext,
  argument: NamedArgument,
): Result<Lookup, Problems> | Promise<Result<Lookup, Problems>> {
  if (isDataReference(argument.value)) return readDataArgument(context, argument, LOOKUP);
  return readInlineJson(context, argument, LOOKUP);
}
