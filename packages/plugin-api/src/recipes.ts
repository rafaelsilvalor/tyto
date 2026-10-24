import { type Diagnostic, type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import {
  type ArgumentSpec,
  type ArgumentValues,
  type Derivation,
  type DerivationRegistry,
  PAGE_LIMITS,
  type PageLimits,
  type SourcePage,
  type Table,
  type Verb,
  type VerbContext,
  type VerbRegistry,
  type VerbResult,
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

/** The four kinds of ADR 0128. Only the first two can be called in this version. */
export const RECIPE_VERB_KINDS = ['source', 'transform', 'action', 'sink'] as const;
export type RecipeVerbKind = (typeof RECIPE_VERB_KINDS)[number];

/** What `page` is handed: the step's arguments, checked, and where the last page left off. */
export interface PageRequest {
  readonly arguments: ArgumentValues;
  /** Absent for the first page. */
  readonly cursor?: string;
}

export interface TransformRequest {
  readonly arguments: ArgumentValues;
  readonly table: Table;
}

type Answer<T> = Result<T, Diagnostics> | Promise<Result<T, Diagnostics>>;

/**
 * One verb. A `source` answers one page per call and the host loops, so each call fits its
 * own deadline (ADR 0042); a `transform` answers the whole table. Both are checked on the
 * host before the next cell reads them.
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

export function checkRecipeVerb(
  pluginId: string,
  namespace: string | undefined,
  verb: RecipeVerbContribution,
): void {
  checkName(pluginId, 'verb', verb.id, namespace);
  const refuse = (problem: string): never => {
    throw new TypeError(`Plugin '${pluginId}' registered the verb '${verb.id}' ${problem}`);
  };
  if (verb.kind === 'action' || verb.kind === 'sink') {
    refuse(
      `as ${verb.kind === 'action' ? 'an action' : 'a sink'}, which arrives in a later ` +
        'version of Tyto; this one calls sources and transforms',
    );
  }
  const callable = verb.kind === 'source' ? 'page' : 'transform';
  if (typeof verb[callable] !== 'function') refuse(`as a ${verb.kind} with no '${callable}'`);
  const names = new Set<string>();
  for (const argument of verb.arguments) {
    if (!ARGUMENT_NAME.test(argument.name)) refuse(`with the argument name '${argument.name}'`);
    if (names.has(argument.name)) refuse(`with the argument '${argument.name}' twice`);
    names.add(argument.name);
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

/** The two points as the host's registry holds them. `PluginRegistry` is one. */
export interface RecipeContributions {
  recipeVerbs(): readonly RecipeVerbContribution[];
  recipeDerivations(): readonly RecipeDerivationContribution[];
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
  limits: PageLimits = PAGE_LIMITS,
): RecipeRegistries {
  const ownVerbs = createVerbRegistry();
  const ownDerivations = createDerivationRegistry();
  const contributedVerb = (name: string) =>
    contributions.recipeVerbs().find((verb) => verb.id === name);
  const contributedDerivation = (name: string) =>
    contributions.recipeDerivations().find((derivation) => derivation.id === name);

  return {
    verbs: {
      register: (name, verb) => ownVerbs.register(name, verb),
      get(name) {
        const own = ownVerbs.get(name);
        if (own !== undefined) return own;
        const contributed = contributedVerb(name);
        return contributed === undefined ? undefined : verbOf(contributed, limits);
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

function verbOf(contribution: RecipeVerbContribution, limits: PageLimits): Verb {
  return {
    kind: contribution.kind,
    async run(context) {
      const values = readArguments(context, contribution.arguments);
      if (!values.ok) return values;
      const { page, transform } = contribution;
      if (contribution.kind === 'source' && page !== undefined) {
        const fetched = await pagedSource(
          contribution.id,
          async (cursor) =>
            page.call(
              contribution,
              cursor === undefined
                ? { arguments: values.value }
                : { arguments: values.value, cursor },
            ),
          limits,
        );
        return placed(
          context,
          fetched.ok ? ok({ table: fetched.value }, fetched.diagnostics) : fetched,
        );
      }
      if (contribution.kind === 'transform' && transform !== undefined) {
        if (context.table === undefined) {
          return err([
            diagnostic(
              'E_RECIPE_NO_TABLE',
              { verb: contribution.id },
              { range: context.written.verbRange },
            ),
          ]);
        }
        const answer = await transform.call(contribution, {
          arguments: values.value,
          table: context.table,
        });
        return placed(context, checkedAnswer(answer, contribution.id, limits));
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
