import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { DOCUMENTATION_COMMAND, FILE_MENU_COMMANDS } from '../../shared/commands.js';
import { aboutText, menuTemplate } from './menu.js';

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
  onAbout: () => void = () => {},
) => menuTemplate(platform, { t: (key) => key, onRevealLogs, onCommand, onAbout });

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
function roles(entries: readonly MenuItemConstructorOptions[]): string[] {
  const found: string[] = [];
  const walk = (items: readonly MenuItemConstructorOptions[]): void => {
    for (const item of items) {
      if (item.role !== undefined) found.push(item.role);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(entries);
  return found;
}

const submenuOf = (
  entries: readonly MenuItemConstructorOptions[],
  role: string,
): readonly MenuItemConstructorOptions[] | undefined => {
  const found = entries.find((item) => item.role === role);
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
    // The three zoom roles are the window's commands since TYTO-272, tested below.
    expect(roles(submenuOf(template('linux'), 'viewMenu') ?? [])).toEqual([
      'toggleDevTools',
      'togglefullscreen',
    ]);
  });

  it('offers the zoom as the window’s commands, with no accelerator (TYTO-272)', () => {
    // A role zooms without writing the `zoom` setting, and its accelerator would be the
    // browser process's; the commands write it and the keys stay the page's (ADR 0099).
    const onCommand = vi.fn();
    const submenu =
      submenuOf(
        template('win32', () => {}, onCommand),
        'viewMenu',
      ) ?? [];
    const zoom = submenu.filter((item) => item.id?.startsWith('window.zoom') === true);

    expect(zoom.map((item) => [item.id, item.label, item.accelerator])).toEqual([
      ['window.zoomReset', 'command.window.zoomReset', undefined],
      ['window.zoomIn', 'command.window.zoomIn', undefined],
      ['window.zoomOut', 'command.window.zoomOut', undefined],
    ]);
    for (const item of zoom) (item.click as (() => void) | undefined)?.();
    expect(onCommand.mock.calls).toEqual([
      ['window.zoomReset'],
      ['window.zoomIn'],
      ['window.zoomOut'],
    ]);
  });

  it('offers Reload as the window’s command, with no accelerator (TYTO-113)', () => {
    // The command writes the session before the page goes (ADR 0080); the role would not wait.
    const onCommand = vi.fn();
    const submenu =
      submenuOf(
        template('win32', () => {}, onCommand),
        'viewMenu',
      ) ?? [];
    const reload = submenu.find((item) => item.id === 'window.reload');

    expect(reload?.label).toBe('command.window.reload');
    expect(reload?.accelerator).toBeUndefined();
    (reload?.click as (() => void) | undefined)?.();
    expect(onCommand).toHaveBeenCalledWith('window.reload');
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

  it('keeps the clipboard roles inside the Edit list it writes out (TYTO-334)', () => {
    expect(roles(submenuOf(template('win32'), 'editMenu') ?? [])).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'delete',
      'selectAll',
    ]);
    expect(roles(submenuOf(template('darwin'), 'editMenu') ?? [])).toContain('pasteAndMatchStyle');
  });
});

/**
 * Electron's own label for a role is fixed English on Windows and Linux, whatever the system's
 * language (TYTO-264, TYTO-334). So the window is in Portuguese only if every role item carries
 * this app's word for it, and every role that fills a list of its own has that list written out
 * — Electron would fill it with English items the template never names.
 */

/** The roles that bring a list of their own when the template gives them none. */
const ROLES_THAT_FILL_A_LIST = new Set([
  'appMenu',
  'fileMenu',
  'editMenu',
  'viewMenu',
  'windowMenu',
  'shareMenu',
]);

/** A translator that marks what it answers, so a label can be told from one written by hand. */
const marked = (platform: string): MenuItemConstructorOptions[] =>
  menuTemplate(platform, {
    t: (key) => `<${key}>`,
    onRevealLogs: () => {},
    onCommand: () => {},
    onAbout: () => {},
  });

/** Each role item, with its path, that `test` says is wrong; top-level titles on macOS exempt. */
function offending(
  platform: string,
  test: (item: MenuItemConstructorOptions) => boolean,
): string[] {
  const found: string[] = [];
  const walk = (items: readonly MenuItemConstructorOptions[], path: string): void => {
    for (const item of items) {
      const here = `${path}/${item.role ?? item.id ?? item.label ?? item.type ?? '?'}`;
      // macOS keeps the roles' own top-level titles, in the system's language (ADR 0078 §2).
      const macTitle = platform === 'darwin' && path === '';
      if (item.role !== undefined && !macTitle && test(item)) found.push(here);
      if (Array.isArray(item.submenu)) walk(item.submenu, here);
    }
  };
  walk(marked(platform), '');
  return found;
}

describe('the role items, in the window’s language (TYTO-334)', () => {
  it.each(['win32', 'linux', 'darwin'])(
    'labels every role item from the catalogue on %s',
    (platform) => {
      const unlabelled = offending(
        platform,
        (item) => typeof item.label !== 'string' || !/^<[^>]+>$/u.test(item.label),
      );
      expect(unlabelled).toEqual([]);
    },
  );

  it.each(['win32', 'linux', 'darwin'])(
    'writes out every list a role would fill in English on %s',
    (platform) => {
      const delegated: string[] = [];
      const walk = (items: readonly MenuItemConstructorOptions[]): void => {
        for (const item of items) {
          if (item.role !== undefined && ROLES_THAT_FILL_A_LIST.has(item.role)) {
            if (!Array.isArray(item.submenu)) delegated.push(item.role);
          }
          if (Array.isArray(item.submenu)) walk(item.submenu);
        }
      };
      walk(marked(platform));
      expect(delegated).toEqual([]);
    },
  );

  it('says Exit on Windows and Quit on Linux, as Electron did', () => {
    const quit = (platform: string) =>
      fileSubmenu(
        menuTemplate(platform, {
          t: (key) => key,
          onRevealLogs: () => {},
          onCommand: () => {},
          onAbout: () => {},
        }),
      ).find((item) => item.role === 'quit')?.label;
    expect(quit('win32')).toBe('menu.role.exit');
    expect(quit('linux')).toBe('menu.role.quit');
  });
});

/**
 * The one item this app names itself (TYTO-132).
 *
 * `menu.ts` used to say in as many words that roles-and-not-labels was "the only reason this
 * file does not need the catalogue". That stopped being true here, so it is asserted here.
 */
describe('the Help submenu', () => {
  it('carries the manual, then the log folder and About, on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const help = submenuOf(template(platform), 'help');
      expect(
        help?.map((item) => item.label ?? item.type),
        platform,
      ).toEqual(['command.help.openDocumentation', 'separator', 'menu.revealLogs', 'menu.about']);
    }
  });

  it('runs the documentation command through the registry, not a URL of its own (TYTO-318)', () => {
    const onCommand = vi.fn();
    const help = submenuOf(
      template('linux', () => {}, onCommand),
      'help',
    );

    expect(help?.[0]?.id).toBe(DOCUMENTATION_COMMAND.id);
    (help?.[0]?.click as (() => void) | undefined)?.();

    // The same id the command bar runs; which edition opens is main's, by the window's locale.
    expect(onCommand.mock.calls).toEqual([['help.openDocumentation']]);
  });

  it('opens About through the callback it was given (TYTO-248)', () => {
    const onAbout = vi.fn();
    const help = submenuOf(
      template(
        'win32',
        () => {},
        () => {},
        onAbout,
      ),
      'help',
    );

    (help?.[3]?.click as (() => void) | undefined)?.();

    expect(onAbout).toHaveBeenCalledTimes(1);
  });

  it('says in About what the footer said: version, platform, templates and their folder', () => {
    const facts = { version: '0.1.0', platform: 'linux', templates: 2, templatesFolder: null };

    expect(aboutText((key) => key, facts).split('\n')).toEqual([
      'shell.about.version: 0.1.0',
      'shell.about.platform: linux',
      'shell.about.templates: 2',
      // A word and not a blank when nobody chose a folder (TYTO-122).
      'templates.folder.label: templates.folder.none',
    ]);
    expect(aboutText((key) => key, { ...facts, templatesFolder: '/home/r/meus' })).toContain(
      'templates.folder.label: /home/r/meus',
    );
  });

  it('runs the reveal it was given, once', () => {
    const onRevealLogs = vi.fn();
    const help = submenuOf(template('linux', onRevealLogs), 'help');

    (help?.[2]?.click as (() => void) | undefined)?.();

    // The item does the opening and nothing else: what folder that is, is the composition
    // root's, because the log is the only thing that knows where it put itself.
    expect(onRevealLogs).toHaveBeenCalledTimes(1);
  });

  it('keeps the role, and names the title from the catalogue off macOS only (TYTO-264)', () => {
    // A role's own title is Electron's fixed English on Windows and carries no mnemonic, so off
    // macOS the catalogue's word — with its `&` — goes over it. macOS keeps the role's (ADR 0078).
    for (const platform of ['win32', 'linux']) {
      expect(template(platform).find((item) => item.role === 'help')?.label, platform).toBe(
        'menu.help',
      );
    }
    expect(template('darwin').find((item) => item.role === 'help')?.label).toBeUndefined();
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

  it.each(['win32', 'linux'])('titles all five from the catalogue on %s (TYTO-264)', (platform) => {
    const built = template(platform);
    expect(built.map((item) => [item.role ?? item.id, item.label])).toEqual([
      ['file', 'menu.file'],
      ['editMenu', 'menu.edit'],
      ['viewMenu', 'menu.view'],
      ['windowMenu', 'menu.window'],
      ['help', 'menu.help'],
    ]);
  });

  it('drops the mnemonic from the File title on macOS, which has none (TYTO-264)', () => {
    const mac = menuTemplate('darwin', {
      t: (key) => (key === 'menu.file' ? '&Arquivo' : key),
      onRevealLogs: () => {},
      onCommand: () => {},
      onAbout: () => {},
    });
    expect(mac.find((item) => item.id === 'file')?.label).toBe('Arquivo');
    expect(mac.filter((item) => item.role !== undefined && item.label !== undefined)).toEqual([]);
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

    // Five groups, so four separators between them — plus the fifth before Quit, which is
    // appended on this platform rather than coming from the table.
    expect(shape).toEqual([
      'document.new',
      'document.newFromTemplate',
      'delivery.new',
      'editor.open',
      'workspace.openFolder',
      'workspace.openRecent',
      '—',
      'editor.save',
      'editor.saveAs',
      '—',
      'file.export',
      '—',
      'template.new',
      'template.edit',
      '—',
      'plugins.show',
      'gallery.show',
      'queue.show',
      'settings.open',
      'keybindings.open',
      'snippets.open',
      '—',
      'document.close',
      'workspace.closeFolder',
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

  it('greys the items the window said do nothing, and only those (TYTO-283)', () => {
    const items = fileSubmenu(
      menuTemplate('win32', {
        t: (key) => key,
        onRevealLogs: () => {},
        onCommand: () => {},
        onAbout: () => {},
        disabled: new Set(['file.export']),
      }),
    );
    const enabled = (id: string): boolean | undefined =>
      items.find((item) => item.id === id)?.enabled;

    expect(enabled('file.export')).toBe(false);
    for (const command of FILE_MENU_COMMANDS) {
      if (command.id !== 'file.export') expect(enabled(command.id), command.id).toBe(true);
    }
    // Absent is none greyed.
    for (const item of fileSubmenu(template('win32'))) {
      if (item.id !== undefined) expect(item.enabled, item.id).not.toBe(false);
    }
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
