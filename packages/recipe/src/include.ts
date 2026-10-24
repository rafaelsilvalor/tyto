import { type Diagnostic, diagnostic, err, ok } from '@tyto/core';

import type { VerbContext, VerbResult } from './registry.js';
import { runRecipe } from './run.js';
import { argumentsProblem } from './support.js';

/**
 * `run <recipe> [name=value…]` includes another recipe at this line (ADR 0133), the way
 * `flow.py`'s `_expandir_run` spliced a saved recipe into the chain: the included recipe reads
 * this cell's input, and the line after `run` reads what it produced. So `run campaign-map`
 * followed by `where …` narrows the included result, as typing its lines here would.
 *
 * It is one cell and not its recipe's lines copied in, because a cell's diagnostics point into
 * the file being edited and the included lines live in another file. What goes wrong inside
 * is reported at the `run` line, naming the recipe it happened in.
 *
 * The recipe is found through the `resolveRecipe` port, so this stays pure: the host reads the
 * file. A recipe that would include one already running is refused before it is read twice.
 */
export async function include(context: VerbContext): Promise<VerbResult> {
  const [nameArgument, extra] = context.step.positional;
  if (nameArgument === undefined || extra !== undefined) {
    return argumentsProblem(
      context,
      "takes one recipe's name and its parameters as name=value, as in run campaign-map " +
        'team=design',
    );
  }
  const name = nameArgument.value;
  const range = context.written.range;
  const cycle = (found: string) =>
    err([
      diagnostic(
        'E_RECIPE_RUN',
        {
          recipe: name,
          problem: `would run a recipe that is already running: ${[...context.recipes, found].join(' → ')}`,
        },
        { range },
      ),
    ]);
  if (context.recipes.includes(name)) return cycle(name);

  const resolved = await context.resolveRecipe(name);
  if (!resolved.ok) {
    if (resolved.error.length === 0) {
      return err([
        diagnostic(
          'E_RECIPE_RUN',
          { recipe: name, problem: 'names no recipe that was found' },
          { range },
        ),
      ]);
    }
    return err(inside(name, resolved.error, range));
  }
  const recipe = resolved.value;
  // A file found by one name may declare another in its header; either one already running
  // is the same loop.
  if (context.recipes.includes(recipe.name)) return cycle(recipe.name);

  const declared = recipe.params.map((param) => param.name);
  const params: Record<string, string> = {};
  for (const argument of context.step.named) {
    if (!declared.includes(argument.name)) {
      return err([
        diagnostic(
          'E_RECIPE_PARAM',
          {
            param: argument.name,
            problem: `is not a parameter of recipe '${name}', which declares ${
              declared.length > 0 ? declared.join(', ') : 'none'
            }`,
          },
          { range: argument.range },
        ),
      ]);
    }
    params[argument.name] = argument.value;
  }

  const included = await runRecipe(recipe, {
    input: context.table,
    params,
    verbs: context.verbs,
    derivations: context.derivations,
    resolveRecipe: context.resolveRecipe,
    aliases: Object.fromEntries(context.aliases),
    within: context.recipes,
  });
  if (!included.ok) return err(inside(name, included.error, range));
  const reported = inside(name, included.diagnostics, range);
  const { table, view, keeps } = included.value;
  if (table === undefined) {
    const failed = included.value.cells.some((cell) => cell.status === 'failed');
    if (failed) return err(reported);
    return err([
      diagnostic(
        'E_RECIPE_RUN',
        { recipe: name, problem: 'ended without a table, so the next line has none to read' },
        { range },
      ),
    ]);
  }
  return ok({ table, keeps, ...(view === undefined ? {} : { view }) }, reported);
}

/** Diagnostics from the included file, moved to the `run` line and labelled with the recipe. */
function inside(
  name: string,
  found: readonly Diagnostic[],
  range: Diagnostic['range'],
): readonly Diagnostic[] {
  return found.map((problem) => ({
    ...problem,
    ...(range === undefined ? {} : { range }),
    hint: [`In recipe '${name}'.`, problem.hint].filter((part) => part !== undefined).join(' '),
  }));
}
