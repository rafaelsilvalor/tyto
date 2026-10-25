import { type Result, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

import type { NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import { withColumns } from './compose.js';
import { isDataReference, readDataArgument, readInlineJson } from './data.js';
import type { VerbContext, VerbResult } from './registry.js';
import {
  type Problems,
  argumentsProblem,
  argumentsUpTo,
  columnNames,
  locate,
  requireTable,
} from './support.js';
import { type CellValue, cellText, comparable } from './table.js';

const COLUMN_NAME = /^[A-Za-z_][\w-]*$/u;
const NAMES = ['from', 'to', 'graph', 'avoid', 'into'] as const;

/** Each node and the nodes one arrow away from it, in the order the file lists them. */
const GRAPH = z.record(z.string(), z.array(z.string()));
const AVOID = z.array(z.string());

/** A graph keyed by node names folded: no accents, no case, no surrounding blanks. */
export type FoldedGraph = ReadonlyMap<string, readonly string[]>;

/**
 * The graph keyed by its node names folded, or the two keys that fold to one name: which
 * arrows such a node has would depend on the order the file happens to write them in.
 */
export function foldGraph(
  graph: Readonly<Record<string, readonly string[]>>,
): Result<FoldedGraph, string> {
  const folded = new Map<string, readonly string[]>();
  const spelled = new Map<string, string>();
  for (const [node, next] of Object.entries(graph)) {
    const key = comparable(node);
    const earlier = spelled.get(key);
    if (earlier !== undefined) {
      return err(
        `has the nodes '${earlier}' and '${node}', which are one name once accents and case ` +
          'are set aside',
      );
    }
    spelled.set(key, node);
    folded.set(key, next);
  }
  return ok(folded);
}

/**
 * The shortest walk along the graph's arrows from `from` to `to`, without `from` and with each
 * node as the graph spells it, ported from Buraqueira's `Fluxo.caminho`: empty when the two are
 * one name, none when `to` is avoided or out of reach. A breadth-first search: a node is marked
 * when it is queued, so each node's arrows are read once, and arrows are followed in the order
 * the file lists them, so among walks of one length the first found wins. An avoided node is
 * never entered, and `from` is never checked against `avoid`, since the walk starts there.
 */
export function shortestPath(
  graph: FoldedGraph,
  from: string,
  to: string,
  avoid: ReadonlySet<string>,
): readonly string[] | null {
  const start = comparable(from);
  const target = comparable(to);
  if (start === target) return [];
  if (avoid.has(target)) return null;
  const seen = new Set([start]);
  const queue: { readonly node: string; readonly walk: readonly string[] }[] = [
    { node: start, walk: [] },
  ];
  for (let index = 0; index < queue.length; index++) {
    const { node, walk } = queue[index] ?? { node: '', walk: [] };
    for (const next of graph.get(node) ?? []) {
      const key = comparable(next);
      if (seen.has(key) || avoid.has(key)) continue;
      const longer = [...walk, next];
      if (key === target) return longer;
      seen.add(key);
      queue.push({ node: key, walk: longer });
    }
  }
  return null;
}

/**
 * `path from=<column> to=<column> graph=<graph> avoid=<nodes> into=<column>` writes, for each
 * row, the shortest walk through a graph from one column's value to another's (ADR 0136), as in
 * `path from=status to=target graph=@./flows.json#/first/graph avoid=@./flows.json#/avoid
 * into=steps`, where the graph is an object of each node's arrows:
 * `{ "TO DO": ["DOING", "CANCELLED"], "DOING": ["APPROVAL", "TO DO"] }`.
 *
 * The walk is `shortestPath`'s, written into a list column added at the end or recomputed in
 * place: an empty list when the row is already there, an empty cell when the graph does not
 * join the two without an avoided node, or when either cell is empty. Names compare without
 * accents, case or surrounding blanks.
 *
 * `graph=` is a data reference or JSON written inline as the last argument of the line;
 * `avoid=` is a data reference to a list of names, or the names written inline, comma-separated.
 */
export async function path(context: VerbContext): Promise<VerbResult> {
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const usage =
    'takes from=, to=, graph=, avoid= and into=, as in path from=status to=target ' +
    'graph=@./flows.json#/graph avoid=@./flows.json#/avoid into=steps';

  const graphWritten = context.step.named.find((argument) => argument.name === 'graph');
  const inline =
    graphWritten !== undefined && !isDataReference(graphWritten.value) ? graphWritten : undefined;
  const { named, positional } = argumentsUpTo(context, inline);
  const stray = positional[0];
  if (stray !== undefined) return argumentsProblem(context, usage, at(stray.range));

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
  const missing = NAMES.filter((name) => !written.has(name));
  const fromArgument = written.get('from');
  const toArgument = written.get('to');
  const graphArgument = written.get('graph');
  const avoidArgument = written.get('avoid');
  const into = written.get('into');
  if (
    fromArgument === undefined ||
    toArgument === undefined ||
    graphArgument === undefined ||
    avoidArgument === undefined ||
    into === undefined
  ) {
    return argumentsProblem(context, `needs ${missing.map((name) => `${name}=`).join(', ')}`);
  }
  if (!COLUMN_NAME.test(into.value)) {
    return argumentsProblem(context, `cannot write a column named '${into.value}'`, at(into.range));
  }

  const fromColumn = resolveColumn(
    table.value,
    fromArgument.value,
    at(fromArgument.range),
    context.aliases,
  );
  if (!fromColumn.ok) return fromColumn;
  const toColumn = resolveColumn(
    table.value,
    toArgument.value,
    at(toArgument.range),
    context.aliases,
  );
  if (!toColumn.ok) return toColumn;

  const avoidList = await readAvoid(context, avoidArgument);
  if (!avoidList.ok) return avoidList;
  const graphRead = isDataReference(graphArgument.value)
    ? await readDataArgument(context, graphArgument, GRAPH)
    : readInlineJson(context, graphArgument, GRAPH);
  if (!graphRead.ok) return graphRead;
  const graph = foldGraph(graphRead.value);
  if (!graph.ok) {
    const reference = inline === undefined ? graphArgument.value : 'graph= written inline';
    return err([
      diagnostic(
        'E_RECIPE_DATA_SHAPE',
        { reference, problem: graph.error },
        { range: at(graphArgument.range) },
      ),
    ]);
  }

  const avoid = new Set(avoidList.value.map((name) => comparable(name)));
  const walk = (from: CellValue | undefined, to: CellValue | undefined): CellValue => {
    if (comparable(from) === '' || comparable(to) === '') return null;
    return shortestPath(graph.value, cellText(from), cellText(to), avoid);
  };
  const result = withColumns(table.value, [{ name: into.value, type: 'list' }], 'path', (row) => ({
    [into.value]: walk(row.values[fromColumn.value.name], row.values[toColumn.value.name]),
  }));
  return ok({ table: result });
}

async function readAvoid(
  context: VerbContext,
  argument: NamedArgument,
): Promise<Result<readonly string[], Problems>> {
  if (isDataReference(argument.value)) return readDataArgument(context, argument, AVOID);
  return ok(columnNames([argument]).map((name) => name.value));
}
