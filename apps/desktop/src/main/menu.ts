import type { MenuItemConstructorOptions } from 'electron';

/** Every role Electron accepts on a menu item. */
type MenuRole = NonNullable<MenuItemConstructorOptions['role']>;

import {
  type MenuCommand,
  BRIEF_MENU_GROUPS,
  DOCUMENTATION_COMMAND,
  FILE_MENU_GROUPS,
  PREVIEW_MENU_GROUPS,
  RELOAD_COMMAND,
  TOOLS_MENU_GROUPS,
  VIEW_MENU_GROUPS,
  ZOOM_MENU_COMMANDS,
} from '../../shared/commands.js';
import type { CatalogueKey } from '../../shared/i18n/index.js';
import { withoutMnemonic } from './menu-model.js';

/**
 * The application menu. Since TYTO-514 (ADR 0166) it is where a person who has learnt no key
 * finds every verb worth a click — File, Edit, Brief, Preview, View, Tools, Window and Help, each
 * a table of `shared/commands.ts`. It began, and stays, a defence: **two of Electron's default
 * accelerators destroy work.**
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
 * **Reload is back since TYTO-113, and not as the role** (ADR 0080). The session now brings
 * every tab back, drafts included, so a reload costs nothing — provided the window writes the
 * session first, which the role does not wait for. So it is a command, like the File items,
 * and its key is the window's `Mod-r` rather than an accelerator here, which would take
 * `Ctrl-R` from vim's redo. Force Reload stays out.
 *
 * Roles and not labels, **where the label is Electron's to write**. A role's label is
 * Electron's own — and on Windows that is **fixed English**, not the system's language:
 * measured on a pt-BR machine, the row read "Arquivo, Edit, View, Window, Help" (TYTO-264).
 * TYTO-132 added the first label of this app's own, the Help submenu's one item; TYTO-124 added
 * the File submenu, which is this app's verbs and so this app's words. **Since TYTO-334 every role
 * item inside a list carries the catalogue's label too** (*Minimizar*, *Sair*), and every role
 * that would fill its own list — `editMenu`, macOS's `appMenu` — has it written out, because
 * Electron fills one in English. `menu.test.ts` walks the template on all three platforms for it.
 *
 * **The top-level titles are this app's off macOS** (TYTO-264, ADR 0078): each carries a
 * mnemonic — `&File`, `E&xibir` — so Alt and that letter open it, and a role's label has none.
 * The role stays, so what each list holds and does is unchanged. macOS keeps the roles' own
 * titles, and the four with no role — File, Brief, Preview, Tools — lose their `&` (ADR 0078
 * §2): a Mac has no mnemonics.
 *
 * **The items name commands rather than implement them.** `shared/commands.ts` is the
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
  /** Help > About (TYTO-248): shows {@link aboutText}, in a box or macOS's own panel. */
  readonly onAbout: () => void;
  /**
   * The items to grey, by command id: what the window said does nothing with the tab in front
   * (TYTO-283, `menu:disabled`; every menu since TYTO-514). Absent is none.
   */
  readonly disabled?: ReadonlySet<string>;
}

/** What Help > About says, which is what the footer said before it became a status bar. */
export interface AboutFacts {
  readonly version: string;
  readonly platform: string;
  readonly templates: number;
  /** The folder searched before the built-in pack, or nothing (TYTO-122). */
  readonly templatesFolder: string | null;
}

/**
 * The about panel's lines, one fact each and labelled from the catalogue (TYTO-248).
 *
 * A word rather than a blank for no folder, for the reason the footer gave: an empty value
 * beside a label reads as something that failed to load.
 */
export function aboutText(t: (key: CatalogueKey) => string, facts: AboutFacts): string {
  return [
    `${t('shell.about.version')}: ${facts.version}`,
    `${t('shell.about.platform')}: ${facts.platform}`,
    `${t('shell.about.templates')}: ${String(facts.templates)}`,
    `${t('templates.folder.label')}: ${facts.templatesFolder ?? t('templates.folder.none')}`,
  ].join('\n');
}

export function menuTemplate(platform: string, options: MenuOptions): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  // A top-level title off macOS, with its mnemonic; nothing on macOS, where the role's stays.
  const title = (key: CatalogueKey): { label?: string } => (mac ? {} : { label: options.t(key) });
  // A role inside a list, under this app's word for it: the role keeps what the item does and
  // its key, the label is the window's language rather than Electron's English (TYTO-334).
  const role = <R extends MenuRole>(name: R, key: CatalogueKey): { role: R; label: string } => ({
    role: name,
    label: options.t(key),
  });
  // A command of the renderer's registry as an item. The id is the command's, which is what
  // lets the end-to-end suite find an item without matching a translated label; the click is
  // `onCommand`, the same `registry.run` the command bar calls, so nothing here knows what any
  // id does (ADR 0166).
  const command = (entry: MenuCommand): MenuItemConstructorOptions => ({
    id: entry.id,
    label: options.t(entry.label),
    enabled: options.disabled?.has(entry.id) !== true,
    click: () => {
      options.onCommand(entry.id);
    },
  });
  // A table's groups, with a separator between each pair of them.
  const groups = (table: readonly (readonly MenuCommand[])[]): MenuItemConstructorOptions[] =>
    table.flatMap((group, index) => [
      ...(index === 0 ? [] : [{ type: 'separator' } as const]),
      ...group.map(command),
    ]);
  // One of this app's own top-level menus (TYTO-514): an id the drawn row asks for it by
  // (TYTO-244), since it has no role to be named by, and the title without its `&` on macOS.
  const own = (
    id: string,
    key: CatalogueKey,
    submenu: MenuItemConstructorOptions[],
  ): MenuItemConstructorOptions => ({
    id,
    label: mac ? withoutMnemonic(options.t(key)) : options.t(key),
    submenu,
  });

  return [
    // On macOS the app menu is where Quit lives and the first submenu is always the app's.
    // Its title stays the role's, which is the app's name (ADR 0078 §2); its list is written out,
    // because a role left to fill its own list fills it in Electron's English (TYTO-334).
    ...(mac
      ? [
          {
            role: 'appMenu' as const,
            submenu: [
              role('about', 'menu.about'),
              { type: 'separator' as const },
              role('services', 'menu.role.services'),
              { type: 'separator' as const },
              role('hide', 'menu.role.hide'),
              role('hideOthers', 'menu.role.hideOthers'),
              role('unhide', 'menu.role.unhide'),
              { type: 'separator' as const },
              role('quit', 'menu.role.quit'),
            ],
          },
        ]
      : []),
    // **The File menu, written out rather than `role: 'fileMenu'`** (TYTO-124). That role is
    // Quit alone on Windows and Linux, and on macOS it is *Close Window* on `Mod-W` — the one
    // accelerator this file exists to keep away from the page. So neither platform got a File
    // menu worth opening, and the app's own verbs were reachable only by a keystroke somebody
    // had to already know.
    //
    // Every item runs a command id out of `shared/commands.ts` through `onCommand`, which
    // reaches the renderer's registry — the same `registry.run` the command bar calls. Nothing
    // here knows what any of the ids do.
    // `own` gives it the id the drawn menu row asks for it by (TYTO-244); a top-level item with
    // a role is named by the role instead (`menu-model.ts`).
    own('file', 'menu.file', [
      ...groups(FILE_MENU_GROUPS),
      // **No accelerators anywhere in this menu bar, and that is the decision.** A menu
      // accelerator is handled by the browser process before the page sees the key, so one
      // written here would take that key away from `desktopKeymapSet` unconditionally —
      // including in vim mode, where the desktop bindings are deliberately not in force and
      // `Ctrl-O` belongs to the vim engine. The menu's job is to *teach the verbs*; the
      // keystrokes stay the page's, and `e2e/tabs.desktop.test.ts`'s accelerator table
      // staying green unchanged is the evidence nothing was taken.
      // Exit on Windows and Quit on Linux, the words Electron's own label used there.
      ...(mac
        ? []
        : [
            { type: 'separator' } as const,
            role('quit', platform === 'win32' ? 'menu.role.exit' : 'menu.role.quit'),
          ]),
    ]),
    // `editMenu` is what makes copy and paste work on macOS, where the clipboard shortcuts are
    // the menu's rather than the page's. Its list is written out item for item as Electron would
    // build it — minus macOS's Speech submenu — so each item is labelled in the window's language
    // (TYTO-334); the roles, and so what each item does and its key, are unchanged.
    {
      role: 'editMenu',
      ...title('menu.edit'),
      submenu: [
        role('undo', 'menu.role.undo'),
        role('redo', 'menu.role.redo'),
        { type: 'separator' },
        role('cut', 'menu.role.cut'),
        role('copy', 'menu.role.copy'),
        role('paste', 'menu.role.paste'),
        ...(mac ? [role('pasteAndMatchStyle', 'menu.role.pasteAndMatchStyle')] : []),
        role('delete', 'menu.role.delete'),
        ...(mac ? [] : [{ type: 'separator' } as const]),
        role('selectAll', 'menu.role.selectAll'),
      ],
    },
    // TYTO-514 (ADR 0166). Tyto's own work, named after it: the brief, what it looks like, and
    // further along the bar the tools. Each is a table of `shared/commands.ts`, greyed by what
    // the window says does nothing with the tab in front.
    own('brief', 'menu.brief', groups(BRIEF_MENU_GROUPS)),
    own('preview', 'menu.preview', groups(PREVIEW_MENU_GROUPS)),
    // Written out because the default carries Reload and Force Reload as roles, which tear the
    // page down before it can keep its tabs. Reload is the window's command instead (TYTO-113).
    // Everything else the role would have built is kept, item for item: the developer tools and
    // full screen are harmless, and dropping the submenu wholesale would take them along with
    // the two entries that are the problem. The three zoom items are the window's commands
    // since TYTO-272, so that each one writes `zoom`.
    {
      role: 'viewMenu',
      ...title('menu.view'),
      submenu: [
        // TYTO-286, TYTO-514: the groups, the bottom area's tabs, the vim mode.
        ...groups(VIEW_MENU_GROUPS),
        { type: 'separator' as const },
        command(RELOAD_COMMAND),
        role('toggleDevTools', 'menu.role.toggleDevTools'),
        { type: 'separator' },
        // TYTO-272 (ADR 0099). The window's commands and not the roles: each writes the `zoom`
        // setting, and the keys (`Mod-0`, `Mod-=`, `Mod--`) are the page's like every other.
        ...ZOOM_MENU_COMMANDS.map(command),
        { type: 'separator' },
        role('togglefullscreen', 'menu.role.togglefullscreen'),
      ],
    },
    own('tools', 'menu.tools', groups(TOOLS_MENU_GROUPS)),
    // The one other submenu written out: the default carries Close, and its accelerator is
    // the key a tab now answers to.
    {
      role: 'windowMenu',
      ...title('menu.window'),
      submenu: [
        role('minimize', 'menu.role.minimize'),
        role('zoom', 'menu.role.zoom'),
        ...(mac ? [role('front', 'menu.role.front')] : []),
      ],
    },
    // TYTO-132. `role: 'help'` rather than a plain top-level item, so the role keeps what it
    // means to the system; its title is this app's off macOS since TYTO-264, for the mnemonic.
    //
    // A menu item and not a path printed somewhere: the acceptance criterion is that a person
    // reaches the file **without being told a path**, and a tester who has to be talked
    // through `%APPDATA%` is a tester whose report never arrives.
    {
      role: 'help',
      ...title('menu.help'),
      submenu: [
        // TYTO-318. First, as the manual is in VS Code's and Blender's Help: it is what the
        // menu is for. It runs the registry's command, which asks main to open the manual.
        command(DOCUMENTATION_COMMAND),
        { type: 'separator' },
        { label: options.t('menu.revealLogs'), click: options.onRevealLogs },
        // A label and a click rather than `role: 'about'`, so the facts are read when it is
        // opened (the template folder can change while the app runs), and because the role's
        // panel on Windows shows the app's name and none of them (ADR 0076).
        { id: 'about', label: options.t('menu.about'), click: options.onAbout },
      ],
    },
  ];
}
