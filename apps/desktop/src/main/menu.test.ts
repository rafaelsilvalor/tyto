import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { FILE_MENU_COMMANDS } from '../../shared/commands.js';
import { menuTemplate } from './menu.js';

/**
 * The template with a fake translator and a no-op reveal (TYTO-132).
 *
 * `t` answers with the key itself, which is what a template test wants: the assertion is that
 * the item carries *the catalogue's word for it*, and `shared/i18n/i18n.test.ts` is what holds
 * that key to having a word in both languages.
 */
const template = (
  platform: string,
  onRevealLogs: () => void = () => {},
  onCommand: (id: string) => void = () => {},
) => menuTemplate(platform, { t: (key) => key, onRevealLogs, onCommand });

/** The File submenu, found by its label rather than by a role — it has none (TYTO-124). */
const fileSubmenu = (
  built: readonly MenuItemConstructorOptions[],
): readonly MenuItemConstructorOptions[] => {
  const found = built.find((item) => item.label === 'menu.file');
  return Array.isArray(found?.submenu) ? found.submenu : [];
};

/**
 * What the application menu may and may not carry, with no Electron under it.
 *
 * The template is a value, which is the whole reason `menu.ts` imports `electron` as a type
 * and nothing else — so the roles it asks for can be read here, in `pnpm check`, rather than
 * only from a launched app. What this file cannot see is the accelerator each role *gets*:
 * Electron fills those in `buildFromTemplate`, so `Reload` being `CommandOrControl+R` is a
 * fact about Electron and is asserted where Electron is running,
 * in `e2e/tabs.desktop.test.ts`.
 *
 * Between them the two suites cover the one failure this file exists to prevent: a role
 * added back here, and a default accelerator that turns out to be destructive there.
 */

/** Every role the template asks for, at any depth. */
function roles(template: readonly MenuItemConstructorOptions[]): string[] {
  const found: string[] = [];
  const walk = (items: readonly MenuItemConstructorOptions[]): void => {
    for (const item of items) {
      if (item.role !== undefined) found.push(item.role);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return found;
}

const submenuOf = (
  template: readonly MenuItemConstructorOptions[],
  role: string,
): readonly MenuItemConstructorOptions[] | undefined => {
  const found = template.find((item) => item.role === role);
  return Array.isArray(found?.submenu) ? found.submenu : undefined;
};

describe('the View menu', () => {
  it.each(['win32', 'darwin', 'linux'])('writes its own submenu out on %s', (platform) => {
    // **Asserted as a submenu that exists, and not as `roles` missing `reload`.** A bare
    // `{ role: 'viewMenu' }` — the state this card found, the one that carries
    // `CommandOrControl+R` — contains no `reload` either: the items are Electron's, added in
    // `buildFromTemplate`. A test written the obvious way passes on the broken menu, which
    // is how this one came to be written this way (measured, by restoring the role and
    // watching three of four assertions still pass).
    //
    // So what a template can honestly say is *whether it delegates*, and delegating is the
    // failure: Electron decides the items, and two of the ones it decides on discard every
    // unsaved tab in the window (TYTO-104).
    const submenu = submenuOf(template(platform), 'viewMenu');

    expect(submenu).toBeDefined();
    expect(roles(submenu ?? [])).not.toContain('reload');
    expect(roles(submenu ?? [])).not.toContain('forceReload');
  });

  it('keeps everything else the default submenu had', () => {
    // Removed item by item rather than by dropping the submenu, so what is left is a
    // statement about the two entries and not about the View menu as a whole.
    expect(roles(submenuOf(template('linux'), 'viewMenu') ?? [])).toEqual([
      'toggleDevTools',
      'resetZoom',
      'zoomIn',
      'zoomOut',
      'togglefullscreen',
    ]);
  });
});

describe('the rest of the menu', () => {
  it('still has the edit roles macOS needs for copy and paste', () => {
    // Removing the menu outright is what would take the clipboard off macOS, where those
    // shortcuts belong to the menu rather than to the page (`menu.ts`).
    expect(roles(template('darwin'))).toContain('editMenu');
  });

  it('writes the Window submenu out too, because the default one carries Close', () => {
    // Same reasoning as the View menu above: the absence of `close` from a delegated role
    // proves nothing, so what is asserted is that the submenu is this file's. `Mod-W`
    // belongs to a tab (E9.11), and `e2e/tabs.desktop.test.ts` is where the accelerator it
    // ends up with is read off a running app.
    for (const platform of ['win32', 'darwin', 'linux']) {
      const submenu = submenuOf(template(platform), 'windowMenu');

      expect(submenu).toBeDefined();
      expect(roles(submenu ?? [])).not.toContain('close');
    }
  });
});

/**
 * The one item this app names itself (TYTO-132).
 *
 * `menu.ts` used to say in as many words that roles-and-not-labels was "the only reason this
 * file does not need the catalogue". That stopped being true here, so it is asserted here.
 */
describe('the Help submenu', () => {
  it('carries exactly one item, on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const help = submenuOf(template(platform), 'help');
      expect(help, platform).toHaveLength(1);
      expect(help?.[0]?.label, platform).toBe('menu.revealLogs');
    }
  });

  it('runs the reveal it was given, once', () => {
    const onRevealLogs = vi.fn();
    const help = submenuOf(template('linux', onRevealLogs), 'help');

    (help?.[0]?.click as (() => void) | undefined)?.();

    // The item does the opening and nothing else: what folder that is, is the composition
    // root's, because the log is the only thing that knows where it put itself.
    expect(onRevealLogs).toHaveBeenCalledTimes(1);
  });

  it('leaves the submenu title to Electron', () => {
    // `role: 'help'` and no `label`, so the word "Help"/"Ajuda" is the system's rather than a
    // second thing this repository has to translate.
    const help = template('linux').find((item) => item.role === 'help');

    expect(help?.label).toBeUndefined();
  });
});

/**
 * The File menu, which before TYTO-124 was `{ role: 'fileMenu' }` — Quit alone on Windows and
 * Linux, and on macOS not present at all.
 *
 * The lesson the View menu taught above applies here in reverse. There, a delegated role could
 * not be shown to be missing an item, so what was asserted was that the submenu is this
 * repository's. Here the submenu **is** this repository's, so its items can be read directly:
 * every one of them is a row of `FILE_MENU_GROUPS`, in order, and nothing else.
 */
describe('the File submenu', () => {
  it.each(['win32', 'darwin', 'linux'])("is this repository's and not a role on %s", (platform) => {
    const built = template(platform);

    // No `fileMenu` anywhere, on any platform. That role brought Quit alone on two of them and
    // *Close Window* on `Mod-W` on the third, which is the accelerator `menu.ts` exists for.
    expect(roles(built)).not.toContain('fileMenu');
    expect(built.find((item) => item.label === 'menu.file')).toBeDefined();
  });

  it.each(['win32', 'darwin', 'linux'])(
    'carries every command in the table, in order, on %s',
    (platform) => {
      const items = fileSubmenu(template(platform));
      const commands = items.filter((item) => item.id !== undefined);

      expect(commands.map((item) => item.id)).toEqual(
        FILE_MENU_COMMANDS.map((command) => command.id),
      );
      // The label is the catalogue's word for the command, which is the same key the command bar
      // shows the row under — the fake `t` here answers with the key, so this reads as the key.
      expect(commands.map((item) => item.label)).toEqual(
        FILE_MENU_COMMANDS.map((command) => command.label),
      );
    },
  );

  it('draws a separator between groups and nowhere else', () => {
    const items = fileSubmenu(template('linux'));
    const shape = items.map((item) => (item.type === 'separator' ? '—' : (item.id ?? item.role)));

    // Four groups, so three separators between them — plus the fourth before Quit, which is
    // appended on this platform rather than coming from the table.
    expect(shape).toEqual([
      'document.new',
      'editor.open',
      '—',
      'editor.save',
      'editor.saveAs',
      '—',
      'file.export',
      '—',
      'document.close',
      '—',
      'quit',
    ]);
  });

  it('leaves Quit to the application menu on macOS', () => {
    // `role: 'appMenu'` is where macOS puts Quit, and a second one in File would be the same
    // verb twice. Windows and Linux have no app menu, so File is the only place it can go.
    expect(roles(fileSubmenu(template('darwin')))).not.toContain('quit');
    expect(roles(template('darwin'))).toContain('appMenu');
    expect(roles(fileSubmenu(template('win32')))).toContain('quit');
  });

  it('runs the command it names, by id, once', () => {
    const onCommand = vi.fn();
    const items = fileSubmenu(template('linux', () => {}, onCommand));
    const save = items.find((item) => item.id === 'editor.save');

    (save?.click as (() => void) | undefined)?.();

    // The id and nothing else crosses: what `editor.save` does is the renderer's registry's,
    // which is the whole of how a menu item and a command-bar row stay one command.
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith('editor.save');
  });

  it('gives no item an accelerator, on any platform', () => {
    // **The decision, asserted.** A menu accelerator is handled by the browser process before
    // the page sees the key, so one here would override `desktopKeymapSet` unconditionally —
    // vim mode included, where those bindings are deliberately absent and `Ctrl-N` and
    // `Ctrl-O` belong to the vim engine. The menu teaches the verbs; the page keeps the keys.
    for (const platform of ['win32', 'darwin', 'linux']) {
      const withAccelerator = fileSubmenu(template(platform)).filter(
        (item) => item.accelerator !== undefined,
      );

      expect(withAccelerator, platform).toEqual([]);
    }
  });
});
