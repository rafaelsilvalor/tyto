import type { SourceRange } from '@tyto/core';

import type { RecipeAst } from './ast.js';
import { isDataReference, parseDataReference } from './data.js';

/** A data file a step names, as `@./company.vocab.json#/rules/kinds`. */
export interface DataFileReference {
  /** The path as written, relative to the recipe's folder. */
  readonly path: string;
  readonly pointer: string;
  readonly verb: string;
  readonly range: SourceRange;
  /**
   * The path climbs out of the recipe's folder (`../shared.json`). A host copying a recipe
   * reports such a file and never follows it (ADR 0112, ADR 0176).
   */
  readonly leavesFolder: boolean;
}

/** Another recipe a `run` line includes, by name: the host reads `<name>.recipe` beside it. */
export interface IncludedRecipeReference {
  readonly name: string;
  readonly range: SourceRange;
}

/** An argument written as a data reference that is not one, with the reason. */
export interface RefusedReference {
  readonly text: string;
  readonly problem: string;
  readonly range: SourceRange;
}

export interface RecipeReferences {
  /** Every data reference, in the order written; one file named twice is listed twice. */
  readonly data: readonly DataFileReference[];
  readonly recipes: readonly IncludedRecipeReference[];
  readonly refused: readonly RefusedReference[];
}

/**
 * The files a recipe points to (ADR 0176): the data files its arguments name and the recipes
 * its `run` lines include. It reads the text only, so a reference built from a `{param}` is
 * listed as written, and nothing is resolved: that is the host's, through its confined port
 * (ADR 0137). A JSON argument written inline is not a reference, since it starts with no `@`.
 */
export function referencesOf(recipe: RecipeAst): RecipeReferences {
  const data: DataFileReference[] = [];
  const recipes: IncludedRecipeReference[] = [];
  const refused: RefusedReference[] = [];
  for (const step of recipe.steps) {
    if (step.verb === 'run') {
      const [name] = step.positional;
      if (name !== undefined) recipes.push({ name: name.value, range: name.range });
    }
    // Inline JSON runs to the end of the line: a quoted "@x" inside it is a string, not a file.
    const inline = step.named.find((argument) => /^[[{]/u.test(argument.value));
    const cut = inline?.range.start ?? Number.POSITIVE_INFINITY;
    for (const argument of [...step.positional, ...step.named]) {
      if (argument.range.start > cut || !isDataReference(argument.value)) continue;
      const reference = parseDataReference(argument.value);
      if (!reference.ok) {
        refused.push({ text: argument.value, problem: reference.error, range: argument.range });
        continue;
      }
      data.push({
        path: reference.value.path,
        pointer: reference.value.pointer,
        verb: step.verb,
        range: argument.range,
        leavesFolder: leavesFolder(reference.value.path),
      });
    }
  }
  const byStart = (first: { range: SourceRange }, second: { range: SourceRange }) =>
    first.range.start - second.range.start;
  return { data: data.sort(byStart), recipes, refused: refused.sort(byStart) };
}

/** Whether a relative path, read segment by segment, ever climbs above where it started. */
export function leavesFolder(path: string): boolean {
  let depth = 0;
  for (const segment of path.split(/[\\/]/u)) {
    if (segment === '..') depth -= 1;
    else if (segment !== '.' && segment !== '') depth += 1;
    if (depth < 0) return true;
  }
  return false;
}
