import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The menu row drawn in the title bar, through the real window (TYTO-244, PR B, ADR 0078).
 *
 * With the system's title bar hidden, Windows and Linux draw no native menu bar, so the
 * window draws the top-level names and each opens that menu's **native** list. Playwright
 * cannot see a native list, so the suite declares one seam in main: from `app.evaluate` it
 * wraps `Menu.prototype.popup`, records which installed submenu was asked for and where, and
 * holds its `callback` — the list "closes" when a case says so. The real `popup` is never
 * called, because on Windows it runs a modal loop the suite could not close. Nothing in the
 * shipped app grows a hook; it is the same seam `title-bar.desktop.test.ts` uses for
 * `setTitleBarOverlay`.
 *
 * Left and Right inside an open list (TYTO-263) go through a second seam of the same kind:
 * main listens to the window's `WM_KEYDOWN` with `hookWindowMessage` while a list is open, so
 * the suite wraps that method on the window and calls the handler main gave it with the
 * arrow's virtual-key code, as Windows would. Only on Windows, where the method exists.
 *
 * With `TYTO_MENU_ROW_SHOTS` set to a folder, the suite leaves CDP screenshots there.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_MENU_ROW_SHOTS'];

interface Popup {
  /** The role, or the id, of the top-level item whose submenu was popped. */
  readonly owner: string;
  readonly label: string;
  readonly items: readonly string[];
  readonly x: number;
  readonly y: number;
}

let scratch: string;
let app: ElectronApplication;
let page: Page;

const popups = (): Promise<Popup[]> =>
  app.evaluate(() => (globalThis as unknown as { tytoPopups: Popup[] }).tytoPopups);

/** Closes the list the seam is holding open, as picking or dismissing it would. */
const closeList = (): Promise<void> =>
  app.evaluate(() => {
    const store = globalThis as unknown as { tytoClose?: () => void };
    store.tytoClose?.();
    delete store.tytoClose;
  });

const waitForPopups = async (count: number): Promise<Popup[]> => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const found = await popups();
    if (found.length >= count) return found;
    await page.waitForTimeout(25);
  }
  throw new Error(`expected ${String(count)} popups, saw ${JSON.stringify(await popups())}`);
};

const rowNames = (): Promise<{ id: string; label: string }[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>('.title-bar__menu-item')].map((button) => ({
      id: button.dataset['menuId'] ?? '',
      label: button.textContent ?? '',
    })),
  );

/** The installed menu's own top-level labels: the one source the row must agree with. */
const installedLabels = (): Promise<string[]> =>
  app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? [])
      .filter((item) => item.submenu !== undefined && item.submenu !== null)
      .map((item) => item.label),
  );

const focusedMenu = (): Promise<string | null> =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['menuId'] ?? null);

const editorFocused = (): Promise<boolean> =>
  page.evaluate(() => document.activeElement?.closest('#editor') !== null);

const focusEditor = async (): Promise<void> => {
  await page.click('#editor .cm-content');
  await page.waitForFunction(() => document.activeElement?.closest('#editor') !== null);
};

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  // Its own data folders, never the machine's (TYTO-139).
  scratch = mkdtempSync(join(tmpdir(), 'tyto-menu-row-e2e-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.title-bar__menu-item');
  await app.evaluate(({ BrowserWindow, Menu }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 600);
    const store = globalThis as unknown as {
      tytoPopups: unknown[];
      tytoClose?: (() => void) | undefined;
    };
    store.tytoPopups = [];
    // The seam: every `popup` main asks for, recorded against the installed menu it came from.
    Menu.prototype.popup = function (this: Electron.Menu, options?: Electron.PopupOptions) {
      const owner = (Menu.getApplicationMenu()?.items ?? []).find((item) => item.submenu === this);
      store.tytoPopups.push({
        owner: owner?.role?.toLowerCase() ?? owner?.id ?? 'not-installed',
        label: owner?.label ?? '',
        items: this.items.map((item) => item.id ?? item.label),
        x: options?.x ?? -1,
        y: options?.y ?? -1,
      });
      store.tytoClose = options?.callback;
    };
    // The list closing because main closed it — which it does when an arrow moves the menu.
    Menu.prototype.closePopup = function () {
      const close = store.tytoClose;
      delete store.tytoClose;
      close?.();
    };
  });
  if (process.platform === 'win32') {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      const store = globalThis as unknown as {
        tytoHooks: Record<number, (wParam: Buffer, lParam: Buffer) => void>;
      };
      store.tytoHooks = {};
      // The second seam (TYTO-263): the handler main hooks while a list is open, held so a
      // case can hand it a key. The real hook is still installed, as main asked.
      const hook = window.hookWindowMessage.bind(window);
      const unhook = window.unhookWindowMessage.bind(window);
      window.hookWindowMessage = (message, callback) => {
        store.tytoHooks[message] = callback;
        hook(message, callback);
      };
      window.unhookWindowMessage = (message) => {
        delete store.tytoHooks[message];
        unhook(message);
      };
    });
  }
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the drawn menu row', () => {
  it("names the installed menu's five top-level menus, in its own labels", async () => {
    const names = await rowNames();
    expect(names.map(({ id }) => id)).toEqual([
      'file',
      'editmenu',
      'viewmenu',
      'windowmenu',
      'help',
    ]);
    expect(names.map(({ label }) => label)).toEqual(await installedLabels());
    const aria = await page.evaluate(() => ({
      bar: document.querySelector('.title-bar__menu')?.getAttribute('role'),
      items: [...document.querySelectorAll('.title-bar__menu-item')].map((button) => [
        button.getAttribute('role'),
        button.getAttribute('aria-haspopup'),
        button.getAttribute('aria-expanded'),
      ]),
    }));
    expect(aria.bar).toBe('menubar');
    expect(new Set(aria.items.map((triple) => triple.join(' ')))).toEqual(
      new Set(['menuitem menu false']),
    );
    await shoot('row');
  });

  it('takes focus at File on Alt alone, and Escape gives it back to the editor', async () => {
    await focusEditor();
    await page.keyboard.press('Alt');
    expect(await focusedMenu()).toBe('file');
    await shoot('row-alt');
    await page.keyboard.press('Escape');
    expect(await editorFocused()).toBe(true);
  });

  it('takes focus on F10, and F10 again leaves', async () => {
    await focusEditor();
    await page.keyboard.press('F10');
    expect(await focusedMenu()).toBe('file');
    await page.keyboard.press('F10');
    expect(await editorFocused()).toBe(true);
  });

  it('leaves Alt+key in the editor', async () => {
    await focusEditor();
    await page.keyboard.down('Alt');
    await page.keyboard.press('j');
    await page.keyboard.up('Alt');
    expect(await focusedMenu()).toBeNull();
    expect(await editorFocused()).toBe(true);
  });

  it('opens the Help list under Help on a click, and is expanded until it closes', async () => {
    const before = (await popups()).length;
    await page.click('.title-bar__menu-item[data-menu-id="help"]');
    const popup = (await waitForPopups(before + 1)).at(-1);
    expect(popup?.owner).toBe('help');
    expect(popup?.items).toContain('about');

    const box = await page.evaluate(() => {
      const rect = document
        .querySelector('.title-bar__menu-item[data-menu-id="help"]')!
        .getBoundingClientRect();
      return { x: rect.left, y: rect.bottom };
    });
    expect(popup?.x).toBe(Math.round(box.x));
    expect(popup?.y).toBe(Math.round(box.y));

    const expanded = () =>
      page.getAttribute('.title-bar__menu-item[data-menu-id="help"]', 'aria-expanded');
    expect(await expanded()).toBe('true');
    await shoot('help-open');
    await closeList();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.title-bar__menu-item[data-menu-id="help"]')
          ?.getAttribute('aria-expanded') === 'false',
    );
  });

  it('walks to Help with the arrows and opens it with Down', async () => {
    await focusEditor();
    const before = (await popups()).length;
    await page.keyboard.press('Alt');
    await page.keyboard.press('ArrowLeft');
    expect(await focusedMenu()).toBe('help');
    await page.keyboard.press('ArrowDown');
    expect((await waitForPopups(before + 1)).at(-1)?.owner).toBe('help');
    await closeList();
    await page.keyboard.press('Escape');
    expect(await editorFocused()).toBe(true);
  });

  it("runs the popped list's own items: About and the log folder", async () => {
    const ran = await app.evaluate(({ Menu, dialog, shell }) => {
      const seen: string[] = [];
      dialog.showMessageBox = ((...args: unknown[]) => {
        const box = args.at(-1) as { message?: string };
        seen.push(`about:${box.message ?? ''}`);
        return Promise.resolve({ response: 0, checkboxChecked: false });
      }) as typeof dialog.showMessageBox;
      shell.openPath = (path: string) => {
        seen.push(`open:${path.length > 0 ? 'a folder' : 'nothing'}`);
        return Promise.resolve('');
      };
      const help = (Menu.getApplicationMenu()?.items ?? []).find(
        (item) => item.role?.toLowerCase() === 'help',
      )?.submenu;
      for (const item of help?.items ?? []) {
        (item.click as unknown as () => void)();
      }
      return seen;
    });
    expect(ran).toEqual(['open:a folder', 'about:Tyto']);
  });

  it('installs Reload as the window’s command, and still no Close (TYTO-113)', async () => {
    const roles = await app.evaluate(({ Menu }) => {
      const found: string[] = [];
      const walk = (items: Electron.MenuItem[]): void => {
        for (const item of items) {
          if (item.role !== undefined && item.role !== null) found.push(item.role.toLowerCase());
          if (item.id === 'window.reload') found.push('command:window.reload');
          if (item.submenu) walk(item.submenu.items);
        }
      };
      walk(Menu.getApplicationMenu()?.items ?? []);
      return found;
    });
    expect(roles).toContain('toggledevtools');
    // Reload is back since TYTO-113, as the window's command and not the role that would
    // tear the page down before it keeps its tabs (ADR 0080). Close stays out.
    expect(roles).toContain('command:window.reload');
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forcereload');
    expect(roles).not.toContain('close');
  });

  it('is drawn again when the language changes, from the menu main built again', async () => {
    const before = (await rowNames())[0]?.label;
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('shell.toggleLocale');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (old) => document.querySelector('.title-bar__menu-item')?.textContent !== old,
      before,
      { polling: 25, timeout: 15_000 },
    );
    const after = await rowNames();
    expect(['File', 'Arquivo']).toContain(after[0]?.label);
    expect(after[0]?.label).not.toBe(before);
    expect(after.map(({ label }) => label)).toEqual(await installedLabels());
    await shoot('row-other-language');
  });
});

/** `WM_KEYDOWN` and the arrows' virtual-key codes, as Windows hands them to the hook. */
const WM_KEYDOWN = 0x0100;
const VK_LEFT = 0x25;
const VK_RIGHT = 0x27;

/** The window receiving an arrow while a list is open: what main's hook would be handed. */
const pressInList = (code: number): Promise<boolean> =>
  app.evaluate(
    (_electron, { message, code }) => {
      const store = globalThis as unknown as {
        tytoHooks: Record<number, ((wParam: Buffer, lParam: Buffer) => void) | undefined>;
      };
      const handler = store.tytoHooks[message];
      if (handler === undefined) return false;
      const wParam = Buffer.alloc(8);
      wParam.writeUInt32LE(code, 0);
      handler(wParam, Buffer.alloc(8));
      return true;
    },
    { message: WM_KEYDOWN, code },
  );

const expanded = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.title-bar__menu-item')]
      .filter((button) => button.getAttribute('aria-expanded') === 'true')
      .map((button) => (button as HTMLElement).dataset['menuId'] ?? ''),
  );

// `hookWindowMessage` is Windows-only, and so is the mechanism: on Linux and macOS a list
// stays as it was (ADR 0078). The CI's desktop job runs Linux, so this block runs on a
// Windows machine only.
describe.skipIf(process.platform !== 'win32')(
  'Left and Right inside an open list (TYTO-263, Windows only: hookWindowMessage)',
  () => {
    it('holds no list with a nested submenu, so Right inside a list always moves', async () => {
      const nested = await app.evaluate(({ Menu }) =>
        (Menu.getApplicationMenu()?.items ?? []).flatMap((top) =>
          (top.submenu?.items ?? [])
            .filter((item) => item.submenu !== undefined && item.submenu !== null)
            .map((item) => `${top.label} > ${item.label}`),
        ),
      );
      expect(nested).toEqual([]);
    });

    it('opens Window from Help on Left, and Help from File on Left, wrapping', async () => {
      let before = (await popups()).length;
      await page.click('.title-bar__menu-item[data-menu-id="help"]');
      await waitForPopups(before + 1);
      expect(await pressInList(VK_LEFT)).toBe(true);
      expect((await waitForPopups(before + 2)).at(-1)?.owner).toBe('windowmenu');
      await page.waitForFunction(
        () => (document.activeElement as HTMLElement | null)?.dataset['menuId'] === 'windowmenu',
      );
      expect(await expanded()).toEqual(['windowmenu']);
      await closeList();
      await page.waitForFunction(
        () => document.querySelector('.title-bar__menu-item[aria-expanded="true"]') === null,
      );

      before = (await popups()).length;
      await page.click('.title-bar__menu-item[data-menu-id="file"]');
      await waitForPopups(before + 1);
      expect(await pressInList(VK_LEFT)).toBe(true);
      expect((await waitForPopups(before + 2)).at(-1)?.owner).toBe('help');
      expect(await expanded()).toEqual(['help']);
      await closeList();
    });

    it('opens File from Help on Right, wrapping, and unhooks when the list closes', async () => {
      const before = (await popups()).length;
      await page.click('.title-bar__menu-item[data-menu-id="help"]');
      await waitForPopups(before + 1);
      expect(await pressInList(VK_RIGHT)).toBe(true);
      expect((await waitForPopups(before + 2)).at(-1)?.owner).toBe('file');
      await closeList();
      // The list closed by a click away, not an arrow: the hook is gone with it.
      expect(await pressInList(VK_LEFT)).toBe(false);
    });

    it("swallows the arrow's own press when it reaches the page, and only that one", async () => {
      await page.evaluate(() => {
        const seen: string[] = [];
        (globalThis as unknown as { tytoKeys: string[] }).tytoKeys = seen;
        window.addEventListener(
          'keydown',
          (event) => {
            seen.push(event.key);
          },
          { capture: true },
        );
      });
      const before = (await popups()).length;
      await page.click('.title-bar__menu-item[data-menu-id="help"]');
      await waitForPopups(before + 1);
      // The move and, at once, the same press arriving at the page as Windows delivers it
      // once the list has gone.
      await app.evaluate(
        ({ BrowserWindow }, { message, code }) => {
          const store = globalThis as unknown as {
            tytoHooks: Record<number, (wParam: Buffer, lParam: Buffer) => void>;
          };
          const wParam = Buffer.alloc(8);
          wParam.writeUInt32LE(code, 0);
          store.tytoHooks[message]?.(wParam, Buffer.alloc(8));
          const contents = BrowserWindow.getAllWindows()[0]!.webContents;
          contents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
          contents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
        },
        { message: WM_KEYDOWN, code: VK_LEFT },
      );
      await waitForPopups(before + 2);
      await closeList();
      // A second press is the person's own, and the page has it.
      await app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]!.webContents;
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
      });
      await page.waitForFunction(() =>
        (globalThis as unknown as { tytoKeys: string[] }).tytoKeys.includes('ArrowLeft'),
      );
      const keys = await page.evaluate(
        () => (globalThis as unknown as { tytoKeys: string[] }).tytoKeys,
      );
      expect(keys.filter((key) => key === 'ArrowLeft')).toHaveLength(1);
    });
  },
);
