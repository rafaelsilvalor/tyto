import { describe, expect, it } from 'vitest';

import type { MenuItemModel } from '../../shared/ipc.js';
import { menuTemplate } from './menu.js';
import {
  type MenuItemLike,
  type MenuLike,
  acceleratorLabel,
  findTopLevel,
  mnemonicOf,
  projectMenu,
  withoutMnemonic,
} from './menu-model.js';

/**
 * The model the drawn menu row reads (TYTO-244, ADR 0078), from menus made of plain objects.
 *
 * The real input is the menu Electron built from `menu.ts`'s template, and Electron fills in
 * what a role leaves out — a label in the system's language, a default key. The fake below
 * does the same for the roles the template uses, so the first cases read the template itself
 * through a stand-in for `Menu.buildFromTemplate`, and `e2e/menu-row.desktop.test.ts` reads
 * the real one.
 */

const ROLE_LABELS: Record<string, string> = {
  editmenu: 'Edit',
  viewmenu: 'View',
  windowmenu: 'Window',
  help: 'Help',
  quit: 'Exit',
  toggledevtools: 'Toggle Developer Tools',
  copy: 'Copy',
};

const ROLE_KEYS: Record<string, string> = {
  toggledevtools: 'CommandOrControl+Shift+I',
  copy: 'CommandOrControl+C',
};

type TemplateItem = ReturnType<typeof menuTemplate>[number];

/** What `Menu.buildFromTemplate` does to an item, as far as the model can see it. */
function build(item: TemplateItem): MenuItemLike {
  const role = typeof item.role === 'string' ? item.role.toLowerCase() : undefined;
  const submenu = Array.isArray(item.submenu)
    ? { items: item.submenu.map((child) => build(child)) }
    : role === 'editmenu'
      ? { items: [build({ role: 'copy' })] }
      : undefined;
  return {
    id: item.id ?? null,
    label: item.label ?? (role === undefined ? '' : (ROLE_LABELS[role] ?? role)),
    role: role ?? null,
    type: item.type ?? (submenu === undefined ? 'normal' : 'submenu'),
    enabled: item.enabled ?? true,
    visible: item.visible ?? true,
    accelerator: null,
    ...(submenu === undefined ? {} : { submenu }),
    ...(role !== undefined && ROLE_KEYS[role] !== undefined
      ? { getDefaultRoleAccelerator: () => ROLE_KEYS[role] }
      : {}),
  };
}

const TITLES: Partial<Record<string, string>> = {
  'menu.file': '&File',
  'menu.edit': '&Edit',
  'menu.view': '&View',
  'menu.window': '&Window',
  'menu.help': '&Help',
};

const installed = (platform: string): MenuLike => ({
  items: menuTemplate(platform, {
    // The English catalogue's five titles, with their mnemonics (TYTO-264).
    t: (key) => TITLES[key] ?? key,
    onRevealLogs: () => {},
    onCommand: () => {},
    onAbout: () => {},
  }).map((item) => build(item)),
});

describe("the menu row's model", () => {
  it('names the five top-level menus of Windows and Linux, in order', () => {
    const model = projectMenu(installed('win32'), 'win32');
    expect(model.map(({ id, label }) => [id, label])).toEqual([
      ['file', 'File'],
      ['editmenu', 'Edit'],
      ['viewmenu', 'View'],
      ['windowmenu', 'Window'],
      ['help', 'Help'],
    ]);
  });

  it('gives each title off macOS its letter and where it sits, and macOS none (TYTO-264)', () => {
    const model = projectMenu(installed('win32'), 'win32');
    expect(
      model.map(({ mnemonic, mnemonicAt }) => `${mnemonic ?? ''}@${String(mnemonicAt)}`),
    ).toEqual(['F@0', 'E@0', 'V@0', 'W@0', 'H@0']);
    const mac = projectMenu(installed('darwin'), 'darwin');
    expect(mac.filter((menu) => menu.mnemonic !== undefined)).toEqual([]);
    expect(mac.find((menu) => menu.id === 'file')?.label).toBe('File');
  });

  it("carries each menu's items: roles, separators and the about item's id", () => {
    const model = projectMenu(installed('linux'), 'linux');
    const view = model.find((menu) => menu.id === 'viewmenu');
    // The group commands first (TYTO-286, TYTO-288) and the preview's three (TYTO-287), then
    // Go to Block (TYTO-296), then Reload as the window's command and by its id (TYTO-113, ADR 0080).
    expect(view?.items.slice(0, 12).map((item) => item.id)).toEqual([
      'editor.splitRight',
      'editor.splitDown',
      'editor.focusNextGroup',
      'editor.focusPreviousGroup',
      'editor.moveTabToNextGroup',
      'editor.moveTabLeft',
      'editor.moveTabRight',
      'editor.closeGroup',
      'preview.openToSide',
      'preview.open',
      'preview.toggleLock',
      'editor.goToBlock',
    ]);
    expect(view?.items[13]).toMatchObject({ id: 'window.reload', label: 'command.window.reload' });
    expect(view?.items.slice(14).map((item) => item.role ?? item.type)).toEqual([
      'toggledevtools',
      'separator',
      'resetzoom',
      'zoomin',
      'zoomout',
      'separator',
      'togglefullscreen',
    ]);
    const separator = view?.items[15];
    expect(separator).toEqual({ id: 'item-15', label: '', type: 'separator', enabled: true });

    const help = model.find((menu) => menu.id === 'help');
    expect(help?.items.map((item) => item.id)).toEqual(['item-0', 'about']);
    expect(help?.items[0]?.label).toBe('menu.revealLogs');

    const file = model.find((menu) => menu.id === 'file');
    expect(file?.items.at(-1)).toMatchObject({ role: 'quit', label: 'Exit' });
  });

  it("shows a role's default key as a label for the platform, and none where there is none", () => {
    const model = projectMenu(installed('win32'), 'win32');
    const view = model.find((menu) => menu.id === 'viewmenu');
    expect(view?.items[14]).toMatchObject({ role: 'toggledevtools', accelerator: 'Ctrl+Shift+I' });
    expect(view?.items[13]).not.toHaveProperty('accelerator');
    expect(view?.items[0]).not.toHaveProperty('accelerator');
    expect(view?.items[16]).not.toHaveProperty('accelerator');

    const mac = projectMenu(installed('darwin'), 'darwin');
    const edit = mac.find((menu) => menu.id === 'editmenu');
    expect(edit?.items[0]).toMatchObject({ role: 'copy', accelerator: 'Cmd+C' });
  });

  it('leaves the File menu without keys, as TYTO-124 decided', () => {
    const file = projectMenu(installed('win32'), 'win32').find((menu) => menu.id === 'file');
    const keyed = file?.items.filter((item: MenuItemModel) => item.accelerator !== undefined);
    expect(keyed).toEqual([]);
  });

  it('marks a disabled item and drops an invisible one', () => {
    const model = projectMenu(
      {
        items: [
          {
            label: '&Tools',
            submenu: {
              items: [
                { id: 'a', label: 'On' },
                { id: 'b', label: 'Off', enabled: false },
                { id: 'c', label: 'Hidden', visible: false },
                { id: 'd', label: 'Keyed', accelerator: 'Alt+Plus' },
              ],
            },
          },
          { label: 'No submenu' },
          { label: 'Gone', visible: false, submenu: { items: [] } },
        ],
      },
      'linux',
    );
    expect(model).toEqual([
      {
        id: 'menu-0',
        label: 'Tools',
        mnemonic: 'T',
        mnemonicAt: 0,
        enabled: true,
        items: [
          { id: 'a', label: 'On', type: 'normal', enabled: true },
          { id: 'b', label: 'Off', type: 'normal', enabled: false },
          { id: 'd', label: 'Keyed', type: 'normal', enabled: true, accelerator: 'Alt++' },
        ],
      },
    ]);
  });

  it('answers nothing for no menu', () => {
    expect(projectMenu(null, 'win32')).toEqual([]);
  });
});

describe('finding a menu again by its id', () => {
  it('finds the Help submenu by the id the model gave it', () => {
    const menu = installed('win32');
    const help = findTopLevel(menu, 'help');
    expect(help?.submenu?.items.map((item) => item.id)).toEqual([null, 'about']);
    expect(findTopLevel(menu, 'menu-9')).toBeUndefined();
    expect(findTopLevel(null, 'help')).toBeUndefined();
  });

  it('finds a menu with no id and no role by its position', () => {
    const menu: MenuLike = { items: [{ label: 'A', submenu: { items: [] } }] };
    expect(findTopLevel(menu, 'menu-0')).toBe(menu.items[0]);
  });
});

describe('labels and keys', () => {
  it('drops a mnemonic marker and keeps a doubled one as an ampersand', () => {
    expect(withoutMnemonic('&File')).toBe('File');
    expect(withoutMnemonic('Save && Close')).toBe('Save & Close');
    expect(withoutMnemonic('Help')).toBe('Help');
  });

  it('reads the letter after the first single ampersand, and none from a doubled one', () => {
    expect(mnemonicOf('E&xibir')).toEqual({ label: 'Exibir', mnemonic: 'x', mnemonicAt: 1 });
    expect(mnemonicOf('Aju&da')).toEqual({ label: 'Ajuda', mnemonic: 'd', mnemonicAt: 3 });
    expect(mnemonicOf('Save && &Close')).toEqual({
      label: 'Save & Close',
      mnemonic: 'C',
      mnemonicAt: 7,
    });
    expect(mnemonicOf('&A&B')).toEqual({ label: 'AB', mnemonic: 'A', mnemonicAt: 0 });
    expect(mnemonicOf('Help')).toEqual({ label: 'Help' });
    expect(mnemonicOf('Odd&')).toEqual({ label: 'Odd' });
  });

  it('spells the modifiers the way each platform does', () => {
    expect(acceleratorLabel('CmdOrCtrl+Shift+I', 'win32')).toBe('Ctrl+Shift+I');
    expect(acceleratorLabel('CommandOrControl+Plus', 'darwin')).toBe('Cmd++');
    expect(acceleratorLabel('Alt+F4', 'darwin')).toBe('Option+F4');
    expect(acceleratorLabel('F11', 'linux')).toBe('F11');
  });
});
