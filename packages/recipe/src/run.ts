import { type Diagnostic, type Result, diagnostic, didYouMean, err, ok } from '@tyto/core';

import type { RecipeAst, Step } from './ast.js';
import { type RunClock, systemClock } from './clock.js';
import type { DataResolver } from './data.js';
import { fillPlaceholders } from './parse.js';
import type { Plan } from './plan.js';
import type {
  DerivationRegistry,
  IncludedRecipe,
  KeepRequest,
  RecipeResolver,
  VerbRegistry,
} from './registry.js';
import type { RecipeState, StateWrite } from './state.js';
import type { Table } from './table.js';
import type { CellView, ViewSpecs } from './views.js';

export interface RunOptions {
  /** The table the first cell reads; absent when the recipe starts with a source. */
  readonly input?: Table | undefined;
  /** Values for the recipe's `param` lines, by name. */
  readonly params?: Readonly<Record<string, string>>;
  /**
   * Values `set` steps above the first step given already computed, by name (ADR 0199): a
   * host that runs a slice of the recipe hands on what the cells it reused had set.
   */
  readonly values?: Readonly<Record<string, string>> | undefined;
  readonly verbs: VerbRegistry;
  readonly derivations: DerivationRegistry;
  readonly resolveRecipe: RecipeResolver;
  /**
   * Reads the data files verb arguments name (ADR 0137). Optional because a host without a
   * workspace (a test, a plugin's own runner) has none; a verb that needs one says so.
   */
  readonly resolveData?: DataResolver | undefined;
  /**
   * What now is and the offset a written time is in (ADR 0139); the machine's clock and zone
   * when absent. A test fixes it, and `run` hands it to the recipe it includes.
   */
  readonly clock?: RunClock | undefined;
  /**
   * The recipe's state between runs (ADR 0140), bound by the host to this workspace and this
   * recipe. Absent where the host keeps none; `run` hands it to the recipe it includes.
   */
  readonly state?: RecipeState | undefined;
  /** `{alias: column}`: names a person types, read on the way in and never written out. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** The recipes that include this one through `run`, outermost first. */
  readonly within?: readonly string[];
  /**
   * The views the host draws, by name, with the arguments each reads (ADR 0171): `show` checks
   * its view and arguments against them. Absent, `show` takes any one name, as a CLI run does.
   */
  readonly views?: ViewSpecs | undefined;
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
  /**
   * What this cell asked `remember` to store, a `run` cell's being everything its recipe did.
   * Held by the cell so a host that reuses it on a later run, without running it, still has
   * its writes to commit (ADR 0170). Present only when there are some.
   */
  readonly remembers?: readonly StateWrite[];
  /**
   * The view the cell is drawn in: the last `show` at or above it, with its arguments (ADR
   * 0171). Absent while no `show` has run.
   */
  readonly view?: CellView;
  /**
   * A `run` cell's: the cells of the recipe it included, each holding its own table, for a
   * notebook to open the cell onto (TYTO-449). Present only when the `run` succeeded.
   */
  readonly included?: IncludedRecipe;
  /** A `set` cell's: the name it set and the value, which the steps below read (ADR 0199). */
  readonly named?: { readonly name: string; readonly value: string };
  /** A line the cell's result shows, which is no diagnostic (`VerbOutput.note`). */
  readonly note?: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface RecipeRun {
  readonly cells: readonly Cell[];
  /** The last cell's table, when every cell ran. */
  readonly table?: Table;
  /** The view the last `show` picked. */
  readonly view?: string;
  readonly keeps: readonly KeepRequest[];
  /**
   * What `remember` asked to store, in the order the rows ran. Nothing is stored yet: the host
   * passes these and the apply's outcome to `stateToCommit` (ADR 0140).
   */
  readonly remembers: readonly StateWrite[];
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
  const header = paramValues(recipe, options.params ?? {});
  if (!header.ok) return header;
  // ADR 0199: what `{name}` fills grows down the chain, as each `set` cell adds its value.
  const values = new Map([...Object.entries(options.values ?? {}), ...header.value]);

  const aliases = new Map(
    Object.entries(options.aliases ?? {}).map(([alias, column]) => [alias.toLowerCase(), column]),
  );
  const cells: Cell[] = [];
  const keeps: KeepRequest[] = [];
  const remembers: StateWrite[] = [];
  const diagnostics: Diagnostic[] = [];
  let table = options.input;
  let view: string | undefined;
  let cellView: CellView | undefined;
  let failed = false;
  const recipes = [...(options.within ?? []), recipe.name];
  const clock = options.clock ?? systemClock;

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
      step: filled(written, values),
      written,
      aliases,
      derivations: options.derivations,
      resolveRecipe: options.resolveRecipe,
      resolveData: options.resolveData,
      clock,
      state: options.state,
      verbs: options.verbs,
      recipes,
      views: options.views,
    });
    if (!outcome.ok) {
      cells.push({ step: written, status: 'failed', diagnostics: outcome.error });
      diagnostics.push(...outcome.error);
      failed = true;
      continue;
    }
    table = outcome.value.table;
    view = outcome.value.view ?? view;
    if (outcome.value.view !== undefined) {
      cellView = { name: outcome.value.view, options: outcome.value.viewOptions ?? {} };
    }
    keeps.push(...(outcome.value.keeps ?? []));
    const cellRemembers = outcome.value.remembers ?? [];
    remembers.push(...cellRemembers);
    const { plan, included, note } = outcome.value;
    const computed = Object.entries(outcome.value.values ?? {});
    for (const [name, value] of computed) values.set(name, value);
    const [named] = computed;
    cells.push({
      step: written,
      status: 'ok',
      table,
      ...(plan === undefined ? {} : { plan }),
      ...(cellRemembers.length === 0 ? {} : { remembers: cellRemembers }),
      ...(cellView === undefined ? {} : { view: cellView }),
      ...(included === undefined ? {} : { included }),
      ...(named === undefined ? {} : { named: { name: named[0], value: named[1] } }),
      ...(note === undefined ? {} : { note }),
      diagnostics: outcome.diagnostics,
    });
    diagnostics.push(...outcome.diagnostics);
  }

  const run: RecipeRun = {
    cells,
    keeps,
    remembers,
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
    if (recipe.consts.some((constant) => constant.name === name)) {
      problems.push(constGiven(name));
      continue;
    }
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
  for (const constant of recipe.consts) values.set(constant.name, constant.value);
  return problems.length > 0 ? err(problems) : ok(values);
}

/**
 * A value supplied for a `const` (ADR 0199): from `--param`, the window, an agent or a `run`
 * line, every way in says the same.
 */
export function constGiven(name: string, range?: Diagnostic['range']): Diagnostic {
  return diagnostic(
    'E_RECIPE_PARAM',
    {
      param: name,
      problem:
        "was given a value, and it is a 'const' written in the recipe, which takes no value " +
        'from outside',
    },
    range === undefined ? {} : { range },
  );
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
