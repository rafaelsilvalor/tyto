import { type Result, type SourceRange, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

import type { Argument, NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import { withColumns } from './compose.js';
import { describeIssues, isDataReference, readDataArgument } from './data.js';
import { type CompiledPattern, boundedInput, compilePattern } from './pattern.js';
import type { VerbContext, VerbResult } from './registry.js';
import {
  type Problems,
  argumentsProblem,
  columnNames,
  locate,
  namedValueOffset,
  refuseNamed,
  relocated,
  requireTable,
} from './support.js';
import { type CellValue, cellText } from './table.js';

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;

/**
 * The named groups of a compiled pattern, in the order they open. `RegExp` names them only on a
 * match, so the pattern is run once against the empty text with an empty alternative that
 * always matches: every group is then present, unmatched.
 */
export function groupNames(pattern: CompiledPattern): readonly string[] {
  const probe = new RegExp(`(?:${pattern.expression.source})|`, pattern.expression.flags);
  return Object.keys(probe.exec('')?.groups ?? {});
}

/**
 * A pattern argument, written inline (`pattern="^(?<format>poster|flyer)"`) or read from a data
 * file (`pattern=@./vocabulary.json#/ad`). An inline refusal points into the pattern; one read
 * from a file points at the argument, since the file's offsets mean nothing in the recipe.
 */
async function readPattern(
  context: VerbContext,
  argument: NamedArgument,
): Promise<Result<CompiledPattern, Problems>> {
  const at = locate(context);
  if (!isDataReference(argument.value)) {
    const compiled = compilePattern(argument.value, namedValueOffset(argument));
    return compiled.ok ? compiled : err(relocated(compiled.error, at));
  }
  const text = await readDataArgument(context, argument, z.string());
  if (!text.ok) return text;
  const compiled = compilePattern(text.value);
  if (compiled.ok) return compiled;
  return err(compiled.error.map((problem) => ({ ...problem, range: at(argument.range) })));
}

/** A cell holds `null`, never `''` or blanks alone. */
function blankAsNull(text: string | undefined): string | null {
  return text === undefined || text.trim() === '' ? null : text;
}

/**
 * `extract <column> pattern=<pattern> [into=<columns>|into=<prefix>*]` writes one text column
 * per named group of a `tyto-pattern/1` pattern (ADR 0136), as in
 * `extract title pattern="^(?<format>poster|flyer)\s*-\s*(?<theme>.+)$"`.
 *
 * Without `into=` each column is named after its group. `into=a,b` names them in the order the
 * groups open, one name per group; `into=ad_*` puts a prefix before each group's name. A cell
 * the pattern does not match, and a group that took no part in the match, give `null`. A
 * value is trimmed, because a group is a field and a field's surrounding blanks are never
 * meant. The pattern reads the first 4,096 characters of the cell, as every pattern does.
 */
export async function extract(context: VerbContext): Promise<VerbResult> {
  const named = refuseNamed(context, ['pattern', 'into']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes one column to read and pattern= a pattern with named groups, as in extract title ' +
    'pattern="^(?<format>poster|flyer) - (?<theme>.+)", and into= the columns or a prefix ' +
    'ending in *';

  const [source, extra] = context.step.positional;
  const patterns = context.step.named.filter((argument) => argument.name === 'pattern');
  const intos = context.step.named.filter((argument) => argument.name === 'into');
  const [pattern] = patterns;
  if (source === undefined || pattern === undefined || patterns.length > 1 || intos.length > 1) {
    return argumentsProblem(context, usage);
  }
  if (extra !== undefined) return argumentsProblem(context, usage, at(extra.range));

  const column = resolveColumn(table.value, source.value, at(source.range), context.aliases);
  if (!column.ok) return column;
  const compiled = await readPattern(context, pattern);
  if (!compiled.ok) return compiled;
  const groups = groupNames(compiled.value);
  if (groups.length === 0) {
    return err([
      diagnostic(
        'E_RECIPE_PATTERN',
        {
          problem:
            'it has no named group, so extract would write no column; name each part, as ' +
            '(?<format>poster|flyer)',
        },
        { range: at(pattern.range) },
      ),
    ]);
  }
  const targets = targetNames(context, groups, intos[0], pattern.range);
  if (!targets.ok) return targets;

  const expression = compiled.value.expression;
  const result = withColumns(
    table.value,
    targets.value.map((name) => ({ name, type: 'text' as const })),
    'extract',
    (row) => {
      const text = cellText(row.values[column.value.name]);
      const match = text === '' ? null : expression.exec(boundedInput(text));
      const values: Record<string, CellValue> = {};
      groups.forEach((group, index) => {
        const value = blankAsNull(match?.groups?.[group]);
        values[targets.value[index] ?? group] = value === null ? null : value.trim();
      });
      return values;
    },
  );
  return ok({ table: result });
}

/** The column each group writes, in the groups' order, or why `into=` cannot name them. */
function targetNames(
  context: VerbContext,
  groups: readonly string[],
  into: Argument | undefined,
  patternRange: SourceRange,
): Result<readonly string[], Problems> {
  const at = locate(context);
  const refuse = (problem: string, range: SourceRange) =>
    argumentsProblem(context, problem, at(range)) as Result<never, Problems>;

  let names: readonly string[];
  let range = patternRange;
  if (into === undefined) {
    names = groups;
  } else if (into.value.endsWith('*') && !into.value.includes(',')) {
    const prefix = into.value.slice(0, -1);
    names = groups.map((group) => `${prefix}${group}`);
    range = into.range;
  } else {
    names = columnNames([into]).map((name) => name.value);
    range = into.range;
    if (names.length !== groups.length) {
      return refuse(
        `names ${String(names.length)} column(s) in into=, and the pattern has ` +
          `${String(groups.length)} named group(s) (${groups.join(', ')}); name one per group, ` +
          'or write a prefix as into=ad_*',
        into.range,
      );
    }
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (!COLUMN_NAME.test(name)) {
      return refuse(`cannot write a column named '${name}'`, range);
    }
    if (seen.has(name.toLowerCase())) {
      return refuse(`would write the column '${name}' twice`, range);
    }
    seen.add(name.toLowerCase());
  }
  return ok(names);
}

/** One step of a rewrite list: every match of `pattern` becomes `replace`. */
const STEP = z.strictObject({ pattern: z.string(), replace: z.string() });
const STEPS = z.array(STEP).min(1, 'a rewrite list holds at least one step');
type Step = z.infer<typeof STEP>;

/** A replacement read into literal text and the named groups it puts back. */
type Piece = { readonly text: string } | { readonly group: string };

interface CompiledStep {
  /** The pattern with the flag `g` added, for `matchAll`. */
  readonly expression: RegExp;
  readonly pieces: readonly Piece[];
}

/**
 * `rewrite <column> into=<column> using=<list>` writes the column's text after an ordered list
 * of replacements (ADR 0136), as in `rewrite title into=clean using=@./vocabulary.json#/noise`:
 *
 * ```json
 * [
 *   { "pattern": "^\\s*copy\\s*-\\s*", "replace": "" },
 *   { "pattern": "\\s*-\\s*due:.*$", "replace": "" },
 *   { "pattern": "^(?<first>\\w+), (?<last>\\w+)$", "replace": "$<last> $<first>" }
 * ]
 * ```
 *
 * The steps run in order, each over what the one before left, and each replaces every match.
 * `replace` is literal text in which `$<name>` puts back the named group (empty when the group
 * took no part) and `$$` writes a dollar; any other `$` is refused, so `$1` cannot mean
 * something unwritten. Each step reads the first 4,096 characters of the text, as every
 * pattern does; what lies beyond passes through unchanged. An empty cell stays empty, and a
 * text rewritten to nothing is `null`.
 *
 * The list is a data reference, or JSON written inline as the last argument of the line, which
 * holds no escaped quote, as `rules`' table does.
 */
export async function rewrite(context: VerbContext): Promise<VerbResult> {
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes one column to read, into= the column it writes and using= its list of steps, as in ' +
    'rewrite title into=clean using=@./vocabulary.json#/noise';

  const using = context.step.named.find((argument) => argument.name === 'using');
  // An inline list is the rest of the line, and its words are not arguments.
  const inline = using !== undefined && !isDataReference(using.value);
  const before = (range: SourceRange) => !inline || range.start <= (using?.range.start ?? 0);
  const named = context.step.named.filter((argument) => before(argument.range));
  const positional = context.step.positional.filter((argument) => before(argument.range));
  const stray = named.find((argument) => argument.name !== 'into' && argument.name !== 'using');
  if (stray !== undefined) return argumentsProblem(context, usage, at(stray.range));
  const intos = named.filter((argument) => argument.name === 'into');
  const [source, extra] = positional;
  const [into] = intos;
  if (using === undefined || source === undefined || into === undefined || intos.length > 1) {
    return argumentsProblem(context, usage);
  }
  if (extra !== undefined) return argumentsProblem(context, usage, at(extra.range));
  if (!COLUMN_NAME.test(into.value)) {
    return argumentsProblem(context, `cannot write a column named '${into.value}'`, at(into.range));
  }

  const column = resolveColumn(table.value, source.value, at(source.range), context.aliases);
  if (!column.ok) return column;
  const range = at(using.range);
  const read = inline
    ? readInlineSteps(context.step.text, range)
    : await readDataArgument(context, using, STEPS);
  if (!read.ok) return read;
  const steps = compileSteps(read.value, range);
  if (!steps.ok) return steps;

  const result = withColumns(
    table.value,
    [{ name: into.value, type: 'text' }],
    'rewrite',
    (row) => {
      const text = cellText(row.values[column.value.name]);
      if (text === '') return { [into.value]: null };
      const rewritten = steps.value.reduce((current, step) => applyStep(current, step), text);
      return { [into.value]: rewritten === '' ? null : rewritten };
    },
  );
  return ok({ table: result });
}

function rewriteProblem(problem: string, range: SourceRange): Problems {
  return [diagnostic('E_RECIPE_REWRITE', { problem }, { range })];
}

/** The JSON after `using=`, read to the end of the line and checked as a file's would be. */
function readInlineSteps(text: string, range: SourceRange): Result<readonly Step[], Problems> {
  const start = /(?:^|\s)using=/u.exec(text);
  const json = start === null ? '' : text.slice(start.index + start[0].length);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    // JSON.parse is the one reader here that reports by throwing; its message says where.
    return err(
      rewriteProblem(
        `written inline is not JSON (${error instanceof Error ? error.message : 'unreadable'})`,
        range,
      ),
    );
  }
  const checked = STEPS.safeParse(value);
  if (!checked.success) {
    return err(
      rewriteProblem(
        `written inline is not a list of steps: ${describeIssues(checked.error.issues)}`,
        range,
      ),
    );
  }
  return ok(checked.data);
}

/** Every step's pattern and replacement, checked before any row is read. */
function compileSteps(
  steps: readonly Step[],
  range: SourceRange,
): Result<readonly CompiledStep[], Problems> {
  const compiled: CompiledStep[] = [];
  for (const [index, step] of steps.entries()) {
    const pattern = compilePattern(step.pattern);
    if (!pattern.ok) {
      return err(
        pattern.error.map((problem) => ({
          ...problem,
          message: `At '/${String(index)}/pattern' of the rewrite list: ${problem.message}`,
          range,
        })),
      );
    }
    const pieces = parseReplacement(step.replace, groupNames(pattern.value));
    if (!pieces.ok) {
      return err(rewriteProblem(`has at '/${String(index)}/replace' ${pieces.error}`, range));
    }
    compiled.push({
      expression: new RegExp(pattern.value.expression.source, 'giu'),
      pieces: pieces.value,
    });
  }
  return ok(compiled);
}

/** `$<name>` and `$$` read out of a replacement; every other character is literal. */
export function parseReplacement(
  replace: string,
  groups: readonly string[],
): Result<readonly Piece[], string> {
  const pieces: Piece[] = [];
  let literal = '';
  let index = 0;
  while (index < replace.length) {
    const char = replace[index] ?? '';
    if (char !== '$') {
      literal += char;
      index += 1;
      continue;
    }
    if (replace[index + 1] === '$') {
      literal += '$';
      index += 2;
      continue;
    }
    const named = /^\$<([^>]*)>/u.exec(replace.slice(index));
    if (named === null) {
      return err(
        `a '$' at character ${String(index + 1)} that starts neither $<name> nor $$; write $$ ` +
          'for a dollar',
      );
    }
    const group = named[1] ?? '';
    if (!groups.includes(group)) {
      const known =
        groups.length > 0 ? `its pattern names ${groups.join(', ')}` : 'its pattern names no group';
      return err(`'$<${group}>', and ${known}`);
    }
    if (literal !== '') pieces.push({ text: literal });
    literal = '';
    pieces.push({ group });
    index += named[0].length;
  }
  if (literal !== '') pieces.push({ text: literal });
  return ok(pieces);
}

/** One step over the first 4,096 characters of `text`; the rest is kept as it was. */
function applyStep(text: string, step: CompiledStep): string {
  const head = boundedInput(text);
  let result = '';
  let last = 0;
  for (const match of head.matchAll(step.expression)) {
    result += head.slice(last, match.index);
    for (const piece of step.pieces) {
      result += 'text' in piece ? piece.text : (match.groups?.[piece.group] ?? '');
    }
    last = match.index + match[0].length;
  }
  return result + head.slice(last) + text.slice(head.length);
}
