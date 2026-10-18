import { completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { foldKeymap } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { searchKeymap } from '@codemirror/search';
import { describe, expect, it } from 'vitest';

import { defaultKeymapSet, vimKeymapSet } from './keymap.js';

/**
 * The desktop zooms its window on `Mod-=`, `Mod--` and `Mod-0` (TYTO-272, ADR 0099), as a global
 * binding run by the window's dispatcher. A key CodeMirror ran first would be the editor's, so
 * this holds the three free in every keymap this package installs, CodeMirror's own included.
 * Vim's engine binds no Ctrl key outside letters, `[`, Space, Escape and Backspace.
 */

const ZOOM_KEYS = ['Mod-=', 'Mod--', 'Mod-0', 'Ctrl-=', 'Ctrl--', 'Ctrl-0'];

describe('the zoom keys', () => {
  it("are free in CodeMirror's keymaps", () => {
    const keymaps = [
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ];
    const taken = keymaps.flatMap((binding) =>
      [binding.key, binding.win, binding.linux, binding.mac].filter(
        (key): key is string => key !== undefined && ZOOM_KEYS.includes(key),
      ),
    );
    expect(taken).toEqual([]);
  });

  it("are free in the editor's two sets", () => {
    const keys = [...defaultKeymapSet.bindings, ...vimKeymapSet.bindings].map(
      (binding) => binding.key,
    );
    expect(keys.filter((key) => ZOOM_KEYS.includes(key))).toEqual([]);
  });
});
