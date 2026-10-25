import { type Diagnostic, err, ok } from '@tyto/core';

import type { DataResolver } from '../data.js';
import { parseRecipe } from '../parse.js';
import { createDerivationRegistry, createVerbRegistry } from '../registry.js';
import { runRecipe } from '../run.js';
import type { CellValue, Table } from '../table.js';

/**
 * A neutral print shop's tasks, shaped like the rows the private plugin classifies and names
 * (TYTO-391): a title, a team, and the parts a later card's `extract` will pull from a title.
 */
const ROWS: readonly Record<string, CellValue>[] = [
  {
    key: 'RW-1073960',
    title: 'Poster - Spring Fair',
    team: 'design',
    format: 'Póster Grande',
    phase: 'Lançamento Único',
    deliverable: 'Feira de Primavera',
  },
  {
    key: 'RW-2',
    title: 'Sales page - Single batch',
    team: 'web',
    format: null,
    phase: null,
    deliverable: 'Página de Vendas',
  },
  {
    key: 'RW-3',
    title: 'Something new',
    team: 'design',
    format: null,
    phase: null,
    deliverable: 'Nº 1 — Ação!',
  },
  {
    key: 'RW-4',
    title: 'Copy for poster - Spring Fair',
    team: 'copy',
    format: 'Póster Grande',
    phase: null,
    deliverable: 'Feira de Primavera',
  },
];

export const SHOP: Table = {
  columns: Object.keys(ROWS[0] ?? {}).map((name) => ({ name, type: 'text', origin: 'test' })),
  rows: ROWS.map((values) => ({
    key: String(values['key']),
    values,
    provenance: { source: 'test', id: String(values['key']), fetchedAt: '2026-10-24' },
  })),
};

/** A rules file beside the recipe, in neutral words. */
export const VOCABULARY = {
  kinds: [
    { when: 'title matches ^poster\\b', set: { kind: 'poster' } },
    { when: 'title matches "^sales page"', set: { kind: 'site', label: 'Site' } },
    { when: 'team = copy', set: { kind: 'copy', label: null } },
    { when: '', set: { kind: 'other' } },
  ],
  first: [
    { when: 'format is not empty', set: { first: '{format}' } },
    { when: 'label is not empty', set: { first: '{label}' } },
    { when: '', set: { first: '{kind}' } },
  ],
  folder: '{first|slug}_{phase|slug}_{deliverable|slug}',
};

export interface Ran {
  readonly source: string;
  readonly table: Table | undefined;
  readonly problem: Diagnostic | undefined;
  /** The recipe text the first problem's range covers. */
  readonly at: string | undefined;
}

/** Runs the lines over the shop's table, with `files` as the workspace's data files. */
export async function runOverShop(
  lines: readonly string[],
  files: Record<string, unknown> = { './vocabulary.json': VOCABULARY },
  input: Table = SHOP,
): Promise<Ran> {
  const source = ['recipe shop', ...lines].join('\n');
  const recipe = parseRecipe(source);
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const resolveData: DataResolver = (path) =>
    Promise.resolve(path in files ? ok(files[path]) : err([]));
  const result = await runRecipe(recipe.value, {
    input,
    verbs: createVerbRegistry(),
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
    resolveData,
  });
  if (!result.ok) throw new Error('the run must start');
  const problem = result.value.cells.flatMap((cell) => cell.diagnostics)[0];
  const at = problem?.range ? source.slice(problem.range.start, problem.range.end) : undefined;
  return { source, table: result.value.table, problem, at };
}

/** One column as `{ rowKey: value }`. */
export function columnOf(table: Table | undefined, name: string): Record<string, CellValue> {
  return Object.fromEntries(table?.rows.map((row) => [row.key, row.values[name] ?? null]) ?? []);
}
