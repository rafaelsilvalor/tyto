import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';

import { menuTemplate } from './menu.js';

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
    const submenu = submenuOf(menuTemplate(platform), 'viewMenu');

    expect(submenu).toBeDefined();
    expect(roles(submenu ?? [])).not.toContain('reload');
    expect(roles(submenu ?? [])).not.toContain('forceReload');
  });

  it('keeps everything else the default submenu had', () => {
    // Removed item by item rather than by dropping the submenu, so what is left is a
    // statement about the two entries and not about the View menu as a whole.
    expect(roles(submenuOf(menuTemplate('linux'), 'viewMenu') ?? [])).toEqual([
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
    expect(roles(menuTemplate('darwin'))).toContain('editMenu');
  });

  it('writes the Window submenu out too, because the default one carries Close', () => {
    // Same reasoning as the View menu above: the absence of `close` from a delegated role
    // proves nothing, so what is asserted is that the submenu is this file's. `Mod-W`
    // belongs to a tab (E9.11), and `e2e/tabs.desktop.test.ts` is where the accelerator it
    // ends up with is read off a running app.
    for (const platform of ['win32', 'darwin', 'linux']) {
      const submenu = submenuOf(menuTemplate(platform), 'windowMenu');

      expect(submenu).toBeDefined();
      expect(roles(submenu ?? [])).not.toContain('close');
    }
  });
});
