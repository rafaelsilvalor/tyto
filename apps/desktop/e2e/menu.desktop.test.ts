import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

import { FILE_MENU_COMMANDS } from '../shared/commands.js';
import { translate } from '../shared/i18n/index.js';

/**
 * The File menu, in a running app (TYTO-124).
 *
 * **What `src/main/menu.test.ts` cannot say.** That suite reads the template, which is a value
 * this repository wrote; this one reads `Menu.getApplicationMenu()`, which is what Electron
 * made of it — and the gap between the two is where the old bug lived, because a
 * `{ role: 'fileMenu' }` contains no items until `buildFromTemplate` fills them in.
 *
 * It is also the only place the whole route can be walked: a click in the browser process, an
 * `IPC_EVENTS` push through the preload, `runCommand` in the renderer, and a tab appearing.
 * No unit reaches more than one leg of that.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

let scratch: string;
let app: ElectronApplication;
let page: Page;

/** Every item in the application menu, flattened, with the fields this suite asks about. */
const menuItems = async (): Promise<
  { id: string; label: string; accelerator: string | null; enabled: boolean }[]
> =>
  app.evaluate(({ Menu }) => {
    const found: { id: string; label: string; accelerator: string | null; enabled: boolean }[] = [];
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        found.push({
          id: item.id,
          label: item.label,
          accelerator: item.accelerator ?? null,
          enabled: item.enabled,
        });
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(Menu.getApplicationMenu()?.items ?? []);
    return found;
  });

/** Clicks a menu item by the id the template gave it, from inside main. */
const clickItem = async (id: string): Promise<void> => {
  await app.evaluate(({ Menu }, wanted) => {
    // `getMenuItemById` searches submenus, which is why the items carry an id at all: the
    // alternative is matching a translated label, and this window can change language.
    Menu.getApplicationMenu()?.getMenuItemById(wanted)?.click();
  }, id);
};

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-menu-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
}, 120_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the File menu Electron built', () => {
  it('carries every verb the table names', async () => {
    const ids = (await menuItems()).map((item) => item.id);

    for (const command of FILE_MENU_COMMANDS) expect(ids, command.id).toContain(command.id);
  });

  it('shows them in the language the window opened in', async () => {
    const items = await menuItems();
    // The app is launched with no settings file, so the window and the menu are both on the
    // system locale — the one case in which main and the renderer are guaranteed to agree.
    const open = items.find((item) => item.id === 'editor.open');

    expect([
      translate('pt-BR', 'command.file.open'),
      translate('en', 'command.file.open'),
    ]).toContain(open?.label);
  });

  it('takes no accelerator from the page', async () => {
    const items = await menuItems();
    const fileAccelerators = items
      .filter((item) => FILE_MENU_COMMANDS.some((command) => command.id === item.id))
      .map((item) => item.accelerator)
      .filter((accelerator) => accelerator !== null);

    // **The decision, read off the running app.** A menu accelerator is handled by the browser
    // process before the page sees the key, and `desktopKeymapSet` is where these keys live —
    // vim mode included, where they are deliberately absent. The template test asserts the same
    // thing; this asserts Electron did not add one of its own.
    expect(fileAccelerators).toEqual([]);
  });

  it('opens a new tab when New is picked, and disturbs no other', async () => {
    const before = await page.locator('.tabs__tab').count();

    await clickItem('document.new');
    await page.waitForFunction(
      (count) => document.querySelectorAll('.tabs__tab').length === count + 1,
      before,
    );

    // The whole route: a click in main, a push across the bridge, `registry.run` in the
    // renderer, a tab on screen. Nothing in this app can prove that except a launched one.
    expect(await page.locator('.tabs__tab').count()).toBe(before + 1);
  });
});
