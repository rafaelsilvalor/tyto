import {
  type CommandRegistry,
  type EditorKeymap,
  type Keybinding,
  type KeybindingEntry,
  type KeybindingLayer,
  type KeybindingTable,
  COMMAND_BAR_KEY,
  COMMAND_BAR_TOGGLE,
  EDITOR_FIND,
  EDITOR_FIND_NEXT,
  EDITOR_FIND_PREVIOUS,
  EDITOR_GOTO_LINE,
  EDITOR_REDO,
  EDITOR_REPLACE_ALL,
  EDITOR_REPLACE_NEXT,
  EDITOR_SAVE,
  EDITOR_UNDO,
  bindingsOf,
  createCommandRegistry,
  defaultKeymapSet,
  keybindingsOf,
  keymapSetFor as keymapSetOfTable,
  vimKeymapSet,
} from '@tyto/editor';

import type { IpcResponse } from '../../shared/ipc.js';

import { type CatalogueKey } from '../../shared/i18n/index.js';

/**
 * What the window can be told to do, as ids (E9.12).
 *
 * `@tyto/editor` has shipped a command registry since E8.3, and its own comment says the
 * order of `list()` is the order a palette should show — and until this card nothing in
 * `apps/desktop/src` named `createCommandRegistry`. The registry was built and never wired.
 *
 * **The point of the ids is that a key and a palette entry name the same string.** A
 * binding, a vim ex-command and, later, a plugin all dispatch through `registry.run(id)`,
 * so `Mod-z` and "Desfazer" cannot drift into being two different undos.
 */

export const PREVIEW_ZOOM_IN = 'preview.zoomIn';
export const PREVIEW_ZOOM_OUT = 'preview.zoomOut';
export const PREVIEW_ZOOM_FIT = 'preview.zoomFit';
export const PREVIEW_NEXT_FORMAT = 'preview.nextFormat';
export const PREVIEW_PREVIOUS_FORMAT = 'preview.previousFormat';
export const PREVIEW_NEXT_SLIDE = 'preview.nextSlide';
export const PREVIEW_PREVIOUS_SLIDE = 'preview.previousSlide';
export const SHELL_TOGGLE_LOCALE = 'shell.toggleLocale';
export const LAYOUT_RESTORE = 'layout.restore';
/**
 * Showing and hiding one panel, as a command per panel (E9.10).
 *
 * Per panel and not one command taking an argument, because the bar runs an id and nothing
 * else — a person types "problemas" and the row they want is the one that says Problemas.
 * The same shape the recent list uses, and for the same reason.
 */
export const TOGGLE_PANEL_PREFIX = 'layout.togglePanel:';
export const togglePanelCommandId = (panelId: string): string => `${TOGGLE_PANEL_PREFIX}${panelId}`;
export const panelOfToggleCommand = (id: string): string | undefined =>
  id.startsWith(TOGGLE_PANEL_PREFIX) ? id.slice(TOGGLE_PANEL_PREFIX.length) : undefined;

export const EDITOR_OPEN = 'editor.open';
export const EDITOR_SAVE_AS = 'editor.saveAs';
/** E9.4. Opens the export dialog; the exporting itself is main's. */
export const FILE_EXPORT = 'file.export';
/** TYTO-47. Shows the plugins screen; installing one is the CLI's (`tyto plugin install`). */
export const PLUGINS_SHOW = 'plugins.show';
/** TYTO-45. Opens the local queue panel, or brings it forward when it is already open. */
export const QUEUE_SHOW = 'queue.show';
/** TYTO-206. Opens `settings.json` in a tab, or brings its tab forward. */
export const SETTINGS_OPEN = 'settings.open';
/**
 * TYTO-122. Points the app at a folder of templates, or goes back to the built-in pack.
 *
 * Two commands and not one toggle, because a toggle would have to say which state it is in
 * and the bar lists a verb. No keybinding either: this is a setting somebody changes once,
 * not a key anybody presses.
 */
export const TEMPLATES_CHOOSE_FOLDER = 'templates.chooseFolder';
export const TEMPLATES_CLEAR_FOLDER = 'templates.clearFolder';
/**
 * TYTO-44. The template mode: open a template folder to edit, or scaffold a new one.
 *
 * Two verbs for the File menu's reason — the bar lists what a person can do, and "edit" and
 * "make" are different things to want. `template.new` opens the mode on its name field rather
 * than asking in a box, because the mode is where the new template is going to be written.
 */
export const TEMPLATE_EDIT = 'template.edit';
export const TEMPLATE_NEW = 'template.new';
/**
 * A recent file, as a command per entry (E9.8).
 *
 * The path is in the id, which is what lets the bar list ten of them without a second kind
 * of row and without the registry learning what a file is. `@tyto/editor`'s convention is a
 * namespaced id and this keeps it; the part after the prefix is opaque to everything except
 * the handler that reopens it.
 */
export const RECENT_PREFIX = 'file.recent:';
export const recentCommandId = (path: string): string => `${RECENT_PREFIX}${path}`;
export const pathOfRecentCommand = (id: string): string | undefined =>
  id.startsWith(RECENT_PREFIX) ? id.slice(RECENT_PREFIX.length) : undefined;
export const EDITOR_TOGGLE_VIM = 'editor.toggleVim';

/**
 * A new, empty tab (TYTO-124).
 *
 * The only way to reach an empty buffer before this was to close the last tab, which the
 * window replaces with a fresh one — a side effect standing in for a verb. It registers next
 * to Open rather than beside the tab commands because that is where a person looks for it,
 * and registration order is display order.
 */
export const DOCUMENT_NEW = 'document.new';
export const DOCUMENT_CLOSE = 'document.close';
export const DOCUMENT_NEXT = 'document.next';
export const DOCUMENT_PREVIOUS = 'document.previous';

/**
 * Going to the nth tab, as a command per slot (E9.11).
 *
 * Nine ids and not one command taking a number, for the reason the panel toggles and the
 * recent list already give: the bar runs an id and nothing else, so a person typing a file
 * name has to find a row that says it. `main.ts` registers one of these per **open**
 * document and takes them down again, so the bar lists the tabs that exist rather than nine
 * rows of which seven do nothing — and the keystroke is attached to the slot rather than to
 * the document, because `Mod-2` means "the second tab" whatever is in it.
 */
export const DOCUMENT_SELECT_PREFIX = 'document.select:';
export const DOCUMENT_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const selectDocumentCommandId = (slot: number): string =>
  `${DOCUMENT_SELECT_PREFIX}${String(slot)}`;
export const slotOfSelectCommand = (id: string): number | undefined => {
  if (!id.startsWith(DOCUMENT_SELECT_PREFIX)) return undefined;
  const slot = Number.parseInt(id.slice(DOCUMENT_SELECT_PREFIX.length), 10);
  return Number.isNaN(slot) ? undefined : slot;
};

/**
 * The catalogue key each command is shown under.
 *
 * Not the `label` on the command itself, which is where a reader would look first. That
 * field is a plain string and `@tyto/editor` is a package with no locale — its two built-in
 * commands, `editor.undo` and `editor.redo`, carry English labels written where no
 * catalogue exists. Translating at the point of display keeps the registry the same object
 * in both languages, and a registry that had to be rebuilt to change language would be the
 * wrong shape for something plugins will register into.
 *
 * A command with no entry here falls back to its own `label`, and then to its id. That is
 * deliberate rather than defensive: a plugin's command will land in exactly that case, and
 * showing its id is better than hiding it.
 */
export const COMMAND_LABELS: Readonly<Record<string, CatalogueKey>> = {
  [EDITOR_UNDO]: 'command.undo',
  [EDITOR_REDO]: 'command.redo',
  [PREVIEW_ZOOM_IN]: 'command.preview.zoomIn',
  [PREVIEW_ZOOM_OUT]: 'command.preview.zoomOut',
  [PREVIEW_ZOOM_FIT]: 'command.preview.zoomFit',
  [PREVIEW_NEXT_FORMAT]: 'command.preview.nextFormat',
  [PREVIEW_PREVIOUS_FORMAT]: 'command.preview.previousFormat',
  [PREVIEW_NEXT_SLIDE]: 'command.preview.nextSlide',
  [PREVIEW_PREVIOUS_SLIDE]: 'command.preview.previousSlide',
  [SHELL_TOGGLE_LOCALE]: 'command.shell.toggleLocale',
  [EDITOR_TOGGLE_VIM]: 'command.editor.toggleVim',
  [DOCUMENT_NEW]: 'command.document.new',
  [EDITOR_OPEN]: 'command.file.open',
  [EDITOR_SAVE]: 'command.file.save',
  [EDITOR_SAVE_AS]: 'command.file.saveAs',
  [FILE_EXPORT]: 'command.file.export',
  [PLUGINS_SHOW]: 'command.plugins.show',
  [QUEUE_SHOW]: 'command.queue.show',
  [SETTINGS_OPEN]: 'command.settings.open',
  [TEMPLATES_CHOOSE_FOLDER]: 'command.templates.chooseFolder',
  [TEMPLATES_CLEAR_FOLDER]: 'command.templates.clearFolder',
  [TEMPLATE_EDIT]: 'command.template.edit',
  [TEMPLATE_NEW]: 'command.template.new',
  [LAYOUT_RESTORE]: 'command.layout.restore',
  [DOCUMENT_CLOSE]: 'command.document.close',
  [DOCUMENT_NEXT]: 'command.document.next',
  [DOCUMENT_PREVIOUS]: 'command.document.previous',
  // The six `@tyto/editor` brings with the search panel (E8.5). Their ids and their English
  // labels are the editor's, the same as undo and redo above; what this table adds is the
  // catalogue key, so the bar shows them in the window's language.
  [EDITOR_FIND]: 'command.editor.find',
  [EDITOR_FIND_NEXT]: 'command.editor.findNext',
  [EDITOR_FIND_PREVIOUS]: 'command.editor.findPrevious',
  [EDITOR_REPLACE_NEXT]: 'command.editor.replaceNext',
  [EDITOR_REPLACE_ALL]: 'command.editor.replaceAll',
  [EDITOR_GOTO_LINE]: 'command.editor.gotoLine',
};

/**
 * What `main.ts` has to be able to do for the commands below to mean anything.
 *
 * A port and not the module's own state: every one of these moves something `main.ts`
 * holds — the zoom, the selected format, the locale — and taking them as functions is what
 * lets a test drive the whole registry without a window, a bridge or an editor.
 */
export interface DesktopActions {
  stepZoom(direction: 1 | -1): void;
  zoomToFit(): void;
  /** Wraps at the ends: a tab strip with two formats should cycle rather than stop. */
  stepFormat(direction: 1 | -1): void;
  stepSlide(direction: 1 | -1): void;
  toggleLocale(): void;
  toggleVimMode(): void;
  /** E9.8. Each of these ends in a round trip to main, which owns every path. */
  newDocument(): void;
  openDocument(): void;
  saveDocument(saveAs: boolean): void;
  /** E9.10. Puts every panel back where ADR 0024 says it goes. */
  restoreLayout(): void;
  /** E9.11. Closing asks first when the tab has unsaved text, so it answers nothing here. */
  closeDocument(): void;
  stepDocument(direction: 1 | -1): void;
  /** E9.4. Shows the export dialog. Everything it then does is a round trip to main. */
  openExport(): void;
  /** TYTO-47. Shows the plugins screen; the list is a round trip to main. */
  showPlugins(): void;
  /**
   * TYTO-45. Opens the queue panel. Open and not toggle, unlike the panel's own
   * `layout.togglePanel:queue`: a menu item called "Show the local queue" that hid it the
   * second time would be a menu item that lies.
   */
  showQueue(): void;
  openSettings(): void;
  /**
   * TYTO-122. Points the app at a folder of templates, or clears the choice.
   *
   * Both end in a round trip to main the way `openDocument` does, and for the same reason:
   * the picker is an Electron dialog and the folder is read from a disk, and neither is the
   * window's.
   */
  chooseTemplateFolder(): void;
  clearTemplateFolder(): void;
  /** TYTO-44. Both open the template mode; what happens in it is a round trip to main. */
  editTemplate(): void;
  newTemplate(): void;
}

/**
 * The registry, with the window's own commands in it.
 *
 * **None of them declares an `undo`**, and the registry would accept one: the field exists
 * for a command that changes something the document does not hold, which is exactly what a
 * zoom is. It is left off on purpose. `Mod-z` is one stack shared with the text, so a
 * declared undo would put "I zoomed in" between two keystrokes a person is trying to take
 * back — and an undo that sometimes moves the picture instead of the words is worse than no
 * undo at all for these. Changing the zoom back is one keystroke either way.
 *
 * Registration order is display order (`@tyto/editor`), so this reads top to bottom the way
 * the bar shows it: undo and redo arrive first, from `createCommandRegistry` itself.
 */
export function createDesktopRegistry(actions: DesktopActions): CommandRegistry {
  const registry = createCommandRegistry();

  const add = (id: string, run: () => void): void => {
    registry.register({ id, run });
  };

  add(PREVIEW_ZOOM_IN, () => {
    actions.stepZoom(1);
  });
  add(PREVIEW_ZOOM_OUT, () => {
    actions.stepZoom(-1);
  });
  add(PREVIEW_ZOOM_FIT, () => {
    actions.zoomToFit();
  });
  add(PREVIEW_NEXT_FORMAT, () => {
    actions.stepFormat(1);
  });
  add(PREVIEW_PREVIOUS_FORMAT, () => {
    actions.stepFormat(-1);
  });
  add(PREVIEW_NEXT_SLIDE, () => {
    actions.stepSlide(1);
  });
  add(PREVIEW_PREVIOUS_SLIDE, () => {
    actions.stepSlide(-1);
  });
  add(SHELL_TOGGLE_LOCALE, () => {
    actions.toggleLocale();
  });
  add(EDITOR_TOGGLE_VIM, () => {
    actions.toggleVimMode();
  });

  // `editor.save` is `@tyto/editor`'s id and not one invented here, which is the whole
  // point: the editor has shipped `Mod-s` bound to that string since E8.3, and until a host
  // registered it the key did nothing. This is the host registering it.
  add(DOCUMENT_NEW, () => {
    actions.newDocument();
  });
  add(EDITOR_OPEN, () => {
    actions.openDocument();
  });
  add(EDITOR_SAVE, () => {
    actions.saveDocument(false);
  });
  add(EDITOR_SAVE_AS, () => {
    actions.saveDocument(true);
  });

  add(FILE_EXPORT, () => {
    actions.openExport();
  });
  add(PLUGINS_SHOW, () => {
    actions.showPlugins();
  });
  add(QUEUE_SHOW, () => {
    actions.showQueue();
  });
  add(SETTINGS_OPEN, () => {
    actions.openSettings();
  });

  // Registration order is display order, so these land next to Export rather than at the
  // bottom of a list of zoom levels.
  add(TEMPLATES_CHOOSE_FOLDER, () => {
    actions.chooseTemplateFolder();
  });

  add(TEMPLATES_CLEAR_FOLDER, () => {
    actions.clearTemplateFolder();
  });

  add(TEMPLATE_EDIT, () => {
    actions.editTemplate();
  });
  add(TEMPLATE_NEW, () => {
    actions.newTemplate();
  });

  // Reachable with every panel closed, which is the acceptance criterion and the reason it
  // is a command rather than a button on a panel: the state a person most needs this in is
  // the one where there is nothing left to click.
  add(LAYOUT_RESTORE, () => {
    actions.restoreLayout();
  });

  add(DOCUMENT_CLOSE, () => {
    actions.closeDocument();
  });
  add(DOCUMENT_NEXT, () => {
    actions.stepDocument(1);
  });
  add(DOCUMENT_PREVIOUS, () => {
    actions.stepDocument(-1);
  });

  return registry;
}

/** Moved to `@tyto/editor` with the table it reads (TYTO-207); re-exported for the window. */
export { bindingsOf };

/**
 * The default set plus the two keys only a desktop can mean.
 *
 * `Mod-s` is already in both of `@tyto/editor`'s sets — the editor ships the binding and
 * leaves the command to the host — so new, open and "save as" are the three this adds.
 * They go in a set rather than in a window listener because they are about the document and
 * the editor is what owns one; `Mod-K` is the opposite case and is a global binding, run by
 * the window's dispatcher for the opposite reason (`main.ts`).
 *
 * **`Mod-n` is here and not on the File menu item, which is the rule for all five verbs**
 * (TYTO-124). A menu accelerator is the browser process's and fires before the page, so it
 * would override this set unconditionally — vim mode included, where these bindings are
 * deliberately absent and `Ctrl-N` and `Ctrl-O` belong to the vim engine. `src/main/menu.ts`
 * carries the reasoning where somebody would go to add one.
 */
export const desktopKeymapSet: EditorKeymap = {
  id: 'desktop',
  bindings: [
    ...defaultKeymapSet.bindings,
    { key: 'Mod-n', command: DOCUMENT_NEW },
    { key: 'Mod-o', command: EDITOR_OPEN },
    { key: 'Mod-Shift-s', command: EDITOR_SAVE_AS },
    // The tabs (E9.11). `Mod-w` closes and the two page keys step, which is what Chrome,
    // Firefox and VS Code all bind on Windows and Linux; `Mod-1`…`Mod-9` go straight to a
    // slot. They are here rather than in a window listener of their own because the card
    // asks for one table: the bar reads its keystrokes off this set, so a binding invented
    // beside it would be a shortcut the palette does not know about.
    { key: 'Mod-w', command: DOCUMENT_CLOSE },
    { key: 'Mod-PageDown', command: DOCUMENT_NEXT },
    { key: 'Mod-PageUp', command: DOCUMENT_PREVIOUS },
    ...DOCUMENT_SLOTS.map((slot) => ({
      key: `Mod-${String(slot)}`,
      command: selectDocumentCommandId(slot),
    })),
  ],
};

/**
 * The built-in layer of the window's one keybinding table (TYTO-207, ADR 0074).
 *
 * The same three sets as before, now with the context each one was always in. `vimKeymapSet`
 * is `editor`, because save and render are bound in both input modes; the rest of the desktop
 * set is `mode.desktop`, because vim mode replaces it; and `Mod-K` is global, because the bar
 * opens wherever focus is. Plugins and, once the file exists, the person override this.
 */
export const builtInKeybindings: readonly Keybinding[] = [
  ...keybindingsOf(vimKeymapSet, 'editor'),
  ...keybindingsOf(desktopKeymapSet, 'mode.desktop').filter(
    (binding) =>
      !vimKeymapSet.bindings.some(
        (both) => both.key === binding.key && both.command === binding.command,
      ),
  ),
  { key: COMMAND_BAR_KEY, command: COMMAND_BAR_TOGGLE, source: 'built-in' },
];

export const builtInTable: KeybindingTable = { bindings: builtInKeybindings };

/**
 * The set that is interpreting the keys right now, which vim mode changes.
 *
 * **Vim gets the plain set and not the extended one, and that is not an oversight.**
 * `vimMode()` in `@tyto/editor` replaces the whole input layer and brings its set with it, so
 * `Mod-o` and `Mod-Shift-s` are simply not bound while vim is on. The bar reads its keystrokes
 * off whatever this returns, so returning the extended set here would make it promise two
 * shortcuts that do nothing — which is worse than showing none, because a person would stop
 * looking for the command.
 */
export const keymapSetFor = (vim: boolean, table: KeybindingTable = builtInTable): EditorKeymap =>
  keymapSetOfTable(table, vim);

/**
 * A plugin's `editor.keymap` as a layer of the table.
 *
 * `when` wins; `mode` stands in for it in the plugins written before it existed — `normal`
 * was always the desktop's input mode, and `vim` the engine's normal mode, where a key that
 * is not a character is free. Neither means global, as a missing `when` does in the file.
 */
export function pluginKeybindingLayer(
  keymap: IpcResponse<'plugins:keymaps'>['keymaps'][number],
): KeybindingLayer {
  const when =
    keymap.when ??
    (keymap.mode === 'vim' ? 'vim.normal' : keymap.mode === 'normal' ? 'mode.desktop' : undefined);
  const entries: KeybindingEntry[] = Object.entries(keymap.bindings).map(([key, command]) => ({
    key,
    command,
    ...(when === undefined ? {} : { when }),
  }));
  return { entries };
}
