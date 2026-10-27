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
  expect(result.ok && result.value).toEqual([
    'surround',
    'commentary',
    'replaceWithRegister',
    'exchange',
    'unimpaired',
    'indentObject',
    'entireBuffer',
    'sneak',
  ]);
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

it('leaves surround out when vimPlugins switches it off, and sneak out unless named true', () => {
  const result = setVimContributions(
    contributions,
    enabledVimPlugins(contributions, { surround: false }),
  );

  expect(result.ok && result.value).toEqual([
    'commentary',
    'replaceWithRegister',
    'exchange',
    'unimpaired',
    'indentObject',
    'entireBuffer',
  ]);
});

/** Types `keys` into an editor on `doc` with the plugins `switches` leaves on, and reads it back. */
const typed = (doc: string, keys: readonly string[], switches: Record<string, boolean>): string => {
  setVimContributions(contributions, enabledVimPlugins(contributions, switches));
  const parent = document.body.appendChild(document.createElement('div'));
  const editor = createEditor(parent, {
    doc,
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
    return editor.view.state.doc.toString();
  } finally {
    editor.destroy();
    parent.remove();
  }
};

const keysOf = (text: string): string[] => [...text];

/**
 * TYTO-419's plugins, through the keys the desktop ships and the defaults the setting resolves:
 * an empty `vimPlugins`, as a new `settings.json` has.
 */
it.each([
  ['replaceWithRegister: yiw, w, griw', 'hello world', keysOf('yiwwgriw'), 'hello hello'],
  ['replaceWithRegister: yiw, 2G, grr', 'one\ntwo', keysOf('yiw2Ggrr'), 'one\none'],
  ['exchange: cxiw, w, cxiw', 'hello world', keysOf('cxiwwcxiw'), 'world hello'],
  ['exchange: cxx, 2G, cxx', 'one\ntwo', keysOf('cxx2Gcxx'), 'two\none'],
  ['exchange: visual X twice', 'hello world', keysOf('viwXwviwX'), 'world hello'],
  ['unimpaired: ]<Space>', 'hello', [']', ' '], 'hello\n'],
  ['unimpaired: [<Space>', 'hello', ['[', ' '], '\nhello'],
  ['unimpaired: ]e', 'one\ntwo', keysOf(']e'), 'two\none'],
  ['unimpaired: 2G[e', 'one\ntwo', keysOf('2G[e'), 'two\none'],
  ['indentObject: 2G, dii', 'a\n  b\n  c\nd', keysOf('2Gdii'), 'a\nd'],
  ['indentObject: 2G, dai', 'a\n  b\n  c\nd', keysOf('2Gdai'), 'd'],
  ['entireBuffer: dae', 'one\ntwo', keysOf('dae'), ''],
  ['entireBuffer: die', '\none\ntwo\n', keysOf('die'), '\n'],
  ["sneak absent: s is vim's own", 'hello world', ['s', 'Escape'], 'ello world'],
])('the shipped %s', (_name, doc, keys, expected) => {
  expect(typed(doc, keys, {})).toBe(expected);
});

it('sneaks to the two characters typed after s only when vimPlugins names sneak true', () => {
  expect(typed('hello world', keysOf('swox'), { sneak: true })).toBe('hello orld');
  expect(typed('hello world', keysOf('$Shex'), { sneak: true })).toBe('ello world');
  expect(typed('ab ab ab', keysOf('sab;x'), { sneak: true })).toBe('ab ab b');
  expect(typed('ab ab ab', keysOf('sab;,x'), { sneak: true })).toBe('ab b ab');
});
