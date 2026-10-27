// @vitest-environment jsdom
import { createCommandRegistry, createEditor, setVimContributions } from '@tyto/editor';
import { afterEach, expect, it } from 'vitest';

import { BUILT_IN_VIM_PLUGINS } from '../../shared/vim-plugins.js';
import { enabledVimPlugins } from './vim-plugins.js';

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

/**
 * The editor's own tests map a copy of surround's keys; this one types through the keys the
 * desktop ships, so a mapping lost or moved here is red here and not only in the window.
 */
it.each([
  ['ysiw)', '(hello) world'],
  ['viwS"', '"hello" world'],
])('the shipped surround turns %j on "hello world" into %j', (keys, expected) => {
  setVimContributions(
    contributions,
    contributions.map(({ id }) => id),
  );
  const parent = document.body.appendChild(document.createElement('div'));
  const editor = createEditor(parent, {
    doc: 'hello world',
    commands: createCommandRegistry(),
    vim: true,
    vimStatus: false,
  });
  try {
    for (const key of keys) {
      editor.view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    }
    expect(editor.view.state.doc.toString()).toBe(expected);
  } finally {
    editor.destroy();
    parent.remove();
  }
});

it('leaves surround out when vimPlugins switches it off, and keeps commentary', () => {
  const result = setVimContributions(
    contributions,
    enabledVimPlugins(contributions, { surround: false }),
  );

  expect(result.ok && result.value).toEqual(['commentary']);
});
