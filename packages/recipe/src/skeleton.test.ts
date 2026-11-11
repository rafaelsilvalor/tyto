import { err } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import { recipeSkeleton } from './skeleton.js';

describe('recipeSkeleton', () => {
  it('parses with a description and a parameter with a default, and runs as made', async () => {
    const text = recipeSkeleton('open-tasks');
    if (!text.ok) throw new Error('refused');
    const parsed = parseRecipe(text.value);
    if (!parsed.ok) throw new Error(parsed.error.map((problem) => problem.message).join('\n'));
    expect(parsed.value.name).toBe('open-tasks');
    expect(parsed.value.description).not.toBe('');
    expect(parsed.value.params).toEqual([
      expect.objectContaining({ name: 'project', defaultValue: 'demo' }),
    ]);
    const run = await runRecipe(parsed.value, {
      verbs: createVerbRegistry(),
      derivations: createDerivationRegistry(),
      resolveRecipe: () => Promise.resolve(err([])),
    });
    expect(run.ok).toBe(true);
  });

  it.each(['', 'two words', '-dash', 'a/b'])('refuses the name %j', (name) => {
    const text = recipeSkeleton(name);
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.error[0]?.code).toBe('E_RECIPE_FORM');
  });
});
