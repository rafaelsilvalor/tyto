import { type Diagnostic, type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import {
  type ArgumentSpec,
  type ArgumentValues,
  type Derivation,
  type DerivationRegistry,
  PAGE_LIMITS,
  PLAN_LIMITS,
  type PageLimits,
  type Plan,
  type PlanLimits,
  type SourcePage,
  type Table,
  type Verb,
  type VerbContext,
  type VerbRegistry,
  type VerbResult,
  checkPlan,
  checkTable,
  createDerivationRegistry,
  createVerbRegistry,
  pagedSource,
  readArguments,
} from '@tyto/recipe';

import type { Contribution } from './contributions.js';

/**
 * `recipe-verb` and `recipe-derivation`: a plugin's share of the recipe vocabulary (ADR 0128,
 * ADR 0135).
 *
 * **Everything a plugin contributes here is named in its own namespace**, declared once in its
 * manifest and owned by it alone: `jira.pull`, `jira.kind`. Bare names are Tyto's, so a shared
 * recipe's `where` means the same on every machine, and a namespace two plugins wanted is
 * refused at load (`E_PLUGIN_NAMESPACE_TAKEN`) rather than settled by load order.
 */

/**
 * The four kinds of ADR 0128. A source and a transform answer a table; an action and a sink
 * answer a {@link Plan} and write nothing until it is applied (ADR 0129, TYTO-378).
 */
export const RECIPE_VERB_KINDS = ['source', 'transform', 'action', 'sink'] as const;
export type RecipeVerbKind = (typeof RECIPE_VERB_KINDS)[number];

/**
 * What every verb call carries besides its own input (ADR 0147).
 *
 * `section` is the verb's plugin's own section of the folder's `.tyto/project.json`, resolved
 * with its work profile (ADR 0112, ADR 0114), as a `SourceRequest` hands a source: where a
 * connector learns which site or sheet the folder works with. It rides on every call rather
 * than on activation, because a plugin's process outlives the folder that was open when it
 * started. **Absent when the folder has none or withheld it** (a restricted folder, ADR 0111),
 * and never another plugin's section. The host does not check it: it is the plugin's data,
 * and the plugin answers its own diagnostics about it.
 */
export interface VerbRequest {
  readonly section?: unknown;
}

/** What `page` is handed: the step's arguments, checked, and where the last page left off. */
export interface PageRequest extends VerbRequest {
  readonly arguments: ArgumentValues;
  /** Absent for the first page. */
  readonly cursor?: string;
  /**
   * `true` when the person asked to run again without cache (ADR 0148): the source skips its
   * private cache (ADR 0138) and fetches. Absent on an ordinary run, never `false`, so a source
   * that does not cache can ignore it. On every page of that run, not only the first.
   */
  readonly refresh?: boolean;
}

export interface TransformRequest extends VerbRequest {
  readonly arguments: ArgumentValues;
  readonly table: Table;
}

/** What an action's or a sink's `plan` is handed: the table it would write from. */
export type PlanRequest = TransformRequest;

type Answer<T> = Result<T, Diagnostics> | Promise<Result<T, Diagnostics>>;

/** What the host read in the plugin's manifest that its recipe verbs are held to (ADR 0135). */
export interface RecipeDeclarations {
  readonly namespace?: string | undefined;
  readonly writes?: readonly string[] | undefined;
}

/**
 * One verb. A `source` answers one page per call and the host loops, so each call fits its
 * own deadline (ADR 0042); a `transform` answers the whole table. Both are checked on the
 * host before the next cell reads them. An `action` or a `sink` answers a plan holding only
 * the kinds of write it declared in `writes`, and the host refuses any other.
 */
export interface RecipeVerbContribution extends Contribution {
  /** `<namespace>.<verb>`, in lower case. */
  readonly id: string;
  readonly kind: RecipeVerbKind;
  readonly arguments: readonly ArgumentSpec[];
  /** A source's. */
  page?(request: PageRequest): Answer<SourcePage>;
  /** A transform's. */
  transform?(request: TransformRequest): Answer<Table>;
  /**
   * An action's or a sink's: the kinds of write its plans may hold, a subset of the manifest's
   * `writes`. Absent on a source or a transform, which write nothing.
   */
  readonly writes?: readonly string[];
  /** An action's or a sink's. Nothing is written: applying a plan is TYTO-378's. */
  plan?(request: PlanRequest): Answer<Plan>;
}

/** A derivation for `derive` (ADR 0133), named `<namespace>.<name>`. */
export interface RecipeDerivationContribution extends Contribution {
  readonly requires: readonly string[];
  readonly produces: readonly string[];
  derive(table: Table): Answer<Table>;
}

const WORD = /^[a-z][a-z0-9-]*$/u;
const ARGUMENT_NAME = /^[A-Za-z_][\w-]*$/u;

/**
 * The checks a registration cannot pass with, as a `TypeError` that `tryActivate` answers as
 * `E_PLUGIN_ACTIVATE`: each is a mistake in the plugin's code, said when it loads rather than
 * met as a verb nobody can call.
 */
function checkName(
  pluginId: string,
  what: string,
  id: string,
  namespace: string | undefined,
): void {
  if (namespace === undefined) {
    throw new TypeError(
      `Plugin '${pluginId}' registered the ${what} '${id}' and its tyto-plugin.json declares ` +
        `no 'namespace'; a recipe ${what} is named '<namespace>.<name>' in the plugin's own one`,
    );
  }
  const [prefix, name, ...rest] = id.split('.');
  if (prefix !== namespace || name === undefined || !WORD.test(name) || rest.length > 0) {
    throw new TypeError(
      `Plugin '${pluginId}' registered the ${what} '${id}', and its names are written ` +
        `'${namespace}.<name>' in lower-case words`,
    );
  }
}

const CALLABLE = { source: 'page', transform: 'transform', action: 'plan', sink: 'plan' } as const;

export function checkRecipeVerb(
  pluginId: string,
  declared: RecipeDeclarations,
  verb: RecipeVerbContribution,
): void {
  checkName(pluginId, 'verb', verb.id, declared.namespace);
  const refuse = (problem: string): never => {
    throw new TypeError(`Plugin '${pluginId}' registered the verb '${verb.id}' ${problem}`);
  };
  const kind = `${verb.kind === 'action' ? 'an' : 'a'} ${verb.kind}`;
  const callable = CALLABLE[verb.kind];
  if (typeof verb[callable] !== 'function') refuse(`as ${kind} with no '${callable}'`);
  checkWrites(verb, declared.writes ?? [], (problem) => refuse(`as ${kind} ${problem}`));
  const names = new Set<string>();
  for (const argument of verb.arguments) {
    if (!ARGUMENT_NAME.test(argument.name)) refuse(`with the argument name '${argument.name}'`);
    if (names.has(argument.name)) refuse(`with the argument '${argument.name}' twice`);
    names.add(argument.name);
  }
}

/**
 * ADR 0129 decision 3: a verb that writes names which kinds, out of the manifest's list, so
 * what a person read before installing is all it can plan; a verb that writes nothing names
 * none.
 */
function checkWrites(
  verb: RecipeVerbContribution,
  manifestWrites: readonly string[],
  refuse: (problem: string) => never,
): void {
  const { writes } = verb;
  if (verb.kind === 'source' || verb.kind === 'transform') {
    if (writes !== undefined) refuse("with 'writes', and only an action or a sink writes");
    return;
  }
  if (writes === undefined || writes.length === 0) {
    refuse("with no 'writes'; it names the kinds of write its plans hold");
    return;
  }
  if (new Set(writes).size !== writes.length) refuse("with a write named twice in 'writes'");
  const undeclared = writes.filter((write) => !manifestWrites.includes(write));
  if (undeclared.length > 0) {
    refuse(
      `writing ${undeclared.map((write) => `'${write}'`).join(', ')}, which its ` +
        `tyto-plugin.json does not declare in 'writes' (${
          manifestWrites.length > 0 ? manifestWrites.join(', ') : 'none'
        })`,
    );
  }
}

export function checkRecipeDerivation(
  pluginId: string,
  namespace: string | undefined,
  derivation: RecipeDerivationContribution,
): void {
  checkName(pluginId, 'derivation', derivation.id, namespace);
}

export interface RecipeRegistries {
  readonly verbs: VerbRegistry;
  readonly derivations: DerivationRegistry;
}

/** A recipe verb with the plugin that registered it, which names the section it is handed. */
export interface OwnedRecipeVerb {
  readonly plugin: string;
  readonly verb: RecipeVerbContribution;
}

/** The two points as the host's registry holds them. `PluginRegistry` is one. */
export interface RecipeContributions {
  recipeVerbs(): readonly RecipeVerbContribution[];
  ownedRecipeVerbs(): readonly OwnedRecipeVerb[];
  recipeDerivations(): readonly RecipeDerivationContribution[];
}

export interface RecipeRegistryOptions {
  /**
   * A plugin's own section of the open folder's project, by plugin id (ADR 0147), or
   * `undefined` when it has none or the folder withheld it. **Asked on every verb call**, so a
   * folder trusted or edited between two runs is what the next call reads; the caller answers
   * from the folder the recipe belongs to.
   */
  readonly sectionOf?: (plugin: string) => unknown;
  /**
   * The run asked for fresh data, so every source's `page` is handed `refresh: true` and skips
   * its private cache (ADR 0148). Fixed for the registries' life: a caller builds them per run.
   */
  readonly refresh?: boolean;
  readonly limits?: PageLimits;
  readonly planLimits?: PlanLimits;
}

/**
 * The recipe runner's two registries, over the generic verbs and every plugin's contributions
 * (ADR 0135) — the adapter `directiveResolverOf` is for directives.
 *
 * Read per lookup rather than copied, so a plugin withdrawn from the host stops answering
 * without anybody rebuilding these. What `register` adds is the caller's and stays here.
 */
export function recipeRegistriesOf(
  contributions: RecipeContributions,
  options: RecipeRegistryOptions = {},
): RecipeRegistries {
  const limits = options.limits ?? PAGE_LIMITS;
  const planLimits = options.planLimits ?? PLAN_LIMITS;
  const sectionOf = options.sectionOf ?? (() => undefined);
  const refresh = options.refresh === true;
  const ownVerbs = createVerbRegistry();
  const ownDerivations = createDerivationRegistry();
  const contributedVerb = (name: string) =>
    contributions.ownedRecipeVerbs().find((owned) => owned.verb.id === name);
  const contributedDerivation = (name: string) =>
    contributions.recipeDerivations().find((derivation) => derivation.id === name);

  return {
    verbs: {
      register: (name, verb) => ownVerbs.register(name, verb),
      get(name) {
        const own = ownVerbs.get(name);
        if (own !== undefined) return own;
        const contributed = contributedVerb(name);
        return contributed === undefined
          ? undefined
          : verbOf(contributed.verb, {
              sectionOfOwner: () => sectionOf(contributed.plugin),
              refresh,
              limits,
              planLimits,
            });
      },
      names: () => namesOf(ownVerbs.names(), contributions.recipeVerbs()),
    },
    derivations: {
      register: (name, derivation) => ownDerivations.register(name, derivation),
      get(name) {
        const own = ownDerivations.get(name);
        if (own !== undefined) return own;
        const contributed = contributedDerivation(name);
        return contributed === undefined ? undefined : derivationOf(contributed, limits);
      },
      names: () => namesOf(ownDerivations.names(), contributions.recipeDerivations()),
    },
  };
}

function namesOf(own: readonly string[], contributed: readonly Contribution[]): string[] {
  return [...new Set([...own, ...contributed.map((entry) => entry.id)])].sort();
}

/**
 * The section rides only when there is one, so a verb in a restricted folder is handed no key
 * at all rather than an empty object it could mistake for a folder that chose nothing.
 */
function withSection(section: unknown): VerbRequest {
  return section === undefined ? {} : { section };
}

interface VerbBinding {
  readonly sectionOfOwner: () => unknown;
  readonly refresh: boolean;
  readonly limits: PageLimits;
  readonly planLimits: PlanLimits;
}

/**
 * `sectionOfOwner` is bound to the plugin that registered the verb, so the verb is handed its
 * own plugin's section and no other: this is the per-plugin filter of ADR 0147.
 */
function verbOf(contribution: RecipeVerbContribution, binding: VerbBinding): Verb {
  const { sectionOfOwner, refresh, limits, planLimits } = binding;
  return {
    kind: contribution.kind,
    async run(context) {
      const values = readArguments(context, contribution.arguments);
      if (!values.ok) return values;
      const { page, transform, plan } = contribution;
      if (contribution.kind === 'source' && page !== undefined) {
        const fetched = await pagedSource(
          contribution.id,
          async (cursor) =>
            page.call(contribution, {
              arguments: values.value,
              ...(cursor === undefined ? {} : { cursor }),
              ...withSection(sectionOfOwner()),
              // Only `true` rides, as a section only when there is one: an ordinary run hands
              // no key, which is what every source written before the field already reads.
              ...(refresh ? { refresh: true } : {}),
            }),
          limits,
        );
        return placed(
          context,
          fetched.ok ? ok({ table: fetched.value }, fetched.diagnostics) : fetched,
        );
      }
      if (context.table === undefined) {
        return err([
          diagnostic(
            'E_RECIPE_NO_TABLE',
            { verb: contribution.id },
            { range: context.written.verbRange },
          ),
        ]);
      }
      const request = {
        arguments: values.value,
        table: context.table,
        ...withSection(sectionOfOwner()),
      };
      if (contribution.kind === 'transform' && transform !== undefined) {
        const answer = await transform.call(contribution, request);
        return placed(context, checkedAnswer(answer, contribution.id, limits));
      }
      if (plan !== undefined && (contribution.kind === 'action' || contribution.kind === 'sink')) {
        const answer = await plan.call(contribution, request);
        return placed(context, checkedPlan(answer, contribution, context.table, planLimits));
      }
      // Registration refuses every other shape, so only a contribution changed after it was
      // registered reaches this.
      return err([
        diagnostic(
          'E_RECIPE_VERB',
          { verb: contribution.id, problem: `a ${contribution.kind} cannot be called here` },
          { range: context.written.verbRange },
        ),
      ]);
    },
  };
}

function derivationOf(contribution: RecipeDerivationContribution, limits: PageLimits): Derivation {
  return {
    requires: contribution.requires,
    produces: contribution.produces,
    derive: async (table) => {
      const answer = checkedAnswer(await contribution.derive(table), contribution.id, limits);
      return answer.ok
        ? ok(answer.value, answer.diagnostics.map(unplaced))
        : err(answer.error.map(unplaced));
    },
  };
}

/** A whole table from a plugin: the shape `checkTable` holds, and no more rows than a source may. */
function checkedAnswer(
  answer: Result<Table, Diagnostics>,
  origin: string,
  limits: PageLimits,
): VerbResult {
  if (!answer.ok) return answer;
  if (answer.value.rows.length > limits.maxRows) {
    return err([
      diagnostic('E_RECIPE_TABLE', {
        origin,
        problem: `it has ${String(answer.value.rows.length)} rows, over ${String(limits.maxRows)}`,
      }),
    ]);
  }
  const checked = checkTable(answer.value, origin);
  return checked.ok ? ok({ table: checked.value }, answer.diagnostics) : checked;
}

/**
 * A plan from a plugin, held to what the verb declared (ADR 0129 decision 3). The table passes
 * through unchanged: planning writes nothing, so the next cell reads the rows this one read.
 */
function checkedPlan(
  answer: Result<Plan, Diagnostics>,
  contribution: RecipeVerbContribution,
  table: Table,
  limits: PlanLimits,
): VerbResult {
  if (!answer.ok) return answer;
  const checked = checkPlan(
    answer.value,
    { verb: contribution.id, writes: contribution.writes ?? [], table },
    limits,
  );
  return checked.ok ? ok({ table, plan: checked.value }, answer.diagnostics) : checked;
}

/**
 * Placed at the verb, whatever range the plugin wrote: a plugin never sees the recipe's text,
 * so an offset of its own would point at somebody else's words.
 */
function placed(context: VerbContext, result: VerbResult): VerbResult {
  const at = (found: Diagnostic): Diagnostic => ({ ...found, range: context.written.verbRange });
  return result.ok ? ok(result.value, result.diagnostics.map(at)) : err(result.error.map(at));
}

/** For `derive`, which places a diagnostic with no range at the derivation's name. */
function unplaced(found: Diagnostic): Diagnostic {
  const { range: _ignored, ...rest } = found;
  return rest;
}
