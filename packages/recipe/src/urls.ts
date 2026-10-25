import { type Result, ok } from '@tyto/core';
import { z } from 'zod';

import type { Argument } from './ast.js';
import { resolveColumn } from './columns.js';
import { withColumns } from './compose.js';
import { isDataReference, readDataArgument } from './data.js';
import type { VerbContext, VerbResult } from './registry.js';
import {
  type Problems,
  argumentsProblem,
  columnNames,
  locate,
  refuseNamed,
  requireTable,
} from './support.js';
import type { CellValue, Column } from './table.js';

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;
const HOST_SHAPE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/u;
const HOST_PROBLEM = 'a host is written as files.example.com, without a scheme, a port or a path';

const HOSTS = z
  .array(z.string().regex(HOST_SHAPE, HOST_PROBLEM))
  .min(1, 'a host list holds at least one host');

/**
 * An address as text runs from its scheme to the first blank or the first character Markdown,
 * HTML or a quotation wraps a link in: `)`, `]`, `>`, `"`, `'` and `<`. So `[doc](…/view)` and
 * `<…/view>` both end at `view`, as the private plugin's `DRIVE_URL_RE` cut them. The scan is
 * Tyto's own, linear, and reads the whole cell: only an author's pattern meets the 4,096 cut.
 */
const ADDRESS = /https?:\/\/[^\s<>"'\])]+/giu;
/** A sentence's full stop or comma right after a link belongs to the sentence. */
const TRAILING_PUNCTUATION = /[.,]+$/u;

/** The host an address names, in lower case: no user, no port, no trailing dot. */
export function hostOf(address: string): string {
  const authority = address.replace(/^https?:\/\//iu, '').split(/[/?#]/u)[0] ?? '';
  const host = authority.slice(authority.lastIndexOf('@') + 1).replace(/:\d*$/u, '');
  return host.toLowerCase().replace(/\.$/u, '');
}

/** The addresses a cell offers, in order: each found in a text, each item of a list in turn. */
export function addressesIn(value: CellValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((item: CellValue) => addressesIn(item));
  if (typeof value !== 'string') return [];
  return [...value.matchAll(ADDRESS)]
    .map((found) => found[0].replace(TRAILING_PUNCTUATION, ''))
    .filter((address) => /^https?:\/\/[^/?#]/iu.test(address));
}

/**
 * `urls into=<column> from=a,b host=<hosts> [first]` writes the links the columns hold whose
 * host is one of `host=`, as in `urls into=folder from=description,comments
 * host=@./vocabulary.json#/hosts first` (ADR 0136).
 *
 * A text cell is searched for addresses; a list cell's items are read in turn, each searched
 * the same way. The columns are read in the order `from=` names them and each from its start,
 * so a link in the first column comes before every link in the second, wherever it sits: that
 * is precedence, not position. A host matches when it is one of the list exactly, ignoring
 * case; a subdomain is a host of its own. Each address appears once, where it first appeared.
 *
 * Without `first` the column is a list of the links; with it, a link column holding the first
 * one. A row with no link has `null` either way. `host=` is a comma-separated list written
 * inline, or a data reference to a list of strings.
 */
export async function urls(context: VerbContext): Promise<VerbResult> {
  const named = refuseNamed(context, ['into', 'from', 'host']);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes into= the column it writes, from= the columns it reads and host= the hosts it ' +
    'keeps, as in urls into=folder from=description,comments host=files.example.com, and ' +
    'the word first';

  const only = (name: string) => context.step.named.filter((argument) => argument.name === name);
  const [into, ...moreInto] = only('into');
  const [host, ...moreHost] = only('host');
  const sources = only('from');
  if (into === undefined || host === undefined || sources.length === 0) {
    return argumentsProblem(context, usage);
  }
  const repeated = moreInto[0] ?? moreHost[0];
  if (repeated !== undefined) {
    return argumentsProblem(context, `was given '${repeated.name}=' twice`, at(repeated.range));
  }
  const stray = context.step.positional.find((word) => word.value !== 'first');
  if (stray !== undefined) {
    return argumentsProblem(context, `takes the word first, not '${stray.value}'`, at(stray.range));
  }
  const first = context.step.positional.length > 0;
  if (!COLUMN_NAME.test(into.value)) {
    return argumentsProblem(context, `cannot write a column named '${into.value}'`, at(into.range));
  }

  const columns: Column[] = [];
  for (const name of columnNames(sources)) {
    const column = resolveColumn(table.value, name.value, at(name.range), context.aliases);
    if (!column.ok) return column;
    columns.push(column.value);
  }
  if (columns.length === 0) return argumentsProblem(context, 'reads at least one column from=');

  const hosts = await readHosts(context, host);
  if (!hosts.ok) return hosts;
  const wanted = new Set(hosts.value.map((name) => name.toLowerCase()));

  const result = withColumns(
    table.value,
    [{ name: into.value, type: first ? 'link' : 'list' }],
    'urls',
    (row) => {
      const found = new Set<string>();
      for (const column of columns) {
        for (const address of addressesIn(row.values[column.name])) {
          if (wanted.has(hostOf(address))) found.add(address);
        }
      }
      const links = [...found];
      if (links.length === 0) return { [into.value]: null };
      return { [into.value]: first ? (links[0] ?? null) : links };
    },
  );
  return ok({ table: result });
}

async function readHosts(
  context: VerbContext,
  argument: Argument,
): Promise<Result<readonly string[], Problems>> {
  if (isDataReference(argument.value)) return readDataArgument(context, argument, HOSTS);
  const names = columnNames([argument]).map((name) => name.value);
  const bad = names.find((name) => !HOST_SHAPE.test(name));
  if (bad !== undefined || names.length === 0) {
    const problem =
      bad === undefined ? 'host= names no host' : `host= has '${bad}', and ${HOST_PROBLEM}`;
    return argumentsProblem(context, problem, locate(context)(argument.range)) as Result<
      never,
      Problems
    >;
  }
  return ok(names);
}
