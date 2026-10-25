import { type Diagnostic, type Result, type SourceRange, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

import { resolveColumn } from './columns.js';
import { withColumns } from './compose.js';
import { describeIssues, isDataReference, readDataArgument } from './data.js';
import type { VerbContext, VerbResult } from './registry.js';
import { type Problems, argumentsProblem, columnNames, locate, requireTable } from './support.js';
import type { CellValue, Row, Table } from './table.js';
import { type BoundTemplate, bindTemplate, parseTemplate, templateProblem } from './template.js';
import { type Predicate, parseWhere, satisfies } from './where.js';

/** One entry of a rules table: when the row satisfies `when`, the columns `set` names. */
const RULE = z.strictObject({
  when: z.string(),
  set: z.record(z.string(), z.string().nullable()),
});

const RULES = z.array(RULE).min(1, 'a rules table holds at least one entry');

type Rule = z.infer<typeof RULE>;

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;

/** A rule ready to test a row and fill the columns it sets. */
interface CompiledRule {
  readonly test: (row: Row) => boolean;
  readonly set: ReadonlyMap<string, BoundTemplate>;
}

/**
 * `rules into=<columns> using=<table>` classifies each row by an ordered table of rules
 * (ADR 0136), as in `rules into=kind,label using=@./vocabulary.json#/kinds`:
 *
 * ```json
 * [
 *   { "when": "title matches ^poster\\b", "set": { "kind": "poster", "label": "Poster" } },
 *   { "when": "team = print AND title ~ flyer", "set": { "kind": "flyer" } },
 *   { "when": "", "set": { "kind": "other", "label": "{title|trim}" } }
 * ]
 * ```
 *
 * `when` is a `where` expression, `matches` included; the first entry a row satisfies decides
 * every column `into=` names, and a column it does not set is empty. An empty `when` is the
 * default, so it comes last; a row no entry matches has every column empty. A `set` value is a
 * template (`template.ts`), so a literal is one with no placeholder.
 *
 * The table is a data reference, or JSON written inline as the last argument of the line, which
 * holds no escaped quote and so no quoted pattern: such a table goes in a file. The whole table
 * is checked before any row is read, and a problem in an entry names its place, `/2/when`.
 */
export async function rules(context: VerbContext): Promise<VerbResult> {
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes into= the columns it writes and using= its table, as in rules into=kind ' +
    'using=@./vocabulary.json#/kinds';

  const using = context.step.named.find((argument) => argument.name === 'using');
  // An inline table is the rest of the line, and its words are not arguments.
  const inline = using !== undefined && !isDataReference(using.value);
  const before = (range: SourceRange) => !inline || range.start <= (using?.range.start ?? 0);
  const named = context.step.named.filter((argument) => before(argument.range));
  const stray =
    named.find((argument) => argument.name !== 'into' && argument.name !== 'using') ??
    context.step.positional.find((argument) => before(argument.range));
  if (stray !== undefined) return argumentsProblem(context, usage, at(stray.range));
  const intoArguments = named.filter((argument) => argument.name === 'into');
  if (using === undefined || intoArguments.length !== 1) return argumentsProblem(context, usage);

  const into: string[] = [];
  for (const name of columnNames(intoArguments)) {
    if (!COLUMN_NAME.test(name.value)) {
      return argumentsProblem(
        context,
        `cannot write a column named '${name.value}'`,
        at(name.range),
      );
    }
    if (!into.some((known) => known.toLowerCase() === name.value.toLowerCase()))
      into.push(name.value);
  }
  if (into.length === 0) return argumentsProblem(context, usage);

  const range = at(using.range);
  const read = inline
    ? readInline(context.step.text, range)
    : await readDataArgument(context, using, RULES);
  if (!read.ok) return read;
  const compiled = compileRules(read.value, into, table.value, context.aliases, range);
  if (!compiled.ok) return compiled;

  const result = withColumns(
    table.value,
    into.map((name) => ({ name, type: 'text' as const })),
    'rules',
    (row) => {
      const rule = compiled.value.find((candidate) => candidate.test(row));
      const values: Record<string, CellValue> = {};
      for (const name of into) values[name] = rule?.set.get(name.toLowerCase())?.fill(row) ?? null;
      return values;
    },
  );
  return ok({ table: result });
}

/** The JSON after `using=`, read to the end of the line and checked as a file's would be. */
function readInline(text: string, range: SourceRange): Result<readonly Rule[], Problems> {
  const start = /(?:^|\s)using=/u.exec(text);
  const json = start === null ? '' : text.slice(start.index + start[0].length);
  const refuse = (problem: string) => err([diagnostic('E_RECIPE_RULES', { problem }, { range })]);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    // JSON.parse is the one reader here that reports by throwing; its message says where.
    return refuse(
      `written inline is not JSON (${error instanceof Error ? error.message : 'unreadable'})`,
    );
  }
  const checked = RULES.safeParse(value);
  if (!checked.success)
    return refuse(`written inline is not a list of rules: ${describeIssues(checked.error.issues)}`);
  return ok(checked.data);
}

/** Every entry's `when` and `set`, checked against the table before any row is read. */
function compileRules(
  entries: readonly Rule[],
  into: readonly string[],
  table: Table,
  aliases: ReadonlyMap<string, string>,
  range: SourceRange,
): Result<readonly CompiledRule[], Problems> {
  const refuse = (problem: string) => err([diagnostic('E_RECIPE_RULES', { problem }, { range })]);
  const placed = (where: string, problems: readonly Diagnostic[]) =>
    err(
      problems.map((problem) => ({
        ...problem,
        message: `At '${where}' of the rules table: ${problem.message}`,
        range,
      })),
    );
  const wanted = new Set(into.map((name) => name.toLowerCase()));

  const compiled: CompiledRule[] = [];
  for (const [index, entry] of entries.entries()) {
    const previous = entries.findIndex((earlier) => earlier.when.trim() === '');
    if (previous !== -1 && previous < index) {
      return refuse(
        `has an entry at '/${String(index)}' after the default at '/${String(previous)}' ` +
          '(an empty when), and no row reaches it',
      );
    }
    let predicates: readonly Predicate[] = [];
    if (entry.when.trim() !== '') {
      const parsed = parseWhere(entry.when);
      if (!parsed.ok) return placed(`/${String(index)}/when`, parsed.error);
      predicates = parsed.value;
    }
    const columns: string[] = [];
    for (const predicate of predicates) {
      const column = resolveColumn(table, predicate.column, range, aliases);
      if (!column.ok) return placed(`/${String(index)}/when`, column.error);
      columns.push(column.value.name);
    }

    const set = new Map<string, BoundTemplate>();
    for (const [name, written] of Object.entries(entry.set)) {
      const where = `/${String(index)}/set/${name}`;
      if (!wanted.has(name.toLowerCase())) {
        return refuse(
          `sets '${name}' at '${where}', which into= does not name (${into.join(', ')})`,
        );
      }
      if (written === null) continue;
      const template = parseTemplate(written);
      if (!template.ok)
        return err(templateProblem(written, `at '${where}' ${template.error}`, range));
      const bound = bindTemplate(template.value, table, aliases, range);
      if (!bound.ok) return placed(where, bound.error);
      set.set(name.toLowerCase(), bound.value);
    }
    compiled.push({
      test: (row) =>
        predicates.every((predicate, position) =>
          satisfies(predicate, row.values[columns[position] ?? '']),
        ),
      set,
    });
  }
  return ok(compiled);
}
