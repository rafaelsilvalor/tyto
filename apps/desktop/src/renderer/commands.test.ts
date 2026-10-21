import {
  COMMAND_BAR_TOGGLE,
  EDITOR_REDO,
  EDITOR_SAVE,
  EDITOR_SPLIT_DOWN,
  EDITOR_SPLIT_RIGHT,
  EDITOR_UNDO,
  defaultKeymapSet,
  vimKeymapSet,
} from '@tyto/editor';
import { describe, expect, it, vi } from 'vitest';

import {
  DOCUMENTATION_COMMAND,
  FILE_MENU_COMMANDS,
  RELOAD_COMMAND,
  VIEW_MENU_COMMANDS,
  ZOOM_MENU_COMMANDS,
} from '../../shared/commands.js';
import {
  type DesktopActions,
  BRIEF_ONLY_COMMANDS,
  COMMAND_LABELS,
  DOCUMENT_NEW,
  DOCUMENT_NEW_FROM_TEMPLATE,
  DOCUMENT_SLOTS,
  FILE_EXPORT,
  EDITOR_INSERT_MENU,
  EDITOR_GO_TO_BLOCK,
  EDITOR_FORMAT_BRIEF,
  EDITOR_OPEN,
  EDITOR_SAVE_AS,
  EDITOR_TOGGLE_VIM,
  GROUP_CLOSE,
  GROUP_FOCUS_NEXT,
  GROUP_FOCUS_PREVIOUS,
  GROUP_MOVE_TAB_LEFT,
  GROUP_MOVE_TAB_NEXT,
  GROUP_MOVE_TAB_RIGHT,
  HELP_OPEN_DOCUMENTATION,
  PREVIEW_NEXT_FORMAT,
  PREVIEW_OPEN,
  PREVIEW_OPEN_TO_SIDE,
  PREVIEW_PREVIOUS_SLIDE,
  PREVIEW_TOGGLE_LOCK,
  PREVIEW_ZOOM_FIT,
  PREVIEW_ZOOM_IN,
  PREVIEW_ZOOM_OUT,
  TEMPLATES_CHOOSE_FOLDER,
  TEMPLATES_CLEAR_FOLDER,
  WORKSPACE_CLOSE_FOLDER,
  WORKSPACE_MANAGE_TRUST,
  WORKSPACE_OPEN_FOLDER,
  TEMPLATE_EDIT,
  TEMPLATE_NEW,
  SHELL_TOGGLE_LOCALE,
  TEXT_COMMANDS,
  WINDOW_ZOOM_IN,
  WINDOW_ZOOM_OUT,
  WINDOW_ZOOM_RESET,
  bindingsOf,
  builtInKeybindings,
  createDesktopRegistry,
  keymapSetFor,
  selectDocumentCommandId,
  withCommandGate,
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
    openInsertMenu: vi.fn<() => void>(),
    goToBlock: vi.fn<() => void>(),
    formatBrief: vi.fn<() => void>(),
    newDocument: vi.fn<() => void>(),
    newDocumentFromTemplate: vi.fn<() => void>(),
    openDocument: vi.fn<() => void>(),
    saveDocument: vi.fn<(saveAs: boolean) => void>(),
    restoreLayout: vi.fn<() => void>(),
    toggleDock: vi.fn<(dock: 'left' | 'right' | 'bottom') => void>(),
    closeDocument: vi.fn<() => void>(),
    stepDocument: vi.fn<(direction: 1 | -1) => void>(),
    splitGroup: vi.fn<(direction: 'row' | 'column') => void>(),
    focusGroup: vi.fn<(direction: 1 | -1) => void>(),
    moveTabToNextGroup: vi.fn<() => void>(),
    stepTabInGroup: vi.fn<(direction: 1 | -1) => void>(),
    closeGroup: vi.fn<() => void>(),
    openExport: vi.fn<() => void>(),
    showPlugins: vi.fn<() => void>(),
    showQueue: vi.fn<() => void>(),
    openSettings: vi.fn<() => void>(),
    openKeybindings: vi.fn<() => void>(),
    openSnippets: vi.fn<() => void>(),
    reloadWindow: vi.fn<() => void>(),
    pickTheme: vi.fn<() => void>(),
    chooseTemplateFolder: vi.fn<() => void>(),
    clearTemplateFolder: vi.fn<() => void>(),
    openWorkspaceFolder: vi.fn<() => void>(),
    closeWorkspaceFolder: vi.fn<() => void>(),
    manageTrust: vi.fn<() => void>(),
    editTemplate: vi.fn<() => void>(),
    newTemplate: vi.fn<() => void>(),
    openPreview: vi.fn<(side: boolean) => void>(),
    togglePreviewLock: vi.fn<() => void>(),
    zoomWindow: vi.fn<(step: 'in' | 'out' | 'reset') => void>(),
    openDocumentation: vi.fn<() => void>(),
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

describe('the gate on the registry (TYTO-283)', () => {
  it('runs nothing the predicate refuses, and answers false as for an unknown id', () => {
    const spies = actions();
    const registry = withCommandGate(createDesktopRegistry(spies), (id) => id !== FILE_EXPORT);

    expect(registry.run(FILE_EXPORT, NO_VIEW)).toBe(false);
    expect(spies.openExport).not.toHaveBeenCalled();
    expect(registry.run(PREVIEW_ZOOM_IN, NO_VIEW)).toBe(true);
    expect(spies.stepZoom).toHaveBeenCalledWith(1);
  });

  it('asks at every run, so the answer follows the tab in front', () => {
    const spies = actions();
    let brief = false;
    const registry = withCommandGate(createDesktopRegistry(spies), () => brief);

    registry.run(FILE_EXPORT, NO_VIEW);
    brief = true;
    registry.run(FILE_EXPORT, NO_VIEW);

    expect(spies.openExport).toHaveBeenCalledTimes(1);
  });

  it('still lists every command, so a keybinding to one is not reported unknown', () => {
    const registry = withCommandGate(createDesktopRegistry(actions()), () => false);
    const ids = registry.list().map((command) => command.id);

    for (const id of BRIEF_ONLY_COMMANDS) expect(ids).toContain(id);
  });

  it('names only commands the window registers', () => {
    const ids = createDesktopRegistry(actions())
      .list()
      .map((command) => command.id);

    for (const id of BRIEF_ONLY_COMMANDS) expect(ids).toContain(id);
  });
});

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
    // No built-in binding needs it any more (the next test), but a plugin's or the person's
    // binding can still name an id nothing registers, so the made-up one stands in for it.
    expect(createDesktopRegistry(actions()).run('nobody.registered.this', NO_VIEW)).toBe(false);
  });

  it('binds every built-in key to a command the window registers', () => {
    // TYTO-285: `Mod-Enter` was bound to `editor.render` from TYTO-38 until this card, and
    // nothing ever registered it, so the key did nothing and the keyboard reference had to
    // hide it. The ids beside the registry's are the ones `main.ts` registers on its own:
    // the bar's toggle and the nine tab slots. This mirrors `WINDOW_REGISTERED` in
    // `tools/docs-gen/src/reference/window-commands.ts`, which an app cannot import.
    const registered = new Set([
      ...createDesktopRegistry(actions())
        .list()
        .map((command) => command.id),
      COMMAND_BAR_TOGGLE,
      ...DOCUMENT_SLOTS.map(selectDocumentCommandId),
    ]);

    const unanswered = builtInKeybindings
      .filter((binding) => !registered.has(binding.command))
      .map((binding) => `${binding.key} → ${binding.command}`);

    expect(unanswered).toEqual([]);
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

  it('runs the two workspace folder commands, each to its own action (TYTO-278)', () => {
    const spies = actions();
    const registry = createDesktopRegistry(spies);

    expect(registry.run(WORKSPACE_OPEN_FOLDER, NO_VIEW)).toBe(true);
    expect(registry.run(WORKSPACE_CLOSE_FOLDER, NO_VIEW)).toBe(true);
    expect(spies.openWorkspaceFolder).toHaveBeenCalledOnce();
    expect(spies.closeWorkspaceFolder).toHaveBeenCalledOnce();
    expect(registry.run(WORKSPACE_MANAGE_TRUST, NO_VIEW)).toBe(true);
    expect(spies.manageTrust).toHaveBeenCalledOnce();
  });

  it('runs the two template mode commands, each to its own action (TYTO-44)', () => {
    const spies = actions();
    const registry = createDesktopRegistry(spies);

    expect(registry.run(TEMPLATE_EDIT, NO_VIEW)).toBe(true);
    expect(spies.editTemplate).toHaveBeenCalledOnce();
    expect(spies.newTemplate).not.toHaveBeenCalled();

    expect(registry.run(TEMPLATE_NEW, NO_VIEW)).toBe(true);
    expect(spies.newTemplate).toHaveBeenCalledOnce();
  });

  it('runs New brief from template on any tab, with no keystroke (TYTO-275)', () => {
    const spies = actions();
    // Refusing every brief-only command, as the gate does with an app file in front: this one
    // opens a tab of its own, so it is not among them.
    const registry = withCommandGate(
      createDesktopRegistry(spies),
      (id) => !BRIEF_ONLY_COMMANDS.has(id),
    );

    expect(registry.run(DOCUMENT_NEW_FROM_TEMPLATE, NO_VIEW)).toBe(true);
    expect(spies.newDocumentFromTemplate).toHaveBeenCalledOnce();
    expect(spies.newDocument).not.toHaveBeenCalled();
    expect(bindingsOf(keymapSetFor(false), 'linux')[DOCUMENT_NEW_FROM_TEMPLATE]).toBeUndefined();
  });

  it('runs the insert menu on a brief only, with no keystroke (TYTO-276)', () => {
    const spies = actions();
    let brief = true;
    const registry = withCommandGate(
      createDesktopRegistry(spies),
      (id) => brief || !BRIEF_ONLY_COMMANDS.has(id),
    );

    expect(registry.run(EDITOR_INSERT_MENU, NO_VIEW)).toBe(true);
    brief = false;
    expect(registry.run(EDITOR_INSERT_MENU, NO_VIEW)).toBe(false);
    expect(spies.openInsertMenu).toHaveBeenCalledOnce();
    // `Mod-/` is the comment toggle; the menu's key is whatever `keybindings.json` gives it.
    expect(bindingsOf(keymapSetFor(false), 'linux')[EDITOR_INSERT_MENU]).toBeUndefined();
    expect(bindingsOf(keymapSetFor(true), 'linux')[EDITOR_INSERT_MENU]).toBeUndefined();
  });

  it('offers Go to Block on a brief only, with text in front, on Mod-Shift-o in both modes (TYTO-296)', () => {
    const spies = actions();
    let brief = true;
    const registry = withCommandGate(
      createDesktopRegistry(spies),
      (id) => brief || !BRIEF_ONLY_COMMANDS.has(id),
    );
    expect(registry.run(EDITOR_GO_TO_BLOCK, NO_VIEW)).toBe(true);
    brief = false;
    expect(registry.run(EDITOR_GO_TO_BLOCK, NO_VIEW)).toBe(false);
    expect(spies.goToBlock).toHaveBeenCalledOnce();
    expect(TEXT_COMMANDS.has(EDITOR_GO_TO_BLOCK)).toBe(true);
    expect(COMMAND_LABELS[EDITOR_GO_TO_BLOCK]).toBe('command.editor.goToBlock');
    expect(bindingsOf(keymapSetFor(false), 'linux')[EDITOR_GO_TO_BLOCK]).toBe('Ctrl+Shift+o');
    expect(bindingsOf(keymapSetFor(true), 'linux')[EDITOR_GO_TO_BLOCK]).toBe('Ctrl+Shift+o');
    // The key is nobody else's in the built-in table.
    const others = builtInKeybindings.filter(
      (binding) => binding.key === 'Mod-Shift-o' && binding.command !== EDITOR_GO_TO_BLOCK,
    );
    expect(others).toEqual([]);
  });

  it('offers Format Brief on a brief only, with text in front, on Alt-Shift-f in both modes (TYTO-297)', () => {
    const spies = actions();
    let brief = true;
    const registry = withCommandGate(
      createDesktopRegistry(spies),
      (id) => brief || !BRIEF_ONLY_COMMANDS.has(id),
    );
    expect(registry.run(EDITOR_FORMAT_BRIEF, NO_VIEW)).toBe(true);
    brief = false;
    expect(registry.run(EDITOR_FORMAT_BRIEF, NO_VIEW)).toBe(false);
    expect(spies.formatBrief).toHaveBeenCalledOnce();
    expect(TEXT_COMMANDS.has(EDITOR_FORMAT_BRIEF)).toBe(true);
    expect(COMMAND_LABELS[EDITOR_FORMAT_BRIEF]).toBe('command.editor.formatBrief');
    expect(bindingsOf(keymapSetFor(false), 'linux')[EDITOR_FORMAT_BRIEF]).toBe('Alt+Shift+f');
    expect(bindingsOf(keymapSetFor(true), 'linux')[EDITOR_FORMAT_BRIEF]).toBe('Alt+Shift+f');
    // The key is nobody else's in the built-in table, in either spelling of its modifiers.
    const others = builtInKeybindings.filter(
      (binding) =>
        ['Alt-Shift-f', 'Shift-Alt-f', 'Alt-Shift-F'].includes(binding.key) &&
        binding.command !== EDITOR_FORMAT_BRIEF,
    );
    expect(others).toEqual([]);
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
    // The same bindings as the editor's vim set, now read off the table (TYTO-207), and the
    // window's keys for both modes, Go to Block (TYTO-296) and Format Brief (TYTO-297).
    expect(keymapSetFor(true).bindings).toEqual([
      ...vimKeymapSet.bindings,
      { key: 'Mod-Shift-o', command: EDITOR_GO_TO_BLOCK },
      { key: 'Alt-Shift-f', command: EDITOR_FORMAT_BRIEF },
    ]);
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
    expect(spies.showPlugins).toHaveBeenCalledTimes(1);
    expect(spies.showQueue).toHaveBeenCalledTimes(1);
    expect(spies.openSettings).toHaveBeenCalledTimes(1);
    expect(spies.openKeybindings).toHaveBeenCalledTimes(1);
    expect(spies.openSnippets).toHaveBeenCalledTimes(1);
    expect(spies.closeDocument).toHaveBeenCalledTimes(1);
    expect(spies.saveDocument.mock.calls).toEqual([[false], [true]]);
  });

  it('names, on View, a Reload this window registers under the same label (TYTO-113)', () => {
    const spies = actions();
    const registry = createDesktopRegistry(spies);
    expect(registry.get(RELOAD_COMMAND.id)).toBeDefined();
    expect(COMMAND_LABELS[RELOAD_COMMAND.id]).toBe(RELOAD_COMMAND.label);
    registry.run(RELOAD_COMMAND.id, NO_VIEW);
    expect(spies.reloadWindow).toHaveBeenCalledTimes(1);
  });

  it('names, on Help, the Documentation this window registers under the same label (TYTO-318)', () => {
    const spies = actions();
    const registry = createDesktopRegistry(spies);
    expect(DOCUMENTATION_COMMAND.id).toBe(HELP_OPEN_DOCUMENTATION);
    expect(COMMAND_LABELS[DOCUMENTATION_COMMAND.id]).toBe(DOCUMENTATION_COMMAND.label);
    expect(registry.run(DOCUMENTATION_COMMAND.id, NO_VIEW)).toBe(true);
    expect(spies.openDocumentation).toHaveBeenCalledTimes(1);
    // About the app, not a brief or its text: the bar offers it with any tab in front.
    expect(BRIEF_ONLY_COMMANDS.has(HELP_OPEN_DOCUMENTATION)).toBe(false);
    expect(TEXT_COMMANDS.has(HELP_OPEN_DOCUMENTATION)).toBe(false);
  });

  it('names, on View, the zoom this window registers, on keys nobody else has (TYTO-272)', () => {
    const spies = actions();
    const registry = createDesktopRegistry(spies);
    expect(ZOOM_MENU_COMMANDS.map((command) => command.id)).toEqual([
      WINDOW_ZOOM_RESET,
      WINDOW_ZOOM_IN,
      WINDOW_ZOOM_OUT,
    ]);
    for (const command of ZOOM_MENU_COMMANDS) {
      expect(COMMAND_LABELS[command.id]).toBe(command.label);
      expect(registry.run(command.id, NO_VIEW)).toBe(true);
    }
    expect(spies.zoomWindow.mock.calls).toEqual([['reset'], ['in'], ['out']]);
    // Not about a brief and not about text: it answers with any tab in front.
    for (const id of [WINDOW_ZOOM_IN, WINDOW_ZOOM_OUT, WINDOW_ZOOM_RESET]) {
      expect(BRIEF_ONLY_COMMANDS.has(id)).toBe(false);
      expect(TEXT_COMMANDS.has(id)).toBe(false);
    }
    // Global, as the bar's key is, so vim, a preview and the settings tab all hear it.
    const zoomKeys = builtInKeybindings.filter((binding) =>
      [WINDOW_ZOOM_IN, WINDOW_ZOOM_OUT, WINDOW_ZOOM_RESET].includes(binding.command),
    );
    expect(zoomKeys.map(({ key, command, when }) => [key, command, when])).toEqual([
      ['Mod-=', WINDOW_ZOOM_IN, undefined],
      ['Mod--', WINDOW_ZOOM_OUT, undefined],
      ['Mod-0', WINDOW_ZOOM_RESET, undefined],
    ]);
    // And the command bar spells Zoom out with its minus, not as a second plus.
    const zoomSet = {
      id: 'zoom',
      bindings: zoomKeys.map(({ key, command }) => ({ key, command })),
    };
    expect(bindingsOf(zoomSet, 'win32')).toEqual({
      [WINDOW_ZOOM_IN]: 'Ctrl+=',
      [WINDOW_ZOOM_OUT]: 'Ctrl+-',
      [WINDOW_ZOOM_RESET]: 'Ctrl+0',
    });
    // And the three keys are nobody else's in the built-in table, in either input mode's set.
    const taken = builtInKeybindings.filter(
      (binding) =>
        ['Mod-=', 'Mod--', 'Mod-0', 'Ctrl-=', 'Ctrl--', 'Ctrl-0'].includes(binding.key) &&
        !zoomKeys.includes(binding),
    );
    expect(taken).toEqual([]);
    for (const set of [keymapSetFor(false), keymapSetFor(true)]) {
      const keys = set.bindings.map((binding) => binding.key);
      expect(keys.filter((key) => ['Mod-=', 'Mod--', 'Mod-0'].includes(key))).toEqual([]);
    }
  });

  it('names, on View, the group commands under their labels, pinned to the constants (TYTO-286)', () => {
    const spies = actions();
    const registry = createDesktopRegistry(spies);
    expect(VIEW_MENU_COMMANDS.map((command) => command.id)).toEqual([
      EDITOR_SPLIT_RIGHT,
      EDITOR_SPLIT_DOWN,
      GROUP_FOCUS_NEXT,
      GROUP_FOCUS_PREVIOUS,
      GROUP_MOVE_TAB_NEXT,
      GROUP_MOVE_TAB_LEFT,
      GROUP_MOVE_TAB_RIGHT,
      GROUP_CLOSE,
      PREVIEW_OPEN_TO_SIDE,
      PREVIEW_OPEN,
      PREVIEW_TOGGLE_LOCK,
      EDITOR_GO_TO_BLOCK,
    ]);
    for (const command of VIEW_MENU_COMMANDS) {
      expect(COMMAND_LABELS[command.id]).toBe(command.label);
      registry.run(command.id, NO_VIEW);
    }
    expect(spies.splitGroup.mock.calls).toEqual([['row'], ['column']]);
    expect(spies.focusGroup.mock.calls).toEqual([[1], [-1]]);
    expect(spies.moveTabToNextGroup).toHaveBeenCalledTimes(1);
    // TYTO-288: left, then right, along the tab's own strip.
    expect(spies.stepTabInGroup.mock.calls).toEqual([[-1], [1]]);
    expect(spies.closeGroup).toHaveBeenCalledTimes(1);
    // TYTO-287: beside the brief, then in the focused group, then the lock.
    expect(spies.openPreview.mock.calls).toEqual([[true], [false]]);
    expect(spies.togglePreviewLock).toHaveBeenCalledTimes(1);
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
