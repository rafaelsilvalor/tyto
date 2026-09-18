import type { MenuItemConstructorOptions } from 'electron';

import { FILE_MENU_GROUPS } from '../../shared/commands.js';
import type { CatalogueKey } from '../../shared/i18n/index.js';

/**
 * The application menu, which exists for one reason: **two of its default accelerators
 * destroy work.**
 *
 * Electron builds a default menu when an app installs none, and that menu carries
 * `CommandOrControl+W` on *Close Window* and `CommandOrControl+R` on *Reload* — measured,
 * by reading the accelerators back off a running app. A menu accelerator is handled by the
 * browser process before the page ever sees the key, so with the default menu in place
 * `Mod-W` would shut the window instead of closing the tab the person meant (E9.11), and
 * `Mod-R` would tear the renderer down and build it again — taking every `EditorState` in
 * the workspace with it, which is the text, the undo history, the cursor and the scroll of
 * **every** open tab, unsaved ones included, with nothing asked and nothing written first
 * (TYTO-104).
 *
 * That failure is invisible to the end-to-end suite. Playwright dispatches keys through the
 * debugger protocol, straight into the renderer, so a menu accelerator never fires there and
 * a suite pressing `Control+W` sees the tab close and passes. So what `e2e/tabs.desktop.test.ts`
 * asserts instead is this menu's own accelerator table, which is the thing that would be
 * wrong.
 *
 * **Both are removed rather than guarded, and reload is the one that had a choice.** Asking
 * first would mean main knowing whether any tab is dirty, and it does not: the workspace
 * lives in the renderer and every channel in `shared/ipc.ts` is a question the renderer
 * asks. `dialog:confirm` is one of those — the renderer calls it on its way to closing a
 * tab — so reusing it here would need a message travelling the other way, which this app
 * has none of. Removing the item cannot be got wrong by a race and costs a shortcut that
 * `electron-vite dev` already replaces with a reload of its own. Session restore, which
 * would make a reload harmless, is a feature and not this card.
 *
 * Roles and not labels, **where the label is the system's to write**. A role's label is
 * Electron's own, in the system's language, which is the right answer for *Minimize* and
 * *Quit*. TYTO-132 added the first exception, the Help submenu's one item; TYTO-124 added the
 * larger one, the File submenu, which is this app's verbs and so this app's words. The two
 * submenu titles Electron still owns are Help's and Edit's, because their roles keep them.
 *
 * **The File items name commands rather than implement them.** `shared/commands.ts` is the
 * table both processes read — the renderer registers those ids, this file draws them, and
 * `onCommand` carries the id back across. That is the acceptance criterion literally: a menu
 * item and a command-bar row are the same command, not two that agree today.
 *
 * `import type` and nothing else from `electron`, the same call `ipc.ts` makes: the template
 * is a value a test can read without a running Electron, and `index.ts` is where it is
 * handed to `Menu.buildFromTemplate`.
 */
export interface MenuOptions {
  /**
   * The catalogue, resolved to the window's language by the composition root.
   *
   * A function and not a `Locale`, so this file never imports the catalogue itself — which is
   * what keeps it a value a test can read with a fake translator and no i18n behind it.
   */
  readonly t: (key: CatalogueKey) => string;
  /** Opens the folder the log lives in. An Electron call, so it arrives as a function. */
  readonly onRevealLogs: () => void;
  /**
   * Runs a command out of the renderer's registry, by id (TYTO-124).
   *
   * A function for the same reason `onRevealLogs` is one: reaching the renderer means a
   * `WebContents`, and a template that named one could not be read by a test without a
   * running Electron. The composition root is where the id becomes a message.
   */
  readonly onCommand: (id: string) => void;
}

export function menuTemplate(platform: string, options: MenuOptions): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';

  return [
    // On macOS the app menu is where Quit lives and the first submenu is always the app's.
    ...(mac ? [{ role: 'appMenu' } as const] : []),
    // **The File menu, written out rather than `role: 'fileMenu'`** (TYTO-124). That role is
    // Quit alone on Windows and Linux, and on macOS it is *Close Window* on `Mod-W` — the one
    // accelerator this file exists to keep away from the page. So neither platform got a File
    // menu worth opening, and the app's own verbs were reachable only by a keystroke somebody
    // had to already know.
    //
    // Every item runs a command id out of `shared/commands.ts` through `onCommand`, which
    // reaches the renderer's registry — the same `registry.run` the command bar calls. Nothing
    // here knows what any of the ids do.
    {
      label: options.t('menu.file'),
      submenu: [
        ...FILE_MENU_GROUPS.flatMap((group, index) => [
          ...(index === 0 ? [] : [{ type: 'separator' } as const]),
          ...group.map((command) => ({
            // The id is the command's, which is what lets the end-to-end suite find an item
            // without matching a translated label.
            id: command.id,
            label: options.t(command.label),
            click: () => {
              options.onCommand(command.id);
            },
          })),
        ]),
        // **No accelerators anywhere in this submenu, and that is the decision.** A menu
        // accelerator is handled by the browser process before the page sees the key, so one
        // written here would take that key away from `desktopKeymapSet` unconditionally —
        // including in vim mode, where the desktop bindings are deliberately not in force and
        // `Ctrl-O` belongs to the vim engine. The menu's job in this card is to *teach the
        // verbs*; the keystrokes stay the page's, and `e2e/tabs.desktop.test.ts`'s accelerator
        // table staying green unchanged is the evidence nothing was taken.
        ...(mac ? [] : [{ type: 'separator' } as const, { role: 'quit' } as const]),
      ],
    },
    // Left as Electron built them. `editMenu` is what makes copy and paste work on macOS,
    // where the clipboard shortcuts are the menu's rather than the page's.
    { role: 'editMenu' },
    // Written out because the default carries Reload and Force Reload, and a reload
    // discards every open buffer. Everything else the role would have built is kept, item
    // for item: the developer tools, the three zoom levels and full screen are all
    // harmless, and dropping the submenu wholesale would take them along with the two
    // entries that are the problem.
    {
      role: 'viewMenu',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // The one other submenu written out: the default carries Close, and its accelerator is
    // the key a tab now answers to.
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(mac ? [{ role: 'front' } as const] : []),
      ],
    },
    // TYTO-132. `role: 'help'` rather than a labelled top-level item, so the submenu's title
    // stays Electron's in the system's language and only the item inside it is this app's.
    //
    // A menu item and not a path printed somewhere: the acceptance criterion is that a person
    // reaches the file **without being told a path**, and a tester who has to be talked
    // through `%APPDATA%` is a tester whose report never arrives.
    {
      role: 'help',
      submenu: [{ label: options.t('menu.revealLogs'), click: options.onRevealLogs }],
    },
  ];
}
