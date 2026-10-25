import { type Diagnostic, type Result, type SourceRange, diagnostic, err, ok } from '@tyto/core';

import type { Argument, NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import type { VerbContext, VerbResult } from './registry.js';
import type { Column, Row, Table } from './table.js';
import { parseWhere, satisfies } from './where.js';

/** What the generic verbs share: argument checks, ranges and the filter a verb applies. */

export type Problems = readonly Diagnostic[];

export function argumentsProblem(
  context: VerbContext,
  problem: string,
  range?: SourceRange,
): VerbResult {
  return err([
    diagnostic(
      'E_RECIPE_ARGUMENTS',
      { verb: context.step.verb, problem },
      { range: range ?? context.written.textRange },
    ),
  ]);
}

/** The table, or the diagnostic for a verb that runs before any cell produced one. */
export function requireTable(context: VerbContext): Result<Table, Problems> {
  if (context.table !== undefined) return ok(context.table);
  return err([
    diagnostic(
      'E_RECIPE_NO_TABLE',
      { verb: context.step.verb },
      { range: context.written.verbRange },
    ),
  ]);
}

/** A verb that takes no `name=value` says so, rather than ignoring what was written. */
export function refuseNamed(
  context: VerbContext,
  allowed: readonly string[],
): VerbResult | undefined {
  const stray = context.step.named.find((argument) => !allowed.includes(argument.name));
  if (stray === undefined) return undefined;
  const accepted = allowed.length > 0 ? `; it accepts ${allowed.join(', ')}` : '';
  return argumentsProblem(context, `does not take '${stray.name}='${accepted}`, stray.range);
}

/**
 * Where a range found in the filled step points in the file. A `{param}` changes the text's
 * length, so a filled step's offsets point at the whole argument text instead.
 */
export function locate(context: VerbContext): (range: SourceRange) => SourceRange {
  const exact = context.step.text === context.written.text;
  return (range) => (exact ? range : context.written.textRange);
}

export function relocated(problems: Problems, at: (range: SourceRange) => SourceRange): Problems {
  return problems.map((problem) =>
    problem.range === undefined ? problem : { ...problem, range: at(problem.range) },
  );
}

/** Splits `key,status` and `key, status` alike into names, each with its argument's range. */
export function columnNames(argumentsWritten: readonly Argument[]): readonly Argument[] {
  return argumentsWritten.flatMap((argument) =>
    argument.value
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '')
      .map((name) => ({ value: name, range: argument.range })),
  );
}

/**
 * The arguments written up to `inline`, a named argument whose value is JSON written inline:
 * that JSON runs to the end of the line, so the words after its start are its own and not
 * arguments. With no inline argument, every argument.
 */
export function argumentsUpTo(
  context: VerbContext,
  inline: NamedArgument | undefined,
): { readonly named: readonly NamedArgument[]; readonly positional: readonly Argument[] } {
  const before = (argument: Argument) =>
    inline === undefined || argument.range.start <= inline.range.start;
  return {
    named: context.step.named.filter(before),
    positional: context.step.positional.filter(before),
  };
}

/**
 * Where a named argument's value starts in the file: after `name=` and, when it was quoted,
 * after the quote. A quoted value is two characters longer in the file than its value.
 */
export function namedValueOffset(argument: NamedArgument): number {
  const written = argument.range.end - argument.range.start;
  const quoted = written === argument.name.length + 1 + argument.value.length + 2;
  return argument.range.start + argument.name.length + 1 + (quoted ? 1 : 0);
}

/**
 * The rows a filter expression keeps, as a test, after checking its grammar and its columns.
 * `where` filters with it, and `join` draws its two sides with it, so one grammar decides both.
 */
export function rowFilter(
  context: VerbContext,
  table: Table,
  expression: string,
  offset: number,
): Result<(row: Row) => boolean, Problems> {
  const at = locate(context);
  const parsed = parseWhere(expression, offset);
  if (!parsed.ok) return err(relocated(parsed.error, at));
  const columns: Column[] = [];
  for (const predicate of parsed.value) {
    const column = resolveColumn(
      table,
      predicate.column,
      at(predicate.columnRange),
      context.aliases,
    );
    if (!column.ok) return column;
    columns.push(column.value);
  }
  return ok((row: Row) =>
    parsed.value.every((predicate, index) =>
      satisfies(predicate, row.values[columns[index]?.name ?? '']),
    ),
  );
}
