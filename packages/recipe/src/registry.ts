import { type Diagnostic, type Result, diagnostic, err, ok } from '@tyto/core';

import type { RecipeAst, Step } from './ast.js';
import type { RunClock } from './clock.js';
import type { DataResolver } from './data.js';
import type { Plan } from './plan.js';
import type { Table } from './table.js';
import { genericVerbs } from './verbs.js';

/** The four kinds of verb a plugin can contribute (ADR 0128). The generic verbs transform. */
export type VerbKind = 'source' | 'transform' | 'action' | 'sink';

/** What `keep <name>` asks the host to write into the workspace (ADR 0130). */
export interface KeepRequest {
  readonly name: string;
  readonly table: Table;
}

/** Finds another recipe by name, for `run`. Asynchronous because the host reads a file. */
export type RecipeResolver = (name: string) => Promise<Result<RecipeAst, readonly Diagnostic[]>>;

export interface VerbContext {
  /** The previous cell's table, or the run's input; absent before any source. */
  readonly table: Table | undefined;
  /** The step with every `{param}` filled. */
  readonly step: Step;
  /** The step as the file holds it, whose text the ranges point into. */
  readonly written: Step;
  /** Input-only names for columns, keyed in lower case. */
  readonly aliases: ReadonlyMap<string, string>;
  readonly derivations: DerivationRegistry;
  readonly resolveRecipe: RecipeResolver;
  /**
   * Reads a data file a verb argument names as `@./file.json#/pointer` (ADR 0136, ADR 0137).
   * Absent where the host gives recipes no files: a verb that needs one then says so.
   */
  readonly resolveData?: DataResolver | undefined;
  /**
   * The run's clock, which `age` reads a stamp against (ADR 0139). Absent in a context built
   * outside `runRecipe`; a verb then reads the system clock.
   */
  readonly clock?: RunClock | undefined;
  /** The registry the run uses, which `run` hands to the recipe it includes. */
  readonly verbs: VerbRegistry;
  /** The recipes running, outermost first and this one last, so `run` can refuse a cycle. */
  readonly recipes: readonly string[];
}

export interface VerbOutput {
  readonly table: Table;
  readonly view?: string;
  /** Several when the cell is a `run` whose recipe keeps more than one table. */
  readonly keeps?: readonly KeepRequest[];
  /**
   * An action's or a sink's: what it would write, and nothing written (ADR 0129). Its `table`
   * is the one it read, so a cell after it reads the same rows.
   */
  readonly plan?: Plan;
}

export type VerbResult = Result<VerbOutput, readonly Diagnostic[]>;

/**
 * A verb answers asynchronously when it wants to: a plugin's verb is a call into another
 * process (TYTO-376), and the runner awaits every verb the same way.
 */
export interface Verb {
  readonly kind: VerbKind;
  run(context: VerbContext): VerbResult | Promise<VerbResult>;
}

/** The verbs Tyto owns. A contributed verb is namespaced, so it can never take one of these. */
export const GENERIC_VERBS = [
  'param',
  'run',
  'where',
  'select',
  'join',
  'sort',
  'derive',
  'show',
  'keep',
  'rules',
  'compose',
  'collect',
  'extract',
  'rewrite',
  'urls',
  'nearest',
  'map',
  'path',
  'age',
] as const;

const CONTRIBUTED_NAME = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

interface Registry<Entry> {
  register(name: string, entry: Entry): Result<void, readonly Diagnostic[]>;
  get(name: string): Entry | undefined;
  names(): readonly string[];
}

export type VerbRegistry = Registry<Verb>;

/**
 * A derivation computes columns from the ones a row already has; `derive <name>` runs one.
 * The registry is open because the rules are somebody's domain, and a domain's naming rules
 * live in that domain's own plugin, never in Tyto (ADR 0127).
 *
 * It may answer asynchronously, like a verb: a plugin's derivation is a call into another
 * process (TYTO-376), and `derive` awaits it (ADR 0133). It returns the whole table, with the
 * same rows in the same order and the columns it produces added or recomputed.
 */
export interface Derivation {
  /** Columns the derivation reads, so a missing one is named before it runs. */
  readonly requires: readonly string[];
  /** Columns it adds. */
  readonly produces: readonly string[];
  derive(table: Table): VerbResult | Promise<VerbResult>;
}

export type DerivationRegistry = Registry<Derivation>;

function createRegistry<Entry>(
  kind: string,
  checkName: (name: string) => string | undefined,
): Registry<Entry> & { readonly entries: Map<string, Entry> } {
  const entries = new Map<string, Entry>();
  return {
    entries,
    register(name, entry) {
      const problem =
        checkName(name) ?? (entries.has(name) ? 'that name is already registered' : undefined);
      if (problem !== undefined) {
        return err([diagnostic('E_RECIPE_REGISTRATION', { kind, name, problem })]);
      }
      entries.set(name, entry);
      return ok(undefined);
    },
    get: (name) => entries.get(name),
    names: () => [...entries.keys()].sort(),
  };
}

/**
 * A registry holding the generic verbs, to which plugins add theirs. Only a namespaced name
 * (`jira.pull`) can be registered: bare names are Tyto's vocabulary, and a plugin that could
 * take `where` would change what every shared recipe means. `param` is in the vocabulary and
 * not in the registry, because the parser reads it and it is never a cell.
 */
export function createVerbRegistry(): VerbRegistry {
  const registry = createRegistry<Verb>('verb', (name) =>
    CONTRIBUTED_NAME.test(name)
      ? undefined
      : "a contributed verb is namespaced as '<plugin>.<verb>', in lower case",
  );
  for (const [name, verb] of Object.entries(genericVerbs)) registry.entries.set(name, verb);
  return registry;
}

/**
 * Bare names are Tyto's, and Tyto registers none (ADR 0133); a plugin's derivation is
 * namespaced like its verbs, which `@tyto/plugin-api` enforces at registration (ADR 0135).
 */
const DERIVATION_NAME = /^(?:[a-z][a-z0-9-]*\.)?[a-z][a-z0-9-]*$/u;

export function createDerivationRegistry(): DerivationRegistry {
  return createRegistry<Derivation>('derivation', (name) =>
    DERIVATION_NAME.test(name)
      ? undefined
      : "a derivation is named in lower-case words, as '<plugin>.<name>' when a plugin's",
  );
}
