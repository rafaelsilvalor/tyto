import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The status bar, through a real window (TYTO-248, ADR 0076).
 *
 * `status-bar.test.ts` draws the bar in jsdom and `shared/layout.test.ts` holds the area
 * toggle as a value. What only a launched app can answer is this file: that a click reaches
 * the registry and changes the window, that a hidden area is still hidden after a restart,
 * that vim's mode is said once, and — the card's measured rule — that the bar is one line at
 * 900x600, which needs layout.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let scratch: string;
let app: ElectronApplication;
let page: Page;

async function launch(): Promise<void> {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('tyto-status-bar .status-bar__button');
}

const click = async (command: string): Promise<void> => {
  await page.click(`tyto-status-bar [data-command="${command}"]`);
  await page.waitForTimeout(300);
};

const isOn = (command: string): Promise<boolean> =>
  page.evaluate(
    (id) =>
      document
        .querySelector(`tyto-status-bar [data-command="${id}"]`)
        ?.classList.contains('status-bar__button--on') ?? false,
    command,
  );

const panels = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-panel]')].map((node) => node.getAttribute('data-panel')!),
  );

const text = (selector: string): Promise<string> =>
  page.evaluate((found) => document.querySelector(found)?.textContent?.trim() ?? '', selector);

/** Whether a Lit dialog or bar says it is open, read as the property the element declares. */
const isOpen = (tag: string): Promise<boolean> =>
  page.evaluate(
    (name) => (document.querySelector(name) as unknown as { open?: boolean } | null)?.open === true,
    tag,
  );

const shut = (tag: string): Promise<void> =>
  page.evaluate((name) => {
    (document.querySelector(name) as unknown as { open: boolean }).open = false;
  }, tag);

const typeBrief = async (brief: string): Promise<void> => {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(brief);
  // A completion list opened by the last line would cover the next click.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
};

/** The bar's box, and whether every control in it sits on the same row. */
const barShape = (): Promise<{ height: number; rows: number }> =>
  page.evaluate(() => {
    const foot = document.querySelector('.shell__foot')!;
    const items = [...foot.querySelectorAll('.status-bar__button, .status-bar__text')];
    const centres = new Set(
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return Math.round(box.top + box.height / 2);
      }),
    );
    return { height: foot.getBoundingClientRect().height, rows: centres.size };
  });

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-status-bar-'));
  await launch();
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the status bar at 900x600', () => {
  it('is one line with its longest content: a long template, a selection, an update', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(900, 600);
    });
    await page.waitForFunction(() => window.innerWidth === 900);
    await typeBrief('---\ntemplate: um-template-de-nome-muito-comprido-para-a-barra\n---\n');
    await page.keyboard.press('Control+A');
    // The longest notice the bar can carry, in Portuguese, painted the way `update-notice.ts`
    // paints it: the case where the bar has less room than it needs.
    await page.evaluate(() => {
      const notice = document.getElementById('update-notice')!;
      notice.textContent = 'Versão 10.10.10 pronta — Reiniciar para atualizar';
      notice.hidden = false;
    });

    const shape = await barShape();
    process.stdout.write(`[TYTO-248] bar at 900x600: ${JSON.stringify(shape)}\n`);
    await page.evaluate(() => {
      document.getElementById('update-notice')!.hidden = true;
    });

    expect(shape.rows).toBe(1);
    // One row of 16px icons and their padding; a second line of text would at least double it.
    expect(shape.height).toBeLessThan(30);
  });
});

describe('the facts', () => {
  it('follows the cursor and the selection', async () => {
    await typeBrief('linha um\nlinha dois');
    expect(await text('.status-bar__position')).toMatch(/^(Ln|Lin) 2, Col 11$/u);

    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    expect(await text('.status-bar__position')).toMatch(/^(Ln|Lin) 2, Col 9 \(2 /u);
  });

  it('names the template the brief names', async () => {
    await typeBrief('---\ntemplate: promo-curso\n---\n');
    expect(await text('.status-bar__template')).toBe('promo-curso');
  });

  it('counts the problems inside the problems button as they change', async () => {
    const count = 'tyto-status-bar .status-bar__count';
    await typeBrief('---\ntemplate: promo-curso\n---\n::titulo Direito\n');
    await page.waitForTimeout(800);
    const clean = Number(await text(count));

    await typeBrief('---\ntemplate: nao-existe\n---\n::titulo Direito\n');
    await page.waitForFunction(
      ([selector, before]) =>
        Number(document.querySelector(selector!)?.textContent) > Number(before),
      [count, String(clean)],
    );
    expect(Number(await text(count))).toBeGreaterThan(clean);
  });
});

describe('vim', () => {
  it('shows the mode in the bar and nowhere else', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('editor.toggleVim');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForSelector('tyto-status-bar .status-bar__vim');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Escape');

    expect(await text('tyto-status-bar .status-bar__vim')).toBe('NORMAL');
    // Said once: the library's own status line is off (`vimStatus: false`).
    expect(await page.evaluate(() => document.querySelector('.cm-vim-panel'))).toBeNull();
    const said = await page.evaluate(
      () => (document.body.innerText.match(/NORMAL/gu) ?? []).length,
    );
    expect(said).toBe(1);

    await page.keyboard.press('d');
    await page.waitForTimeout(150);
    expect(await text('tyto-status-bar .status-bar__pending')).toBe('d');
    await page.keyboard.press('Escape');
  });
});

describe('each button runs its command', () => {
  it('hides and shows the whole bottom area, and the problems panel with it', async () => {
    expect(await isOn('layout.toggleDock:bottom')).toBe(true);
    await click('layout.toggleDock:bottom');
    expect(await panels()).not.toContain('problems');
    expect(await isOn('layout.toggleDock:bottom')).toBe(false);
    expect(await isOn('layout.togglePanel:problems')).toBe(false);

    await click('layout.toggleDock:bottom');
    expect(await panels()).toContain('problems');
    expect(await isOn('layout.togglePanel:problems')).toBe(true);
  });

  it('hides and shows the right area', async () => {
    await click('layout.toggleDock:right');
    expect(await panels()).not.toContain('preview');
    await click('layout.toggleDock:right');
    expect(await panels()).toContain('preview');
  });

  it('opens the empty left area on its first panel, the queue', async () => {
    expect(await isOn('layout.toggleDock:left')).toBe(false);
    await click('layout.toggleDock:left');
    expect(await panels()).toContain('queue');
    expect(await isOn('layout.toggleDock:left')).toBe(true);
    expect(await isOn('layout.togglePanel:queue')).toBe(true);

    await click('layout.togglePanel:queue');
    expect(await panels()).not.toContain('queue');
  });

  it('toggles the problems panel', async () => {
    await click('layout.togglePanel:problems');
    expect(await panels()).not.toContain('problems');
    await click('layout.togglePanel:problems');
    expect(await panels()).toContain('problems');
  });

  it('opens the command bar, the plugins screen and the export dialog', async () => {
    await click('commandBar.toggle');
    expect(await isOpen('tyto-command-bar')).toBe(true);
    await page.keyboard.press('Escape');

    await click('plugins.show');
    expect(await isOpen('tyto-plugins-dialog')).toBe(true);
    await shut('tyto-plugins-dialog');

    await click('file.export');
    expect(await isOpen('tyto-export-dialog')).toBe(true);
    await shut('tyto-export-dialog');
  });

  it('opens settings.json in a tab, and the bar says what kind of tab it is', async () => {
    const lang = await page.evaluate(() => document.documentElement.lang);
    await click('settings.open');
    await page.waitForFunction(
      (wanted) => document.querySelector('.status-bar__kind')?.textContent?.trim() === wanted,
      lang === 'en' ? 'Settings' : 'Configurações',
    );
    expect(await page.evaluate(() => document.querySelector('.status-bar__template'))).toBeNull();
  });
});

describe('Help > About', () => {
  it('says what the footer used to: the version, the platform and the template folder', async () => {
    const detail = await app.evaluate(async ({ Menu, dialog }) => {
      const seen: string[] = [];
      const original = dialog.showMessageBox;
      dialog.showMessageBox = ((...args: unknown[]) => {
        const options = args.find(
          (arg) => typeof arg === 'object' && arg !== null && 'detail' in arg,
        );
        seen.push((options as { detail: string } | undefined)?.detail ?? '');
        return Promise.resolve({ response: 0, checkboxChecked: false });
      }) as typeof dialog.showMessageBox;
      Menu.getApplicationMenu()?.getMenuItemById('about')?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      dialog.showMessageBox = original;
      return seen.join('|');
    });
    const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version: string;
    };

    expect(detail).toContain(manifest.version);
    expect(detail).toContain(process.platform);
    expect(detail.split('\n')).toHaveLength(4);
  });
});

describe('a hidden area after a restart', () => {
  it('is still hidden, because layout.json remembers it', async () => {
    await click('layout.toggleDock:right');
    expect(await panels()).not.toContain('preview');
    await closeApp(app);

    const saved = JSON.parse(readFileSync(join(scratch, 'user-data', 'layout.json'), 'utf8')) as {
      hiddenDocks?: string[];
    };
    expect(saved.hiddenDocks).toEqual(['right']);

    await launch();
    expect(await panels()).not.toContain('preview');
    expect(await isOn('layout.toggleDock:right')).toBe(false);

    await click('layout.toggleDock:right');
    expect(await panels()).toContain('preview');
  });
});
