import { describe, expect, it } from 'vitest';

import {
  type Keybinding,
  type KeybindingEntry,
  type KeybindingInput,
  COMMAND_BAR_KEY,
  COMMAND_BAR_TOGGLE,
  bindingsOf,
  concreteKey,
  keyOfStroke,
  keymapSetFor,
  parseKey,
  resolveKeybindings,
  shownBindingsOf,
  windowBindingsOf,
} from './keybindings.js';

/**
 * The one table (TYTO-207, ADR 0074), resolved with synthetic layers. The keybindings file is
 * PR B's; everything it will do to the table is decided here and can be asked without it.
 */

const BUILT_IN: readonly Keybinding[] = [
  { key: 'Mod-s', command: 'editor.save', when: 'editor', source: 'built-in' },
  { key: 'Mod-z', command: 'editor.undo', when: 'mode.desktop', source: 'built-in' },
  {
    key: 'Mod-y',
    mac: 'Mod-Shift-z',
    command: 'editor.redo',
    when: 'mode.desktop',
    source: 'built-in',
  },
  { key: COMMAND_BAR_KEY, command: COMMAND_BAR_TOGGLE, source: 'built-in' },
];

const COMMANDS = new Set(['editor.save', 'editor.undo', 'editor.redo', 'preview.zoomIn']);

const resolve = (
  user: readonly KeybindingEntry[],
  plugins: KeybindingInput['plugins'] = [],
  platform = 'win32',
) => resolveKeybindings({ builtIn: BUILT_IN, plugins, user, commands: COMMANDS, platform });

const codes = (user: readonly KeybindingEntry[]) => resolve(user).diagnostics.map((d) => d.code);
const at = { start: 10, end: 30 };

describe('parseKey', () => {
  it('turns the file spelling into CodeMirror notation, in one modifier order', () => {
    expect(parseKey('shift+mod+s')).toEqual({ ok: true, key: 'Mod-Shift-s', modified: true });
    expect(parseKey('alt+ctrl+pagedown')).toEqual({
      ok: true,
      key: 'Ctrl-Alt-PageDown',
      modified: true,
    });
    expect(parseKey('cmd+k')).toEqual(parseKey('meta+k'));
    expect(parseKey('f5')).toEqual({ ok: true, key: 'F5', modified: false });
    expect(parseKey('ctrl+-')).toEqual({ ok: true, key: 'Ctrl--', modified: true });
  });

  it('refuses a sequence, an uppercase key, an unknown name and a doubled modifier', () => {
    expect(parseKey('ctrl+k ctrl+c').ok).toBe(false);
    expect(parseKey('Ctrl+K').ok).toBe(false);
    expect(parseKey('ctrl+banana').ok).toBe(false);
    expect(parseKey('hyper+k').ok).toBe(false);
    expect(parseKey('ctrl+ctrl+k').ok).toBe(false);
  });
});

describe('concrete keys', () => {
  it('spells Mod out per platform, so ctrl+k is the bar key on Windows and not on macOS', () => {
    expect(concreteKey({ key: 'Mod-k' }, 'win32')).toBe(concreteKey({ key: 'Ctrl-k' }, 'win32'));
    expect(concreteKey({ key: 'Mod-k' }, 'darwin')).toBe('Meta-k');
    expect(concreteKey({ key: 'Mod-y', mac: 'Mod-Shift-z' }, 'darwin')).toBe('Meta-Shift-z');
  });

  it('reads a keystroke in the same notation', () => {
    const stroke = { key: 'K', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true };
    expect(keyOfStroke(stroke)).toBe('Ctrl-Shift-k');
    expect(keyOfStroke({ ...stroke, key: 'k', shiftKey: false })).toBe(
      concreteKey({ key: COMMAND_BAR_KEY }, 'linux'),
    );
  });
});

describe('resolveKeybindings', () => {
  it('answers the built-in table unchanged when no layer is above it', () => {
    const resolved = resolve([]);
    expect(resolved.table.bindings).toEqual(BUILT_IN);
    expect(resolved.diagnostics).toEqual([]);
  });

  it('lets a plugin override the built-in key, and the person override the plugin', () => {
    const plugin = { entries: [{ key: 'mod+s', command: 'preview.zoomIn', when: 'editor' }] };
    const viaPlugin = shownBindingsOf(resolve([], [plugin]).table, false, 'win32');
    expect(viaPlugin['preview.zoomIn']).toBe('Ctrl+s');
    // The overridden one is gone, so the bar never shows a key that runs something else.
    expect(viaPlugin['editor.save']).toBeUndefined();

    const viaUser = resolve([{ key: 'mod+s', command: 'editor.save', when: 'editor' }], [plugin]);
    expect(shownBindingsOf(viaUser.table, false, 'win32')['editor.save']).toBe('Ctrl+s');
    expect(viaUser.table.bindings[0]).toMatchObject({ command: 'editor.save', source: 'user' });
  });

  it('removes a default with -command, and leaves its other keys alone', () => {
    const resolved = resolve([{ key: 'mod+z', command: '-editor.undo' }]);
    expect(resolved.table.bindings.map((binding) => binding.command)).not.toContain('editor.undo');
    expect(resolved.diagnostics).toEqual([]);
  });

  it('adds a second key to a command without touching the first', () => {
    const resolved = resolve([{ key: 'f5', command: 'editor.save', when: 'mode.desktop' }]);
    const save = resolved.table.bindings.filter((binding) => binding.command === 'editor.save');
    expect(save.map((binding) => binding.key)).toEqual(['F5', 'Mod-s']);
  });

  it('refuses to unbind the command bar, or to give its key to another command', () => {
    const unbound = resolve([{ key: 'mod+k', command: `-${COMMAND_BAR_TOGGLE}`, range: at }]);
    expect(unbound.diagnostics).toMatchObject([{ code: 'W_KEYBINDING_LOCKED', range: at }]);
    expect(windowBindingsOf(unbound.table)).toHaveLength(1);

    // `ctrl+k` is `mod+k` on Windows, so the second spelling is refused as well.
    expect(codes([{ key: 'ctrl+k', command: 'editor.save' }])).toEqual(['W_KEYBINDING_LOCKED']);
    // A second key for the bar is fine: the lock is about the way out, not about the key.
    expect(codes([{ key: 'ctrl+shift+p', command: COMMAND_BAR_TOGGLE }])).toEqual([]);
  });

  it('names an unknown command, an invalid key and an unknown context at the entry', () => {
    const resolved = resolve([
      { key: 'mod+j', command: 'nothing.here', range: at },
      { key: 'mod+k mod+c', command: 'editor.save', range: at },
      { key: 'mod+j', command: 'editor.save', when: 'vim.visual', range: at },
    ]);
    expect(resolved.diagnostics.map((d) => [d.code, d.range])).toEqual([
      ['W_KEYBINDING_UNKNOWN_COMMAND', at],
      ['W_KEYBINDING_INVALID_KEY', at],
      ['W_KEYBINDING_UNKNOWN_CONTEXT', at],
    ]);
    expect(resolved.table.bindings).toEqual(BUILT_IN);
  });

  it('accepts a key with no modifier only where the person said vim', () => {
    expect(codes([{ key: 'j', command: 'preview.zoomIn' }])).toEqual(['W_KEYBINDING_INVALID_KEY']);
    expect(codes([{ key: 'j', command: 'preview.zoomIn', when: 'mode.desktop' }])).toEqual([
      'W_KEYBINDING_INVALID_KEY',
    ]);
    expect(codes([{ key: 'j', command: 'preview.zoomIn', when: 'vim.normal' }])).toEqual([]);
  });

  it('keeps the first of two entries for the same key and context in one source', () => {
    const resolved = resolve([
      { key: 'alt+j', command: 'preview.zoomIn' },
      { key: 'alt+j', command: 'editor.save', range: at },
    ]);
    expect(resolved.diagnostics).toMatchObject([{ code: 'W_KEYBINDING_DUPLICATE', range: at }]);
    expect(resolved.table.bindings[0]).toMatchObject({ key: 'Alt-j', command: 'preview.zoomIn' });
  });
});

describe('reading the table', () => {
  it('gives each input mode its half, and the window the rest', () => {
    const { table } = resolve([{ key: 'alt+j', command: 'preview.zoomIn', when: 'vim.normal' }]);

    expect(keymapSetFor(table, false).bindings.map((binding) => binding.key)).toEqual([
      'Mod-s',
      'Mod-z',
      'Mod-y',
    ]);
    expect(keymapSetFor(table, true).bindings).toEqual([
      { key: 'Alt-j', command: 'preview.zoomIn', when: 'vim.normal' },
      { key: 'Mod-s', command: 'editor.save' },
    ]);
    expect(windowBindingsOf(table).map((binding) => binding.command)).toEqual([COMMAND_BAR_TOGGLE]);
  });

  it('shows a key the way the platform spells it', () => {
    expect(
      bindingsOf({ id: 'x', bindings: [{ key: 'Ctrl-Meta-k', command: 'a' }] }, 'darwin'),
    ).toEqual({ a: 'Ctrl⌘k' });
    expect(shownBindingsOf(resolve([]).table, false, 'darwin')['editor.redo']).toBe('⌘⇧z');
  });
});
