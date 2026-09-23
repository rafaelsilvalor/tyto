import {
  EDITOR_REDO,
  EDITOR_SAVE,
  EDITOR_UNDO,
  defaultKeymapSet,
  vimKeymapSet,
} from '@tyto/editor';
import { describe, expect, it, vi } from 'vitest';

import { FILE_MENU_COMMANDS } from '../../shared/commands.js';
import {
  type DesktopActions,
  COMMAND_LABELS,
  DOCUMENT_NEW,
  EDITOR_OPEN,
  EDITOR_SAVE_AS,
  EDITOR_TOGGLE_VIM,
  PREVIEW_NEXT_FORMAT,
  PREVIEW_PREVIOUS_SLIDE,
  PREVIEW_ZOOM_FIT,
  PREVIEW_ZOOM_IN,
  PREVIEW_ZOOM_OUT,
  TEMPLATES_CHOOSE_FOLDER,
  TEMPLATES_CLEAR_FOLDER,
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
    newDocument: vi.fn<() => void>(),
    openDocument: vi.fn<() => void>(),
    saveDocument: vi.fn<(saveAs: boolean) => void>(),
    restoreLayout: vi.fn<() => void>(),
    closeDocument: vi.fn<() => void>(),
    stepDocument: vi.fn<(direction: 1 | -1) => void>(),
    openExport: vi.fn<() => void>(),
    chooseTemplateFolder: vi.fn<() => void>(),
    clearTemplateFolder: vi.fn<() => void>(),
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
    // `editor.render` is the remaining one — `@tyto/editor` binds `Mod-Enter` to it and no
    // host has registered it yet, which is exactly the case this behaviour exists for.
    expect(createDesktopRegistry(actions()).run('editor.render', NO_VIEW)).toBe(false);
  });

  it('registers the save id the editor has been binding all along', () => {
    // `Mod-s` has been in both of `@tyto/editor`'s keymap sets since E8.3 and did nothing,
    // because a binding to an unregistered id falls through. This is the host registering
    // it, and the id is the editor's string rather than one invented here.
    const spies = actions();
    const registry = createDesktopRegistry(spies);

    expect(registry.run(EDITOR_SAVE, NO_VIEW)).toBe(true);
    expect(registry.run(EDITOR_OPEN, NO_VIEW)).toBe(true);
    expect(registry.run(EDITOR_SAVE_AS, NO_VIEW)).toBe(true);
    expect(spies.saveDocument.mock.calls).toEqual([[false], [true]]);
    expect(spies.openDocument).toHaveBeenCalledOnce();
  });

  it('runs the template folder commands the bar lists, and nothing else', () => {
    const spies = actions();
    const registry = createDesktopRegistry(spies);

    expect(registry.run(TEMPLATES_CHOOSE_FOLDER, NO_VIEW)).toBe(true);
    expect(registry.run(TEMPLATES_CLEAR_FOLDER, NO_VIEW)).toBe(true);

    // Two commands and not one toggle, because a toggle would have to say which state it is
    // in and the bar lists a verb (TYTO-122).
    expect(spies.chooseTemplateFolder).toHaveBeenCalledOnce();
    expect(spies.clearTemplateFolder).toHaveBeenCalledOnce();
  });

  it('gives the template folder commands no keystroke', () => {
    // A setting somebody changes once, not a key anybody presses. A binding here would be one
    // more accelerator competing with the editor's for no one's benefit.
    const bindings = bindingsOf(defaultKeymapSet, 'linux');

    expect(bindings[TEMPLATES_CHOOSE_FOLDER]).toBeUndefined();
    expect(bindings[TEMPLATES_CLEAR_FOLDER]).toBeUndefined();
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
  });

  it('gives vim none of the desktop keys, because vim mode replaces the whole layer', () => {
    // `vimMode()` in `@tyto/editor` brings `vimKeymapSet` with it, so `Mod-o` is simply not
    // bound while vim is on. The bar reads its keystrokes off this, and promising a shortcut
    // that does nothing is worse than showing none — a person stops looking for the command.
    const vim = bindingsOf(keymapSetFor(true), 'win32');
    const normal = bindingsOf(keymapSetFor(false), 'win32');

    expect(normal[EDITOR_OPEN]).toBe('Ctrl+o');
    expect(normal[EDITOR_SAVE_AS]).toBe('Ctrl+Shift+s');
    expect(vim[EDITOR_OPEN]).toBeUndefined();
    expect(vim[EDITOR_SAVE_AS]).toBeUndefined();
  });

  it('keeps every binding the editor already shipped', () => {
    // The desktop set is the default set plus two, never a replacement for it: undo, redo
    // and save are `@tyto/editor`'s and must survive being extended.
    const desktop = keymapSetFor(false).bindings.map((binding) => binding.key);

    for (const binding of defaultKeymapSet.bindings) expect(desktop).toContain(binding.key);
  });

  it('leaves a command nobody bound without a key', () => {
    // The point of a palette: the locale switch has no shortcut and is reachable anyway.
    const bindings = bindingsOf(defaultKeymapSet, 'win32');

    expect(bindings[SHELL_TOGGLE_LOCALE]).toBeUndefined();
    expect(bindings[EDITOR_TOGGLE_VIM]).toBeUndefined();
  });
});

/**
 * The contract between the two processes' idea of what the File menu runs (TYTO-124).
 *
 * `shared/commands.ts` writes the ids as strings, because main cannot import this module —
 * it pulls in `@tyto/editor`, which is CodeMirror, and the browser process has no document to
 * put one in. Strings in one file and registrations in another is exactly the drift the
 * acceptance criterion forbids, so this is where the two are held together.
 */
describe('the File menu table', () => {
  it('names only commands this window actually registers', () => {
    const registry = createDesktopRegistry(actions());

    for (const command of FILE_MENU_COMMANDS) {
      // `get` and not `run`: a menu item that reached nothing would return `false` from `run`
      // and look like a command that declined, which is a different bug.
      expect(registry.get(command.id), command.id).toBeDefined();
    }
  });

  it('runs the same action the command bar runs, for each of them', () => {
    const spies = actions();
    const registry = createDesktopRegistry(spies);

    for (const command of FILE_MENU_COMMANDS) registry.run(command.id, NO_VIEW);

    // One call each, through the port — which is the whole claim: the menu is not a second
    // implementation, it is the same five commands reached by a different door.
    expect(spies.newDocument).toHaveBeenCalledTimes(1);
    expect(spies.openDocument).toHaveBeenCalledTimes(1);
    expect(spies.openExport).toHaveBeenCalledTimes(1);
    expect(spies.closeDocument).toHaveBeenCalledTimes(1);
    expect(spies.saveDocument.mock.calls).toEqual([[false], [true]]);
  });

  it('pins `editor.save` to the id `@tyto/editor` ships', () => {
    // The one id in the table this app did not invent. Written as a literal over there, so
    // this is what would fail if the package ever renamed it.
    expect(FILE_MENU_COMMANDS.map((command) => command.id)).toContain(EDITOR_SAVE);
  });

  it('shows every one of them under a catalogue key', () => {
    for (const command of FILE_MENU_COMMANDS) {
      // The menu resolves `command.label` itself, in main; the bar resolves `COMMAND_LABELS`.
      // Both have to be the same word, or the same verb reads two ways in one app.
      expect(COMMAND_LABELS[command.id], command.id).toBe(command.label);
    }
  });
});

describe('the New command', () => {
  it('is bound to `Mod-n` in the desktop set and to nothing in vim', () => {
    // Vim gets the plain set on purpose (`commands.ts`), and `Ctrl-N` is the vim engine's in
    // insert mode. This is also why the menu item carries no accelerator: one there would
    // fire in vim too, because a menu accelerator is the browser process's.
    expect(bindingsOf(keymapSetFor(false), 'linux')[DOCUMENT_NEW]).toBe('Ctrl+n');
    expect(bindingsOf(keymapSetFor(true), 'linux')[DOCUMENT_NEW]).toBeUndefined();
  });
});
