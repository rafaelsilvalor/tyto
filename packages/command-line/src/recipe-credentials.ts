import type { RecipeCredentials } from '@tyto/io';

/**
 * A recipe credential in the CLI (TYTO-671, ADR 0193 decision 5): an environment variable, as a
 * plugin's is (ADR 0042), so the CLI stays read-only for credentials (ADR 0134).
 *
 * `token=routine-hook` reads `TYTO_RECIPE_CREDENTIAL_ROUTINE_HOOK`: the name upper-cased, every
 * character that is not a letter or a digit turned into `_`. A name `call` does not accept reads
 * nothing.
 */

/** A credential's name, as `call` accepts it. */
const CREDENTIAL_NAME = /^[a-z][a-z0-9-]{0,63}$/u;

/** The variable a recipe credential of that name is read from. */
export function recipeCredentialVariable(name: string): string {
  return `TYTO_RECIPE_CREDENTIAL_${name.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`;
}

export function environmentRecipeCredentials(
  variables: Readonly<Record<string, string | undefined>>,
): RecipeCredentials {
  return {
    read: (name) =>
      Promise.resolve(
        CREDENTIAL_NAME.test(name) ? variables[recipeCredentialVariable(name)] : undefined,
      ),
  };
}
