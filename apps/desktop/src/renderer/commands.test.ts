import {
  EDITOR_REDO,
  EDITOR_SAVE,
  EDITOR_UNDO,
  defaultKeymapSet,
  vimKeymapSet,
} from '@tyto/editor';
import { describe, expect, it, vi } from 'vitest';

import {
  type DesktopActions,
  COMMAND_LABELS,
  EDITOR_TOGGLE_VIM,
  PREVIEW_NEXT_FORMAT,
  PREVIEW_PREVIOUS_SLIDE,
  PREVIEW_ZOOM_FIT,
  PREVIEW_ZOOM_IN,
  PREVIEW_ZOOM_OUT,
  SHELL_TOGGLE_LOCALE,
  bindingsOf,
  createDesktopRegistry,
  keymapSetFor,
} from './commands.js';
import { CATALOGUE_KEYS } from '../../shared/i18n/index.js';

/**
 * The desktop's half of the registry (E9.12).
 *
 * No DOM here on purpose: `DesktopActions` is a port, so the whole registry can be driven
 * with spies and the questions worth asking — does this id reach that action, is every
 * command showable, does vim change the bindings — are answered without a window.
 */

const actions = () =>
  ({
    stepZoom: vi.fn<(direction: 1 | -1) => void>(),
    zoomToFit: vi.fn<() => void>(),
    stepFormat: vi.fn<(direction: 1 | -1) => void>(),
    stepSlide: vi.fn<(direction: 1 | -1) => void>(),
    toggleLocale: vi.fn<() => void>(),
    toggleVimMode: vi.fn<() => void>(),
  }) satisfies DesktopActions;

/**
 * As much of a view as `registry.run` reads, which is more than nothing.
 *
 * It snapshots `view.state.doc` before every command so that it can enforce its own rule —
 * a command that edits the document must not also declare an undo. None of the desktop's
 * commands edits anything and none declares one, so the snapshot is never compared; it is
 * still taken, so a double without a `doc` throws before the command runs.
 */
const NO_VIEW = { view: { state: { doc: { eq: () => true } } } } as never;

describe('the ids the window registers', () => {
  it('reaches the action the id names, with the direction it means', () => {
    const spies = actions();
    const registry = createDesktopRegistry(spies);

    expect(registry.run(PREVIEW_ZOOM_IN, NO_VIEW)).toBe(true);
    expect(registry.run(PREVIEW_ZOOM_OUT, NO_VIEW)).toBe(true);
    expect(registry.run(PREVIEW_ZOOM_FIT, NO_VIEW)).toBe(true);
    expect(registry.run(PREVIEW_NEXT_FORMAT, NO_VIEW)).toBe(true);
    expect(registry.run(PREVIEW_PREVIOUS_SLIDE, NO_VIEW)).toBe(true);

    expect(spies.stepZoom.mock.calls).toEqual([[1], [-1]]);
    expect(spies.zoomToFit).toHaveBeenCalledOnce();
    expect(spies.stepFormat).toHaveBeenCalledWith(1);
    expect(spies.stepSlide).toHaveBeenCalledWith(-1);
  });

  it('answers false for an id nobody registered, rather than throwing', () => {
    // What a binding to an uninstalled command relies on: the keystroke keeps travelling.
    expect(createDesktopRegistry(actions()).run('editor.save', NO_VIEW)).toBe(false);
  });

  it('keeps undo and redo, which the registry brings itself', () => {
    const ids = createDesktopRegistry(actions())
      .list()
      .map((command) => command.id);

    expect(ids.slice(0, 2)).toEqual([EDITOR_UNDO, EDITOR_REDO]);
  });

  it('declares no undo for any of them, so the text history stays the only one', () => {
    // A zoom is a change outside the document and the registry would accept an undo for it.
    // Declaring one would put "I zoomed in" onto Mod-z, between two keystrokes somebody is
    // trying to take back. Asserted rather than commented, because the field is one word.
    const desktop = createDesktopRegistry(actions())
      .list()
      .filter((command) => command.id !== EDITOR_UNDO && command.id !== EDITOR_REDO);

    expect(desktop.length).toBeGreaterThan(0);
    expect(desktop.filter((command) => command.undo !== undefined)).toEqual([]);
  });
});

describe('every command can be shown', () => {
  it('has a catalogue key, and the key exists', () => {
    // The failure this prevents is a command that lists as `preview.zoomIn` in the bar
    // because somebody registered it and forgot the label.
    const ids = createDesktopRegistry(actions())
      .list()
      .map((command) => command.id);

    for (const id of ids) {
      const key = COMMAND_LABELS[id];
      expect(key, `no catalogue key for '${id}'`).toBeDefined();
      expect(CATALOGUE_KEYS).toContain(key);
    }
  });
});

describe('the keystroke shown beside a command', () => {
  it('reads Mod as Ctrl off the platform, not off a table of its own', () => {
    const bindings = bindingsOf(defaultKeymapSet, 'win32');

    expect(bindings[EDITOR_UNDO]).toBe('Ctrl+z');
    expect(bindings[EDITOR_SAVE]).toBe('Ctrl+s');
  });

  it('reads Mod as the command key on macOS, and honours a mac override', () => {
    const bindings = bindingsOf(defaultKeymapSet, 'darwin');

    expect(bindings[EDITOR_UNDO]).toBe('⌘z');
    // `Mod-y` everywhere, `Mod-Shift-z` on macOS: the set says so and this must follow it.
    expect(bindings[EDITOR_REDO]).toBe('⌘⇧z');
  });

  it('shows one key for a command bound to three', () => {
    // Redo has three bindings. A person looking for the shortcut wants one of them.
    expect(bindingsOf(defaultKeymapSet, 'win32')[EDITOR_REDO]).toBe('Ctrl+y');
  });

  it('has no undo binding in vim mode, because vim owns u', () => {
    // The bar must not promise Mod-z while the set that is running does not bind it.
    const bindings = bindingsOf(keymapSetFor(true), 'win32');

    expect(bindings[EDITOR_UNDO]).toBeUndefined();
    expect(bindings[EDITOR_SAVE]).toBe('Ctrl+s');
    expect(keymapSetFor(true)).toBe(vimKeymapSet);
    expect(keymapSetFor(false)).toBe(defaultKeymapSet);
  });

  it('leaves a command nobody bound without a key', () => {
    // The point of a palette: the locale switch has no shortcut and is reachable anyway.
    const bindings = bindingsOf(defaultKeymapSet, 'win32');

    expect(bindings[SHELL_TOGGLE_LOCALE]).toBeUndefined();
    expect(bindings[EDITOR_TOGGLE_VIM]).toBeUndefined();
  });
});
