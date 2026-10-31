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
 * The order is the order a person meets the verbs: make one, open one; write it down; take it
 * out of Tyto; put it away. Quit is not here — it is Electron's own role and main appends it,
 * because on macOS it belongs to the application menu instead and this table does not know
 * which platform it is being read on.
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
  [{ id: 'file.export', label: 'command.file.export' }],
  // TYTO-44. Beside Export rather than under Open: a template is not a document this window
  // tabs, and the mode it opens is the one place in the app that writes one.
  [
    { id: 'template.new', label: 'command.template.new' },
    { id: 'template.edit', label: 'command.template.edit' },
  ],
  // TYTO-47. Its own group, above Close: a screen about the app rather than a verb on a file.
  [
    { id: 'plugins.show', label: 'command.plugins.show' },
    // TYTO-504. Beside the plugins screen: the list they can be installed from.
    { id: 'gallery.show', label: 'command.gallery.show' },
    // TYTO-45. Beside the plugins screen: both are about the app rather than about a file.
    // It opens the panel, or brings it forward when it is already open.
    { id: 'queue.show', label: 'command.queue.show' },
    // TYTO-206. `settings.json` in a tab, as VS Code and Zed open theirs.
    { id: 'settings.open', label: 'command.settings.open' },
    // TYTO-207. `keybindings.json` beside it, with no accelerator (TYTO-124).
    { id: 'keybindings.open', label: 'command.keybindings.open' },
    // TYTO-277. `snippets.json` after it, the third of the person's files.
    { id: 'snippets.open', label: 'command.snippets.open' },
  ],
  [
    { id: 'document.close', label: 'command.document.close' },
    // TYTO-278. Beside Close, the other verb that puts something away.
    { id: 'workspace.closeFolder', label: 'command.workspace.closeFolder' },
  ],
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
 * The editor groups' commands, at the top of the View menu (TYTO-286). The splits are
 * `@tyto/editor`'s ids, written as literals for the reason `editor.save` is, and every id here
 * is pinned to the renderer's constants by its tests.
 */
export const VIEW_MENU_COMMANDS: readonly MenuCommand[] = [
  { id: 'editor.splitRight', label: 'command.group.splitRight' },
  { id: 'editor.splitDown', label: 'command.group.splitDown' },
  { id: 'editor.focusNextGroup', label: 'command.group.focusNext' },
  { id: 'editor.focusPreviousGroup', label: 'command.group.focusPrevious' },
  { id: 'editor.moveTabToNextGroup', label: 'command.group.moveTabToNext' },
  // TYTO-288. Along the tab's own strip, as dragging it does.
  { id: 'editor.moveTabLeft', label: 'command.group.moveTabLeft' },
  { id: 'editor.moveTabRight', label: 'command.group.moveTabRight' },
  { id: 'editor.closeGroup', label: 'command.group.close' },
  // TYTO-287. The preview as a tab, after the groups it opens into.
  { id: 'preview.openToSide', label: 'command.preview.openToSide' },
  { id: 'preview.open', label: 'command.preview.open' },
  { id: 'preview.toggleLock', label: 'command.preview.toggleLock' },
  // TYTO-296. Moving inside the brief in front; greyed with an app file or a preview in front.
  { id: 'editor.goToBlock', label: 'command.editor.goToBlock' },
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
