import { type Diagnostic, type Result, diagnostic, err, ok, sourceRange } from '@tyto/core';

const RECIPE_NAME = /^[A-Za-z0-9][\w-]*$/u;

/**
 * The text of a new recipe (ADR 0176): its header, one description line and one parameter
 * with a default, so it parses and runs as made, and the person's first edit is a step. The
 * name is the file's stem, in letters, digits, `-` and `_`, as a `run` line names a recipe.
 */
export function recipeSkeleton(name: string): Result<string, readonly Diagnostic[]> {
  if (!RECIPE_NAME.test(name)) {
    return err([
      diagnostic(
        'E_RECIPE_FORM',
        {
          problem: `'${name}' is not a recipe name; it starts with a letter or a digit and holds letters, digits, - and _`,
        },
        { range: sourceRange(0, name.length) },
      ),
    ]);
  }
  return ok(
    [
      `recipe ${name}`,
      '  | What this recipe does, in one line.',
      'param project = demo',
      '',
      '# Each line below is one step: a verb and its arguments.',
      '',
    ].join('\n'),
  );
}
