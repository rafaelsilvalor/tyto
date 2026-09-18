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
    { id: 'editor.open', label: 'command.file.open' },
  ],
  [
    // `editor.save` is `@tyto/editor`'s own id, not this app's: the editor ships the binding
    // and leaves the command to the host. Written as a literal here and pinned to the
    // package's constant by `src/renderer/commands.test.ts`.
    { id: 'editor.save', label: 'command.file.save' },
    { id: 'editor.saveAs', label: 'command.file.saveAs' },
  ],
  [{ id: 'file.export', label: 'command.file.export' }],
  [{ id: 'document.close', label: 'command.document.close' }],
];

/** Every command the File menu offers, flat, for the tests that count them. */
export const FILE_MENU_COMMANDS: readonly MenuCommand[] = FILE_MENU_GROUPS.flat();
