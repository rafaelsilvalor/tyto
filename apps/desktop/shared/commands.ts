import type { CatalogueKey } from './i18n/index.js';

/**
 * A command the application menu offers, named by the id the renderer registered it under.
 *
 * Shared and not the renderer's, for one reason: the menu is built in main and the registry
 * lives in the renderer, and the acceptance criterion is that a menu item runs *the same
 * command the command bar runs* rather than a second implementation of it. Two tables would
 * satisfy that on the day they were written and stop satisfying it the first time somebody
 * renamed an id on one side.
 *
 * Main could not import `src/renderer/commands.ts` to get these even if layering allowed it:
 * that module imports `@tyto/editor`, which is CodeMirror, and pulling it into the browser
 * process would put an editor in the process that has no document.
 *
 * So the ids are written here as strings, and `src/renderer/commands.test.ts` asserts that
 * every one of them is a command the registry actually holds. The duplication that matters
 * is the one a test cannot see; this one fails the suite the moment it drifts.
 */
export interface MenuCommand {
  /** The registry id, e.g. `editor.save`. */
  readonly id: string;
  /** What the item reads, resolved against the window's language when the menu is built. */
  readonly label: CatalogueKey;
}

/**
 * The File menu, in groups, with a separator drawn between each pair of them.
 *
 * Groups rather than a flat list with separator markers in it, because a separator is not an
 * item — giving it an entry would mean every reader of this table having to skip a thing that
 * runs nothing. `src/main/menu.ts` is what turns the grouping into `{ type: 'separator' }`.
 *
 * Since TYTO-514 (ADR 0166) File holds what makes, opens, keeps and puts away a file or a
 * folder, and nothing else: export and the templates went to Brief, the screens about the app
 * to Tools. Quit is not here — it is Electron's own role and main appends it, because on macOS
 * it belongs to the application menu instead and this table does not know which platform it
 * is being read on.
 */
export const FILE_MENU_GROUPS: readonly (readonly MenuCommand[])[] = [
  [
    { id: 'document.new', label: 'command.document.new' },
    // TYTO-275. Beside New: the same verb, with a template's skeleton in the tab.
    { id: 'document.newFromTemplate', label: 'command.document.newFromTemplate' },
    // TYTO-489. Beside them: a new piece of work, its folder and its brief (ADR 0157).
    { id: 'delivery.new', label: 'command.delivery.new' },
    { id: 'editor.open', label: 'command.file.open' },
    // TYTO-278. Beside Open: a folder is opened the way a file is (ADR 0113).
    { id: 'workspace.openFolder', label: 'command.workspace.openFolder' },
    // TYTO-487. Beside Open Folder: the folders opened before, in the title bar's popover.
    { id: 'workspace.openRecent', label: 'command.workspace.openRecent' },
  ],
  [
    // `editor.save` is `@tyto/editor`'s own id, not this app's: the editor ships the binding
    // and leaves the command to the host. Written as a literal here and pinned to the
    // package's constant by `src/renderer/commands.test.ts`.
    { id: 'editor.save', label: 'command.file.save' },
    { id: 'editor.saveAs', label: 'command.file.saveAs' },
  ],
  [
    { id: 'document.close', label: 'command.document.close' },
    // TYTO-278. Beside Close, the other verb that puts something away.
    { id: 'workspace.closeFolder', label: 'command.workspace.closeFolder' },
  ],
];

/**
 * The Brief menu (TYTO-514, ADR 0166): what is done to the brief in front, then what takes it
 * out of Tyto, then the templates it is written against.
 */
export const BRIEF_MENU_GROUPS: readonly (readonly MenuCommand[])[] = [
  [
    { id: 'editor.formatBrief', label: 'command.editor.formatBrief' },
    // TYTO-276. The "/" menu, for a person who has not learnt the "/".
    { id: 'editor.insertMenu', label: 'command.editor.insertMenu' },
    { id: 'editor.goToBlock', label: 'command.editor.goToBlock' },
  ],
  [
    { id: 'file.export', label: 'command.file.export' },
    // TYTO-490. Greyed unless the brief in front belongs to a delivery.
    { id: 'delivery.export', label: 'command.delivery.export' },
  ],
  // TYTO-44. A template is what a brief is written against; its mode is the one place that
  // writes one.
  [
    { id: 'template.edit', label: 'command.template.edit' },
    { id: 'template.new', label: 'command.template.new' },
  ],
];

/**
 * The Preview menu (TYTO-514, ADR 0166): the preview as a tab (TYTO-287), then moving through
 * what it shows — slides, formats — then its zoom, which is the picture's and not the window's.
 */
export const PREVIEW_MENU_GROUPS: readonly (readonly MenuCommand[])[] = [
  [
    { id: 'preview.open', label: 'command.preview.open' },
    { id: 'preview.openToSide', label: 'command.preview.openToSide' },
    { id: 'preview.toggleLock', label: 'command.preview.toggleLock' },
  ],
  [
    { id: 'preview.nextSlide', label: 'command.preview.nextSlide' },
    { id: 'preview.previousSlide', label: 'command.preview.previousSlide' },
    // TYTO-323 (ADR 0123). The preview's two modes.
    { id: 'preview.showAllSlides', label: 'command.preview.showAllSlides' },
    { id: 'preview.showOneSlide', label: 'command.preview.showOneSlide' },
  ],
  [
    { id: 'preview.nextFormat', label: 'command.preview.nextFormat' },
    { id: 'preview.previousFormat', label: 'command.preview.previousFormat' },
  ],
  [
    { id: 'preview.zoomFit', label: 'command.preview.zoomFit' },
    { id: 'preview.zoomIn', label: 'command.preview.zoomIn' },
    { id: 'preview.zoomOut', label: 'command.preview.zoomOut' },
  ],
];

/**
 * The Tools menu (TYTO-514, ADR 0166): screens about the app rather than about a file — what
 * can be installed, what is running, a shell — then the person's own files and the folder's
 * trust.
 */
export const TOOLS_MENU_GROUPS: readonly (readonly MenuCommand[])[] = [
  [
    // TYTO-504, TYTO-47, TYTO-45. The queue opens, or comes forward when already open.
    { id: 'gallery.show', label: 'command.gallery.show' },
    { id: 'plugins.show', label: 'command.plugins.show' },
    { id: 'queue.show', label: 'command.queue.show' },
  ],
  // TYTO-497. Another shell, in front in the Terminal tab.
  [{ id: 'terminal.new', label: 'command.terminal.new' }],
  [
    // TYTO-206, TYTO-207, TYTO-277. The person's three files, each in a tab.
    { id: 'settings.open', label: 'command.settings.open' },
    { id: 'keybindings.open', label: 'command.keybindings.open' },
    { id: 'snippets.open', label: 'command.snippets.open' },
  ],
  // TYTO-278 (ADR 0111). The open folder's trust, in its own dialog.
  [{ id: 'workspace.manageTrust', label: 'command.workspace.manageTrust' }],
];

/**
 * View > Reload (TYTO-113, ADR 0080). A command and not Electron's `reload` role: the role
 * tears the page down before the window can write the session, and its accelerator would take
 * `Ctrl-R` from vim's redo. `Mod-r` is the window's binding instead.
 */
export const RELOAD_COMMAND: MenuCommand = { id: 'window.reload', label: 'command.window.reload' };

/**
 * View > Reset Zoom, Zoom In and Zoom Out (TYTO-272, ADR 0099). Commands and not Electron's
 * roles: a role's accelerator is the browser process's and fires before the page, and a role
 * changes the zoom without writing it down. The window binds `Mod-0`, `Mod-=` and `Mod--`, and
 * each one writes the `zoom` setting, so the zoom a person chose is in `settings.json`.
 */
export const ZOOM_MENU_COMMANDS: readonly MenuCommand[] = [
  { id: 'window.zoomReset', label: 'command.window.zoomReset' },
  { id: 'window.zoomIn', label: 'command.window.zoomIn' },
  { id: 'window.zoomOut', label: 'command.window.zoomOut' },
];

/**
 * The View menu's own groups, above Reload and the window zoom (TYTO-286, TYTO-514). The splits
 * are `@tyto/editor`'s ids, written as literals for the reason `editor.save` is, and every id
 * here is pinned to the renderer's constants by its tests.
 *
 * Then the bottom area's tabs, each brought to the front rather than toggled: a menu item that
 * hid its tab the second time would be a menu item that lies (`queue.show`'s reason). Commands
 * is `commandPanel.run`, which already opens its tab with the caret on the prompt.
 */
export const VIEW_MENU_GROUPS: readonly (readonly MenuCommand[])[] = [
  [
    { id: 'editor.splitRight', label: 'command.group.splitRight' },
    { id: 'editor.splitDown', label: 'command.group.splitDown' },
    { id: 'editor.focusNextGroup', label: 'command.group.focusNext' },
    { id: 'editor.focusPreviousGroup', label: 'command.group.focusPrevious' },
    { id: 'editor.moveTabToNextGroup', label: 'command.group.moveTabToNext' },
    // TYTO-288. Along the tab's own strip, as dragging it does.
    { id: 'editor.moveTabLeft', label: 'command.group.moveTabLeft' },
    { id: 'editor.moveTabRight', label: 'command.group.moveTabRight' },
    { id: 'editor.closeGroup', label: 'command.group.close' },
  ],
  [
    { id: 'problems.show', label: 'command.problems.show' },
    { id: 'commandPanel.run', label: 'command.commandPanel.run' },
    { id: 'terminal.show', label: 'command.terminal.show' },
  ],
  [{ id: 'editor.toggleVim', label: 'command.editor.toggleVim' }],
];

/**
 * Help > Documentation (TYTO-318). A command and not a click main handles alone, so the menu
 * item and the command bar's row are one command, as the File items are: the renderer's
 * registry runs it, and it asks main over `help:open-documentation`, which names no URL.
 */
export const DOCUMENTATION_COMMAND: MenuCommand = {
  id: 'help.openDocumentation',
  label: 'command.help.openDocumentation',
};

/** Every command the File menu offers, flat, for the tests that count them. */
export const FILE_MENU_COMMANDS: readonly MenuCommand[] = FILE_MENU_GROUPS.flat();

/**
 * Every command any menu offers, flat (TYTO-514): what the renderer greys (`menu:disabled`) and
 * what the tests hold to the registry, so no menu item is an id nothing answers.
 */
export const MENU_COMMANDS: readonly MenuCommand[] = [
  ...FILE_MENU_GROUPS.flat(),
  ...BRIEF_MENU_GROUPS.flat(),
  ...PREVIEW_MENU_GROUPS.flat(),
  ...VIEW_MENU_GROUPS.flat(),
  RELOAD_COMMAND,
  ...ZOOM_MENU_COMMANDS,
  ...TOOLS_MENU_GROUPS.flat(),
  DOCUMENTATION_COMMAND,
];
