import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { menuTemplate } from './menu.js';

/**
 * The template with a fake translator and a no-op reveal (TYTO-132).
 *
 * `t` answers with the key itself, which is what a template test wants: the assertion is that
 * the item carries *the catalogue's word for it*, and `shared/i18n/i18n.test.ts` is what holds
 * that key to having a word in both languages.
 */
const template = (platform: string, onRevealLogs: () => void = () => {}) =>
  menuTemplate(platform, { t: (key) => key, onRevealLogs });

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
