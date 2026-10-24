import { type Diagnostic, type Result, diagnostic, didYouMean, err, ok } from '@tyto/core';

import type { RecipeAst, Step } from './ast.js';
import { fillPlaceholders } from './parse.js';
import type { Plan } from './plan.js';
import type { DerivationRegistry, KeepRequest, RecipeResolver, VerbRegistry } from './registry.js';
import type { Table } from './table.js';

export interface RunOptions {
  /** The table the first cell reads; absent when the recipe starts with a source. */
  readonly input?: Table | undefined;
  /** Values for the recipe's `param` lines, by name. */
  readonly params?: Readonly<Record<string, string>>;
  readonly verbs: VerbRegistry;
  readonly derivations: DerivationRegistry;
  readonly resolveRecipe: RecipeResolver;
  /** `{alias: column}`: names a person types, read on the way in and never written out. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** The recipes that include this one through `run`, outermost first. */
  readonly within?: readonly string[];
}

/**
 * One line's outcome. A cell after a failed one is `skipped`: the chain is linear, so it has
 * no table to read.
 */
export interface Cell {
  readonly step: Step;
  readonly status: 'ok' | 'failed' | 'skipped';
  readonly table?: Table;
  /** An action's or a sink's plan, shown under the cell; nothing was written (ADR 0129). */
  readonly plan?: Plan;
  readonly diagnostics: readonly Diagnostic[];
}

export interface RecipeRun {
  readonly cells: readonly Cell[];
  /** The last cell's table, when every cell ran. */
  readonly table?: Table;
  /** The view the last `show` picked. */
  readonly view?: string;
  readonly keeps: readonly KeepRequest[];
}

/**
 * Runs the chain cell by cell: cell N reads cell N−1's table (ADR 0128).
 *
 * The run is an error only when no cell can run, which is a parameter without a value. A
 * failing cell is a value: the run comes back ok, with that cell `failed`, the ones before it
 * holding their tables and the errors among the diagnostics. That is what a notebook draws.
 *
 * Asynchronous because a plugin's verb is a call into another process.
 */
export async function runRecipe(
  recipe: RecipeAst,
  options: RunOptions,
): Promise<Result<RecipeRun, readonly Diagnostic[]>> {
  const values = paramValues(recipe, options.params ?? {});
  if (!values.ok) return values;

  const aliases = new Map(
    Object.entries(options.aliases ?? {}).map(([alias, column]) => [alias.toLowerCase(), column]),
  );
  const cells: Cell[] = [];
  const keeps: KeepRequest[] = [];
  const diagnostics: Diagnostic[] = [];
  let table = options.input;
  let view: string | undefined;
  let failed = false;
  const recipes = [...(options.within ?? []), recipe.name];

  for (const written of recipe.steps) {
    if (failed) {
      cells.push({ step: written, status: 'skipped', diagnostics: [] });
      continue;
    }
    const verb = options.verbs.get(written.verb);
    if (verb === undefined) {
      const problem = unknownVerb(written, options.verbs.names());
      cells.push({ step: written, status: 'failed', diagnostics: [problem] });
      diagnostics.push(problem);
      failed = true;
      continue;
    }
    const outcome = await verb.run({
      table,
      step: filled(written, values.value),
      written,
      aliases,
      derivations: options.derivations,
      resolveRecipe: options.resolveRecipe,
      verbs: options.verbs,
      recipes,
    });
    if (!outcome.ok) {
      cells.push({ step: written, status: 'failed', diagnostics: outcome.error });
      diagnostics.push(...outcome.error);
      failed = true;
      continue;
    }
    table = outcome.value.table;
    view = outcome.value.view ?? view;
    keeps.push(...(outcome.value.keeps ?? []));
    const { plan } = outcome.value;
    cells.push({
      step: written,
      status: 'ok',
      table,
      ...(plan === undefined ? {} : { plan }),
      diagnostics: outcome.diagnostics,
    });
    diagnostics.push(...outcome.diagnostics);
  }

  const run: RecipeRun = {
    cells,
    keeps,
    ...(failed || table === undefined ? {} : { table }),
    ...(view === undefined ? {} : { view }),
  };
  return ok(run, diagnostics);
}

function paramValues(
  recipe: RecipeAst,
  supplied: Readonly<Record<string, string>>,
): Result<ReadonlyMap<string, string>, readonly Diagnostic[]> {
  const declared = recipe.params.map((param) => param.name);
  const problems: Diagnostic[] = [];
  for (const name of Object.keys(supplied)) {
    if (declared.includes(name)) continue;
    problems.push(
      diagnostic('E_RECIPE_PARAM', {
        param: name,
        problem: `was given a value, and this recipe declares ${
          declared.length > 0 ? declared.join(', ') : 'no parameter'
        }`,
      }),
    );
  }
  const values = new Map<string, string>();
  for (const param of recipe.params) {
    const value = supplied[param.name] ?? param.defaultValue;
    if (value === undefined) {
      problems.push(
        diagnostic(
          'E_RECIPE_PARAM',
          {
            param: param.name,
            problem:
              "has no value; give one when running the recipe, or a default in its 'param' line",
          },
          { range: param.range },
        ),
      );
    } else {
      values.set(param.name, value);
    }
  }
  return problems.length > 0 ? err(problems) : ok(values);
}

function filled(step: Step, values: ReadonlyMap<string, string>): Step {
  return {
    ...step,
    text: fillPlaceholders(step.text, values),
    positional: step.positional.map((argument) => ({
      ...argument,
      value: fillPlaceholders(argument.value, values),
    })),
    named: step.named.map((argument) => ({
      ...argument,
      value: fillPlaceholders(argument.value, values),
    })),
  };
}

function unknownVerb(step: Step, available: readonly string[]): Diagnostic {
  const guess = didYouMean(step.verb, available);
  return diagnostic(
    'E_RECIPE_UNKNOWN_VERB',
    { verb: step.verb, available: available.join(', ') },
    guess === undefined
      ? { range: step.verbRange }
      : { range: step.verbRange, hint: `Did you mean '${guess}'?` },
  );
}
