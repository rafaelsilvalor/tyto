// @vitest-environment jsdom
import { setVimContributions } from '@tyto/editor';
import { afterEach, expect, it } from 'vitest';

import { BUILT_IN_VIM_PLUGINS } from '../../shared/vim-plugins.js';

const contributions = BUILT_IN_VIM_PLUGINS.map(({ contribution }) => contribution);

// The engine's keymap is global: switching every one off unmaps what the test mapped.
afterEach(() => {
  setVimContributions(contributions, []);
});

/**
 * `shared/vim-plugins.ts` names the editor's operations again, because `shared/` may not import
 * a DOM package. A name the editor does not have, or a key in a context it refuses, would be an
 * `E_VIM_CONTRIBUTION` in the window's log and a plugin that silently does nothing.
 */
it('applies every built-in vim plugin in the real editor with nothing refused', () => {
  const result = setVimContributions(
    contributions,
    contributions.map(({ id }) => id),
  );

  expect(result.ok && result.diagnostics).toEqual([]);
  expect(result.ok && result.value).toEqual(['surround', 'commentary']);
});
