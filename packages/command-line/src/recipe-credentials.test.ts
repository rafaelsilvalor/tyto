import { describe, expect, it } from 'vitest';

import { environmentRecipeCredentials, recipeCredentialVariable } from './recipe-credentials.js';

describe('recipe credentials from the environment (TYTO-671, ADR 0193)', () => {
  it('upper-cases the name and turns every other character into _', () => {
    expect(recipeCredentialVariable('routine')).toBe('TYTO_RECIPE_CREDENTIAL_ROUTINE');
    expect(recipeCredentialVariable('routine-hook-2')).toBe(
      'TYTO_RECIPE_CREDENTIAL_ROUTINE_HOOK_2',
    );
  });

  it('reads the variable of a name call accepts, and nothing for any other', async () => {
    const credentials = environmentRecipeCredentials({
      TYTO_RECIPE_CREDENTIAL_ROUTINE_HOOK: 'secret',
      TYTO_RECIPE_CREDENTIAL_UPPER: 'other',
    });
    expect(await credentials.read('routine-hook')).toBe('secret');
    expect(await credentials.read('missing')).toBeUndefined();
    // `UPPER` maps to the same variable, but is not a name `call` accepts.
    expect(await credentials.read('UPPER')).toBeUndefined();
    expect(await credentials.read('routine_hook')).toBeUndefined();
  });
});
