import { type Diagnostic, type SourceRange, diagnostic, didYouMean, err, ok } from '@tyto/core';

import type { Derivation, VerbContext, VerbResult } from './registry.js';
import { argumentsProblem, locate, refuseNamed, requireTable } from './support.js';
import { type Table, findColumn } from './table.js';

/**
 * `derive <name> [<name>…]` runs registered derivations in the order written, each reading the
 * table the one before it produced (ADR 0133). Tyto registers none: the rules that turn a title
 * into a kind or a pairing key are a team's, and arrive with that team's plugin (ADR 0127).
 *
 * A derivation is checked on both sides of its call. Before, every column it requires must be
 * in the table, so the cell names what is missing instead of the derivation failing on a row.
 * After, every column it promised must be there and no row may have come or gone: a derivation
 * that dropped rows would be a filter nobody can see in the recipe.
 */
export async function derive(context: VerbContext): Promise<VerbResult> {
  const named = refuseNamed(context, []);
  if (named !== undefined) return named;
  const start = requireTable(context);
  if (!start.ok) return start;
  if (context.step.positional.length === 0) {
    return argumentsProblem(
      context,
      'takes the names of one or more derivations, as in derive kind',
    );
  }

  const at = locate(context);
  const warnings: Diagnostic[] = [];
  let table = start.value;
  for (const argument of context.step.positional) {
    const range = at(argument.range);
    const name = argument.value;
    const derivation = context.derivations.get(name);
    if (derivation === undefined) return unknownDerivation(context, name, range);

    const lacking = derivation.requires.filter((column) => findColumn(table, column) === undefined);
    if (lacking.length > 0) {
      return problem(
        name,
        `needs the column${lacking.length > 1 ? 's' : ''} ${lacking.join(', ')}, which this ` +
          `table lacks; it has ${table.columns.map((column) => column.name).join(', ') || '(none)'}`,
        range,
      );
    }

    const outcome = await derivation.derive(table);
    if (!outcome.ok) {
      return err(outcome.error.map((found) => (found.range ? found : { ...found, range })));
    }
    const broken = brokenPromise(derivation, table, outcome.value.table);
    if (broken !== undefined) return problem(name, broken, range);
    warnings.push(
      ...outcome.diagnostics.map((found) => (found.range ? found : { ...found, range })),
    );
    table = outcome.value.table;
  }
  return ok({ table }, warnings);
}

function brokenPromise(derivation: Derivation, before: Table, after: Table): string | undefined {
  const missing = derivation.produces.filter((column) => findColumn(after, column) === undefined);
  if (missing.length > 0) {
    return `declares that it produces ${missing.join(', ')}, and its table lacks ${
      missing.length > 1 ? 'them' : 'it'
    }`;
  }
  const kept =
    after.rows.length === before.rows.length &&
    after.rows.every((row, index) => row.key === before.rows[index]?.key);
  if (!kept) {
    return (
      `returned ${after.rows.length} rows for ${before.rows.length}, or in another order; a ` +
      'derivation adds columns and leaves the rows as they were'
    );
  }
  return undefined;
}

function unknownDerivation(context: VerbContext, name: string, range: SourceRange): VerbResult {
  const registered = context.derivations.names();
  if (registered.length === 0) {
    return problem(
      name,
      'is not registered, and no derivation is; derivations come with installed plugins',
      range,
    );
  }
  const guess = didYouMean(name, registered);
  return err([
    diagnostic(
      'E_RECIPE_DERIVATION',
      { name, problem: `is not registered; registered: ${registered.join(', ')}` },
      guess === undefined ? { range } : { range, hint: `Did you mean '${guess}'?` },
    ),
  ]);
}

function problem(name: string, text: string, range: SourceRange): VerbResult {
  return err([diagnostic('E_RECIPE_DERIVATION', { name, problem: text }, { range })]);
}
