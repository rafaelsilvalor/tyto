import { type Result, ok } from '@tyto/core';
import { z } from 'zod';

import type { NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import { isDataReference, readDataArgument } from './data.js';
import type { VerbContext, VerbResult } from './registry.js';
import {
  type Problems,
  argumentsProblem,
  columnNames,
  locate,
  namedValueOffset,
  refuseNamed,
  requireTable,
  rowFilter,
} from './support.js';
import { type CellValue, type Column, type Row, cellText } from './table.js';

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;
/** Letters, numbers and the underscore, in any script: Python's Unicode `\w+`. */
const WORDS = /[\p{L}\p{N}_]+/gu;
const BY = /^words\((?<column>[^()]+)\)$/u;
const MIN_LENGTH = /^[1-9]\d{0,2}$/u;
const DEFAULT_MIN_LENGTH = 2;

const STOPWORDS = z.array(z.string());

const NAMES = ['within', 'among', 'by', 'stopwords', 'min-length', 'bring'] as const;
const REQUIRED = ['within', 'among', 'by', 'stopwords', 'bring'] as const;

/**
 * The distinct words of a cell, in lower case: runs of letters, numbers and `_`, without the
 * stopwords and without a word shorter than `minLength` characters. Length counts code points,
 * so an accented letter is one. No accent is folded: `ação` and `acao` are two words.
 */
export function wordsOf(
  value: CellValue | undefined,
  stopwords: ReadonlySet<string>,
  minLength: number,
): ReadonlySet<string> {
  const words = cellText(value).toLowerCase().match(WORDS) ?? [];
  return new Set(words.filter((word) => !stopwords.has(word) && [...word].length >= minLength));
}

/**
 * The candidate a row is nearest to: the only one when there is one, whatever its words;
 * otherwise the one sharing the most distinct words with the row, the first in table order on
 * a tie, and none when no candidate shares a word.
 */
export function nearestOf<Candidate>(
  words: ReadonlySet<string>,
  candidates: readonly Candidate[],
  wordsOfCandidate: (candidate: Candidate) => ReadonlySet<string>,
): Candidate | undefined {
  if (candidates.length <= 1) return candidates[0];
  let best: Candidate | undefined;
  let bestScore = 0;
  for (const candidate of candidates) {
    let score = 0;
    for (const word of wordsOfCandidate(candidate)) if (words.has(word)) score++;
    // Strictly greater: a later candidate with the same score never displaces an earlier one.
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** The value rows are grouped by, or none for an empty cell: an empty group is no group. */
function groupOf(value: CellValue | undefined): string | undefined {
  const text = cellText(value);
  return text.trim() === '' ? undefined : text;
}

/**
 * `nearest <prefix> within=<column> among="<where>" by=words(<column>) stopwords=<words>
 * [min-length=<n>] bring=<columns>` finds, for each row, the most similar other row of its
 * group, as in `nearest copy within=parent among="team = copy" by=words(title)
 * stopwords=@./vocabulary.json#/stopwords bring=key,folder` (ADR 0136).
 *
 * A row's candidates are the other rows whose `within` value is its own, that `among` keeps, in
 * table order. A row with an empty `within` value has none. `by=words(<column>)` scores a
 * candidate by the distinct words its cell shares with the row's (see `wordsOf` and
 * `nearestOf`). `stopwords=` is a comma-separated list written inline, or a data reference to a
 * list of strings; `min-length=` is the shortest word counted, two by default.
 *
 * What `bring` names becomes `<prefix>_<column>` with the chosen row's value and type, empty
 * where no row was chosen. Nothing is consumed: every row stays, so a later `join` can still
 * read both sides.
 */
export async function nearest(context: VerbContext): Promise<VerbResult> {
  const named = refuseNamed(context, [...NAMES]);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);

  const [prefixArgument, extra] = context.step.positional;
  if (prefixArgument === undefined || extra !== undefined) {
    return argumentsProblem(
      context,
      'takes one prefix and within=, among=, by=, stopwords= and bring=, as in nearest copy ' +
        'within=parent among="team = copy" by=words(title) stopwords=the,a bring=key',
      extra === undefined ? undefined : at(extra.range),
    );
  }
  const prefix = prefixArgument.value;
  if (!COLUMN_NAME.test(prefix)) {
    return argumentsProblem(
      context,
      `prefixes with letters, digits, - and _, starting with a letter or _, not '${prefix}'`,
      at(prefixArgument.range),
    );
  }

  const written = new Map<string, NamedArgument>();
  for (const argument of context.step.named) {
    if (written.has(argument.name)) {
      return argumentsProblem(context, `was given '${argument.name}=' twice`, at(argument.range));
    }
    written.set(argument.name, argument);
  }
  const missing = REQUIRED.filter((name) => !written.has(name));
  const within = written.get('within');
  const among = written.get('among');
  const by = written.get('by');
  const stopwordsArgument = written.get('stopwords');
  const bring = written.get('bring');
  if (
    missing.length > 0 ||
    within === undefined ||
    among === undefined ||
    by === undefined ||
    stopwordsArgument === undefined ||
    bring === undefined
  ) {
    return argumentsProblem(context, `needs ${missing.map((name) => `${name}=`).join(', ')}`);
  }

  const byColumnName = BY.exec(by.value.trim())?.groups?.['column']?.trim();
  if (byColumnName === undefined || byColumnName === '') {
    return argumentsProblem(
      context,
      `compares by=words(<column>), the words of one column, not '${by.value}'`,
      at(by.range),
    );
  }

  const minLengthArgument = written.get('min-length');
  let minLength = DEFAULT_MIN_LENGTH;
  if (minLengthArgument !== undefined) {
    if (!MIN_LENGTH.test(minLengthArgument.value)) {
      return argumentsProblem(
        context,
        `counts words of min-length= a whole number from 1, not '${minLengthArgument.value}'`,
        at(minLengthArgument.range),
      );
    }
    minLength = Number(minLengthArgument.value);
  }

  const groupColumn = resolveColumn(table.value, within.value, at(within.range), context.aliases);
  if (!groupColumn.ok) return groupColumn;
  const wordColumn = resolveColumn(table.value, byColumnName, at(by.range), context.aliases);
  if (!wordColumn.ok) return wordColumn;

  const brought: Column[] = [];
  for (const name of columnNames([bring])) {
    const column = resolveColumn(table.value, name.value, at(name.range), context.aliases);
    if (!column.ok) return column;
    if (!brought.includes(column.value)) brought.push(column.value);
  }
  if (brought.length === 0) {
    return argumentsProblem(context, 'brings at least one column', at(bring.range));
  }

  const added: Column[] = brought.map((column) => ({
    name: `${prefix}_${column.name}`,
    type: column.type,
    origin: `nearest ${prefix}`,
  }));
  const unwritable = added.find((column) => !COLUMN_NAME.test(column.name));
  if (unwritable !== undefined) {
    return argumentsProblem(
      context,
      `cannot write a column named '${unwritable.name}'`,
      at(bring.range),
    );
  }
  const taken = added.filter((column) =>
    table.value.columns.some(
      (existing) => existing.name.toLowerCase() === column.name.toLowerCase(),
    ),
  );
  if (taken.length > 0) {
    return argumentsProblem(
      context,
      `would add ${taken.map((column) => column.name).join(', ')}, which the table already ` +
        `has; choose another prefix than '${prefix}'`,
      at(prefixArgument.range),
    );
  }

  const isCandidate = rowFilter(context, table.value, among.value, namedValueOffset(among));
  if (!isCandidate.ok) return isCandidate;

  const stopwords = await readStopwords(context, stopwordsArgument);
  if (!stopwords.ok) return stopwords;
  const ignored = new Set(stopwords.value.map((word) => word.toLowerCase()));

  const rows = table.value.rows;
  const words = rows.map((row) => wordsOf(row.values[wordColumn.value.name], ignored, minLength));
  // One pass groups the candidates, so each row looks only at its own group's.
  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const group = groupOf(row.values[groupColumn.value.name]);
    if (group === undefined || !isCandidate.value(row)) return;
    const members = groups.get(group) ?? [];
    members.push(index);
    groups.set(group, members);
  });

  const result = rows.map((row, index): Row => {
    const group = groupOf(row.values[groupColumn.value.name]);
    const candidates = (group === undefined ? [] : (groups.get(group) ?? [])).filter(
      (candidate) => candidate !== index,
    );
    const chosen = nearestOf(words[index] ?? new Set(), candidates, (candidate) => {
      return words[candidate] ?? new Set();
    });
    const source = chosen === undefined ? undefined : rows[chosen];
    const values = Object.fromEntries(
      brought.map((column, position) => [
        added[position]?.name ?? '',
        source?.values[column.name] ?? null,
      ]),
    );
    return { ...row, values: { ...row.values, ...values } };
  });
  return ok({ table: { columns: [...table.value.columns, ...added], rows: result } });
}

async function readStopwords(
  context: VerbContext,
  argument: NamedArgument,
): Promise<Result<readonly string[], Problems>> {
  if (isDataReference(argument.value)) return readDataArgument(context, argument, STOPWORDS);
  return ok(columnNames([argument]).map((word) => word.value));
}
