import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * New, rename and delete from the explorer, in the real window (TYTO-352, ADR 0121): the context
 * menu through `menu:context`, the name typed in the tree, F2, the delete question through
 * `dialog:confirm`, and the tabs that follow a rename and a delete.
 *
 * **The trash is a stand-in**, swapped in through `app.evaluate` for `shell.trashItem`, which
 * main looks up at every call: it moves the entry into a folder of this suite's, so the test can
 * see it arrive and nothing reaches the real Recycle Bin. The question's box is answered from
 * main too, and what it asked is recorded.
 *
 * **A native menu cannot be clicked from here**: Playwright drives the page, and `Menu.popup`
 * draws outside it. So the real popup is opened and closed by main once, to measure what
 * `menu:context` answers and when; and the picks are made by a popup that calls `callback` and
 * then an item's `click`, in the order Windows delivers them, to hold ADR 0121's 50 ms grace.
 *
 * With `TYTO_EXPLORER_SHOTS` set to a folder, the suite leaves pictures of the window, and of the
 * header's buttons (TYTO-365) in both themes at 125%, this machine's scale, where TYTO-323 found
 * seams that 100% hides. Its own `--user-data-dir` and `TYTO_HOME`, one launch, inside the 60 s
 * budget (ADR 0105).
 */

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env['TYTO_EXPLORER_SHOTS'];

let scratch: string;
let work: string;
let bin: string;
let app: ElectronApplication | undefined;
let window: Page;

async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

let shotCount = 0;
const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  shotCount += 1;
  await window.screenshot({ path: join(shots, `${String(shotCount)}-${name}.png`) });
};

const rows = (): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('tyto-explorer-panel .explorer__row')].map(
      (row) =>
        `${'  '.repeat(Number(row.getAttribute('aria-level')) - 1)}${row.dataset.name ?? ''}`,
    ),
  );

const row = (name: string) => window.locator(`.explorer__row[data-name="${name}"]`);
const field = () => window.locator('.explorer__field');

/** Each tab's label, with a `*` when it holds unsaved text. */
const tabs = (): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab')].map(
      (tab) =>
        `${tab.querySelector('.tabs__label')?.textContent ?? ''}${
          tab.querySelector('.tabs__dirty') === null ? '' : ' *'
        }`,
    ),
  );

/** What the delete question asked, as main drew it. */
const asked = (): Promise<{ message: string; detail?: string; buttons: string[] }[]> =>
  app!.evaluate(
    () =>
      (globalThis as { asked?: { message: string; detail?: string; buttons: string[] }[] }).asked ??
      [],
  );

/**
 * The popup that picks: `callback` first and the item's `click` `lateMs` after it, the order
 * Windows can deliver them in. `null` puts the real popup back.
 */
async function pickFromMenu(id: string | null, lateMs = 20): Promise<void> {
  await app!.evaluate(
    ({ Menu }, [wanted, late]) => {
      const store = globalThis as { realPopup?: Electron.Menu['popup']; offered?: string[][] };
      store.realPopup ??= Menu.prototype.popup;
      if (wanted === null) {
        Menu.prototype.popup = store.realPopup;
        return;
      }
      Menu.prototype.popup = function popup(this: Electron.Menu, options) {
        (store.offered ??= []).push(this.items.map((item) => item.label));
        options?.callback?.();
        const index = Number(wanted);
        setTimeout(() => {
          this.items[index]?.click();
        }, late);
      };
    },
    [id, lateMs] as const,
  );
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-explorer-write-e2e-'));
  work = join(scratch, 'promo');
  bin = join(scratch, 'bin');
  mkdirSync(join(work, 'briefs'), { recursive: true });
  mkdirSync(join(work, 'velho'), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(work, 'briefs', 'capa.brief'), '::titulo Capa\n');
  writeFileSync(join(work, 'velho', 'velho.brief'), '::titulo Velho\n');
  writeFileSync(join(work, 'logo.png'), '');

  app = await _electron.launch({
    args: [
      '.',
      `--user-data-dir=${join(scratch, 'userData')}`,
      ...(shots === undefined ? [] : ['--force-device-scale-factor=1.25']),
    ],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');

  await app.evaluate(
    ({ dialog, shell }, [chosen, trash]) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
      // The stand-in trash: the entry moves into the suite's folder, and nothing is deleted.
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      shell.trashItem = (target: string) => {
        fs.renameSync(target, path.join(trash, path.basename(target)));
        return Promise.resolve();
      };
      // The delete question, recorded and answered yes.
      dialog.showMessageBox = ((options: Electron.MessageBoxOptions) => {
        const store = globalThis as { asked?: unknown[] };
        (store.asked ??= []).push({
          message: options.message,
          detail: options.detail,
          buttons: options.buttons,
        });
        return Promise.resolve({ response: 1, checkboxChecked: false });
      }) as typeof dialog.showMessageBox;
    },
    [work, bin] as const,
  );
  await run('workspace.openFolder');
  await window.waitForSelector('.explorer__row[data-name="logo.png"]', { timeout: 10_000 });
}, 180_000);

afterAll(async () => {
  if (app !== undefined) await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('new, rename and delete from the explorer (TYTO-352)', () => {
  it('answers menu:context from the real menu, and takes a pick only inside the grace', async () => {
    const ask = () =>
      window.evaluate(async () => {
        const started = performance.now();
        const bridge = (window as unknown as { tyto: Record<string, (r: unknown) => unknown> })
          .tyto;
        const answer = await bridge['menu:context']!({
          x: 40,
          y: 120,
          items: [{ id: 'only', label: 'Probe', enabled: true }],
        });
        return { answer, ms: Math.round(performance.now() - started) };
      });
    // The real popup, closed by main 300 ms after it opened: nothing picked.
    await app!.evaluate(({ Menu }) => {
      const real = Menu.prototype.popup;
      Menu.prototype.popup = function popup(this: Electron.Menu, options) {
        real.call(this, options);
        setTimeout(() => {
          this.closePopup(options?.window);
        }, 300);
      };
      (globalThis as { realPopup?: Electron.Menu['popup'] }).realPopup = real;
    });
    const closed = await ask();
    process.stdout.write(`[TYTO-352] real menu closed unpicked: ${JSON.stringify(closed)}\n`);
    expect(closed.answer).toEqual({ chosen: null });
    expect(closed.ms).toBeGreaterThanOrEqual(340);

    // A click that lands after the close, as on Windows: inside the 50 ms, and past it.
    await pickFromMenu('0', 20);
    expect((await ask()).answer).toEqual({ chosen: 'only' });
    await pickFromMenu('0', 120);
    expect((await ask()).answer).toEqual({ chosen: null });
  }, 30_000);

  it('makes a new brief from the empty space’s menu, and opens it in a tab', async () => {
    await pickFromMenu('0');
    await window.locator('.explorer__body').click({ button: 'right', position: { x: 60, y: 200 } });
    await field().waitFor();
    await window.keyboard.type('novo.brief');
    await window.keyboard.press('Enter');

    await expect
      .poll(rows, { timeout: 10_000 })
      .toEqual(['briefs', 'velho', 'logo.png', 'novo.brief']);
    expect(existsSync(join(work, 'novo.brief'))).toBe(true);
    await expect.poll(tabs, { timeout: 10_000 }).toContain('novo.brief');
    const offered = await app!.evaluate(
      () => (globalThis as { offered?: string[][] }).offered ?? [],
    );
    expect(offered.at(-1)).toEqual(['New File…', 'New Folder…']);
  }, 30_000);

  it('opens the menu from the keyboard under the row, once per key (TYTO-364)', async () => {
    // A popup that records what it was asked, and where, and picks `pick` (none past the end).
    const stub = (pick: number) =>
      app!.evaluate(({ Menu }, index) => {
        const store = globalThis as {
          keyed?: { labels: string[]; x: number | undefined; y: number | undefined }[];
        };
        store.keyed = [];
        Menu.prototype.popup = function popup(this: Electron.Menu, options) {
          store.keyed!.push({
            labels: this.items.map((item) => item.label),
            x: options?.x,
            y: options?.y,
          });
          options?.callback?.();
          setTimeout(() => {
            this.items[index]?.click();
          }, 20);
        };
      }, pick);
    const keyed = () =>
      app!.evaluate(
        () =>
          (
            globalThis as {
              keyed?: { labels: string[]; x: number | undefined; y: number | undefined }[];
            }
          ).keyed ?? [],
      );
    const under = async (name: string): Promise<{ x: number; y: number }> => {
      const zoom = await app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
      );
      const box = await row(name).evaluate((each) => each.getBoundingClientRect().toJSON());
      const { left, bottom } = box as { left: number; bottom: number };
      return { x: Math.round(left * zoom), y: Math.round(bottom * zoom) };
    };
    const rowItems = ['New File…', 'New Folder…', 'Rename…', 'Delete'];

    await stub(99);
    await row('logo.png').click();
    await row('logo.png').focus();
    await window.keyboard.press('Shift+F10');
    await expect.poll(keyed).toHaveLength(1);
    // The window hears the answer after main's 50 ms grace; a key before it finds a menu open.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await window.keyboard.press('ContextMenu');
    await expect.poll(keyed).toHaveLength(2);
    // Chromium's own contextmenu after the key, on key up on Windows, asks for no third.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const seen = await keyed();
    process.stdout.write(`[TYTO-364] menus asked from the keyboard: ${JSON.stringify(seen)}
`);
    const at = await under('logo.png');
    expect(seen).toEqual([
      { labels: rowItems, ...at },
      { labels: rowItems, ...at },
    ]);

    await stub(0);
    await row('logo.png').focus();
    await window.keyboard.press('Shift+F10');
    await field().waitFor();
    expect(await field().evaluate((each) => each === document.activeElement)).toBe(true);
    await window.keyboard.press('Escape');
    await expect.poll(() => field().count()).toBe(0);
    await pickFromMenu(null);
  }, 30_000);

  it('renames an open tab’s file with F2, keeps its text unsaved, and saves to the new path', async () => {
    await row('briefs').click();
    await row('capa.brief').waitFor();
    await row('capa.brief').click();
    await expect.poll(tabs, { timeout: 10_000 }).toContain('capa.brief');
    await window.locator('#editor .cm-content').click();
    await window.keyboard.press('Control+End');
    await window.keyboard.type('::texto Mais\n');
    await expect.poll(tabs).toContain('capa.brief *');

    await row('capa.brief').click();
    await row('capa.brief').focus();
    await window.keyboard.press('F2');
    await field().waitFor();
    await shoot('rename-inline');
    await window.keyboard.press('Control+A');
    await window.keyboard.type('abertura.brief');
    await window.keyboard.press('Enter');

    await expect.poll(rows, { timeout: 10_000 }).toContain('  abertura.brief');
    expect(readdirSync(join(work, 'briefs'))).toEqual(['abertura.brief']);
    await expect.poll(tabs).toContain('abertura.brief *');
    expect(await tabs()).not.toContain('capa.brief *');

    await window.locator('#editor .cm-content').click();
    await run('editor.save');
    await expect
      .poll(() => readFileSync(join(work, 'briefs', 'abertura.brief'), 'utf8'), { timeout: 10_000 })
      .toContain('::texto Mais');
    expect(existsSync(join(work, 'briefs', 'capa.brief'))).toBe(false);
  }, 30_000);

  it('keeps the field and says why when the name is taken', async () => {
    await row('logo.png').click();
    await row('logo.png').focus();
    await window.keyboard.press('F2');
    await field().waitFor();
    await window.keyboard.press('Control+A');
    await window.keyboard.type('novo.brief');
    await window.keyboard.press('Enter');

    await window.locator('.explorer__error').waitFor();
    expect(await window.locator('.explorer__error').textContent()).toBe(
      'A file or folder named “novo.brief” already exists here.',
    );
    expect(await field().inputValue()).toBe('novo.brief');
    await shoot('rename-taken');
    await window.keyboard.press('Escape');
    await expect.poll(() => field().count()).toBe(0);
    expect(existsSync(join(work, 'logo.png'))).toBe(true);
  }, 30_000);

  it('asks before moving a folder to the trash, and its open tab is left in no file', async () => {
    await row('velho').click();
    await row('velho.brief').waitFor();
    await row('velho.brief').click();
    await expect.poll(tabs, { timeout: 10_000 }).toContain('velho.brief');
    const before = (await tabs()).length;

    await pickFromMenu('3');
    await row('velho').click({ button: 'right' });

    await expect.poll(rows, { timeout: 10_000 }).not.toContain('velho');
    expect(existsSync(join(work, 'velho'))).toBe(false);
    expect(readdirSync(bin)).toEqual(['velho']);
    expect(readdirSync(join(bin, 'velho'))).toEqual(['velho.brief']);
    const question = (await asked()).at(-1);
    expect(question?.message).toContain('“velho”');
    expect(question?.message).toMatch(/^Move the folder “velho” and everything in it to the /u);
    const offered = await app!.evaluate(
      () => (globalThis as { offered?: string[][] }).offered ?? [],
    );
    expect(offered.at(-1)).toEqual(['New File…', 'New Folder…', 'Rename…', 'Delete']);

    await expect.poll(tabs).not.toContain('velho.brief');
    expect((await tabs()).length).toBe(before);
  }, 30_000);

  it('folds every folder and opens the New File field from the header (TYTO-365)', async () => {
    const header = window.locator('tyto-explorer-panel .tool__actions');
    const labels = await header
      .locator('button')
      .evaluateAll((buttons) => buttons.map((each) => each.getAttribute('aria-label')));
    expect(labels).toEqual(['New File…', 'New Folder…', 'Collapse All', 'Close the panel']);
    await expect.poll(() => window.locator('[aria-expanded="true"]').count()).toBeGreaterThan(0);

    await header.locator('[data-action="explorer.collapseAll"]').click();
    await expect.poll(() => window.locator('[aria-expanded="true"]').count()).toBe(0);
    expect(await rows()).toEqual(['briefs', 'logo.png', 'novo.brief']);

    await row('briefs').click();
    await header.locator('[data-action="explorer.newFile"]').click();
    await field().waitFor();
    expect(await field().getAttribute('aria-label')).toBe('New File…');
    await window.keyboard.press('Escape');
    await expect.poll(() => field().count()).toBe(0);

    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      const ratio = await window.evaluate(() => globalThis.devicePixelRatio);
      process.stdout.write(`[TYTO-365] devicePixelRatio of the shots: ${String(ratio)}
`);
      // The middle button hovered, as on the approved sheet's mock.
      await header.locator('[data-action="explorer.newFolder"]').hover();
      for (const scheme of ['light', 'dark'] as const) {
        await app!.evaluate(({ nativeTheme }, source) => {
          nativeTheme.themeSource = source;
        }, scheme);
        // scheme: the header's pictures in each theme Rafael compares with the sheet; main is
        // told too.
        await window.emulateMedia({ colorScheme: scheme });
        await window.waitForTimeout(300);
        await window
          .locator('tyto-explorer-panel .pane__strip')
          .screenshot({ path: join(shots, `header-${scheme}.png`) });
        await window.screenshot({ path: join(shots, `header-window-${scheme}.png`) });
      }
      await app!.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = 'system';
      });
      await window.emulateMedia({ colorScheme: null });
    }
  }, 30_000);

  it('asks in Portuguese with Delete, for a file', async () => {
    await run('shell.toggleLocale');
    await window.waitForFunction(() => document.documentElement.lang === 'pt-BR');
    await pickFromMenu(null);

    await row('logo.png').click();
    await row('logo.png').focus();
    await window.keyboard.press('Delete');

    await expect.poll(() => existsSync(join(work, 'logo.png')), { timeout: 10_000 }).toBe(false);
    const question = (await asked()).at(-1);
    process.stdout.write(`[TYTO-352] pt-BR question: ${JSON.stringify(question)}\n`);
    expect(question).toMatchObject({
      message: 'Mover “logo.png” para a Lixeira?',
      detail: 'Dá para restaurar de lá.',
      buttons: ['Cancelar', 'Mover para a Lixeira'],
    });
    expect(readdirSync(bin).sort()).toEqual(['logo.png', 'velho']);
    await shoot('after-delete-pt-BR');
  }, 30_000);
});
