import type { MenuItemConstructorOptions } from 'electron';

/**
 * The application menu, which exists here for one reason: **`Mod-W` belongs to a tab**.
 *
 * Electron builds a default menu when an app installs none, and that menu carries
 * `CommandOrControl+W` on *Close Window* — measured, by reading the accelerators back off a
 * running app. A menu accelerator is handled by the browser process before the page ever
 * sees the key, so with the default menu in place `Mod-W` would shut the window instead of
 * closing the tab the person meant (E9.11).
 *
 * That failure is invisible to the end-to-end suite. Playwright dispatches keys through the
 * debugger protocol, straight into the renderer, so a menu accelerator never fires there and
 * a suite pressing `Control+W` sees the tab close and passes. So what `e2e/tabs.desktop.test.ts`
 * asserts instead is this menu's own accelerator table, which is the thing that would be
 * wrong.
 *
 * Roles and not labels, everywhere. A role's label is Electron's own, in the system's
 * language — which is the right answer for *Minimize* and *Quit*, and is the only reason
 * this file does not need the catalogue. A menu of the app's own commands would; that is a
 * card of its own, and it would read `src/renderer/commands.ts` rather than invent entries.
 *
 * `import type` and nothing else from `electron`, the same call `ipc.ts` makes: the template
 * is a value a test can read without a running Electron, and `index.ts` is where it is
 * handed to `Menu.buildFromTemplate`.
 */
export function menuTemplate(platform: string): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';

  return [
    // On macOS the app menu is where Quit lives and the first submenu is always the app's.
    // Everywhere else `fileMenu` is Quit alone — and on macOS it is *Close Window*, which is
    // exactly the item this file exists to leave out, so macOS gets no File menu at all.
    ...(mac ? [{ role: 'appMenu' } as const] : [{ role: 'fileMenu' } as const]),
    // Left as Electron built them. `editMenu` is what makes copy and paste work on macOS,
    // where the clipboard shortcuts are the menu's rather than the page's.
    { role: 'editMenu' },
    { role: 'viewMenu' },
    // The one submenu written out: the default carries Close, and its accelerator is the
    // key a tab now answers to.
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(mac ? [{ role: 'front' } as const] : []),
      ],
    },
  ];
}
