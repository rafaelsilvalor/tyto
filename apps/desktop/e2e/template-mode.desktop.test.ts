import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * The template mode (TYTO-44, E9.5) through a real window: a template folder open beside every
 * format it draws, a save, and a brief in the tab behind it redrawn.
 *
 * The card's three criteria are the three middle tests. The rest is what only a window can say:
 * that the mode draws what the brief preview draws — the same HTML, byte for byte — and that a
 * code template is refused with a sentence rather than opened.
 *
 * **Its own user-data folder and its own template folder.** The folder is a copy of the built-in
 * `promo-curso`, chosen through `settings.json` the way a person's choice is remembered
 * (TYTO-122), so a save writes to a scratch copy and never to the repository's pack — and it
 * shadows the built-in one, so a brief naming `promo-curso` renders with *this* folder.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const pack = join(
  dirname(createRequire(import.meta.url).resolve('@tyto/templates/package.json')),
  'templates',
);

let scratch: string;
let mine: string;
let folder: string;
let app: ElectronApplication;
let page: Page;

/** The colour the tests write into the title, which nothing in the pack uses. */
const GREEN = '#00ff00';

const gridHtml = (): Promise<readonly string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.template-mode__frame')].map(
      (frame) => frame.getAttribute('srcdoc') ?? '',
    ),
  );

const gridFormats = (): Promise<readonly string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.template-mode__cell')].map(
      (cell) => cell.getAttribute('data-format') ?? '',
    ),
  );

const briefPreview = (): Promise<string> =>
  page.evaluate(() => document.getElementById('preview-frame')?.getAttribute('srcdoc') ?? '');

/** Answers the next folder picker with `directory`, the way a person choosing it would. */
const pickNext = (directory: string): Promise<void> =>
  app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (() =>
      Promise.resolve({ canceled: false, filePaths: [chosen] })) as never;
  }, directory);

/** A File-menu pick, sent the way `menu.ts` sends one. */
const runCommand = (id: string): Promise<void> =>
  app.evaluate(({ BrowserWindow }, command) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('command:run', { id: command });
  }, id);

/** Replaces a tab's whole text, as a select-all and a paste would. */
async function replaceBuffer(buffer: 'manifest' | 'markup', text: string): Promise<void> {
  await page.evaluate((name) => {
    document.querySelector<HTMLElement>(`[data-buffer-tab="${name}"]`)?.click();
  }, buffer);
  await page.click(`[data-buffer="${buffer}"] .cm-content`);
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

const originalMarkup = (): string =>
  readFileSync(join(pack, 'promo-curso', 'template.html'), 'utf8');
const originalManifest = (): string =>
  readFileSync(join(pack, 'promo-curso', 'manifest.yaml'), 'utf8');
const greenMarkup = (): string => {
  const markup = originalMarkup();
  // The title's own rule, and only it: `color: white` appears once per text class.
  const edited = markup.replace(
    /(\.title \{[^}]*?color: )white;/u,
    (_match, head: string) => `${head}${GREEN};`,
  );
  if (edited === markup) throw new Error('the title rule in promo-curso moved; update this test');
  return edited;
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(`${built} is missing — run \`pnpm build\` before this suite`);
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-template-mode-'));
  mine = join(scratch, 'mine');
  folder = join(mine, 'promo-curso');
  cpSync(join(pack, 'promo-curso'), folder, { recursive: true });

  const userData = join(scratch, 'userData');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ templatesFolder: mine }));

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('#editor .cm-content') !== null);
  await page.waitForSelector('.tabs__tab');

  // The brief in the tab behind the mode, naming the template the mode is about to edit.
  await page.click('#editor .cm-content');
  await page.keyboard.insertText(readFileSync(join(folder, 'examples', 'promo.brief'), 'utf8'));
  await page.waitForFunction(
    () => document.getElementById('preview-frame')?.getAttribute('srcdoc')?.includes('Direito'),
    undefined,
    { timeout: 15_000 },
  );
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the template mode', () => {
  it('opens a folder beside every format its manifest declares', async () => {
    await pickNext(folder);
    await runCommand('template.edit');

    await page.waitForSelector('tyto-template-mode[open]');
    await expect.poll(gridFormats, { timeout: 15_000 }).toEqual(['feed', 'story']);
    expect(await page.textContent('[data-testid="template-folder"]')).toBe(folder);
    // Both tabs, and the sample the folder carries.
    const tabs = await page.locator('[data-buffer-tab]').allTextContents();
    expect(tabs.map((tab) => tab.trim())).toEqual(['manifest.yaml', 'template.html']);
    expect(await page.locator('[data-testid="template-example"] option').allTextContents()).toEqual(
      [expect.stringContaining('promo.brief')],
    );
  });

  it('draws what the brief preview draws, byte for byte', async () => {
    // The mode compiles its own buffers along its own path in main; if the two disagreed, the
    // mode would be a second renderer and the one that lied. The brief behind asks for both
    // formats, so its preview can be pointed at each in turn.
    const grid = await gridHtml();
    for (const [index, format] of ['feed', 'story'].entries()) {
      await page.evaluate((wanted) => {
        document.querySelector<HTMLElement>(`.preview__tab[data-format="${wanted}"]`)?.click();
      }, format);
      await expect.poll(briefPreview).toBe(grid[index]);
    }
  });

  it('updates every format when the CSS in template.html changes, before any save', async () => {
    // First acceptance criterion.
    const before = await gridHtml();
    expect(before.every((html) => !html.includes(GREEN))).toBe(true);

    await replaceBuffer('markup', greenMarkup());

    await expect
      .poll(async () => (await gridHtml()).map((html) => html.includes(GREEN)), { timeout: 10_000 })
      .toEqual([true, true]);
    // The buffer, not the file: nothing was written, and the tab says so.
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(originalMarkup());
    expect(await page.locator('[data-buffer-tab="markup"] .template-mode__dirty').count()).toBe(1);
  });

  it('refuses to save a manifest error, and shows the diagnostic that stopped it', async () => {
    // Second acceptance criterion.
    await replaceBuffer('manifest', 'name: promo-curso\nslots: [not a mapping]\n');
    await page.click('[data-testid="template-save"]');

    await expect
      .poll(() => page.getAttribute('[data-testid="template-notice"]', 'data-notice'))
      .toBe('refused');
    const rows = page.locator('.template-mode__problem-row[data-file="manifest"]');
    expect(await rows.count()).toBeGreaterThan(0);
    expect(await rows.first().getAttribute('data-code')).toMatch(/^E_MANIFEST_/u);
    // Neither file moved: a refused save writes nothing, the markup included.
    expect(readFileSync(join(folder, 'manifest.yaml'), 'utf8')).toBe(originalManifest());
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(originalMarkup());
  });

  it('redraws the brief open in the other tab once the template is saved', async () => {
    // Third acceptance criterion. The brief behind has not been touched since it was typed, so
    // the only thing that can turn its title green is the save.
    expect(await briefPreview()).not.toContain(GREEN);

    await replaceBuffer('manifest', originalManifest());
    await page.keyboard.press('Control+S');

    await expect
      .poll(() => page.getAttribute('[data-testid="template-notice"]', 'data-notice'), {
        timeout: 10_000,
      })
      .toBe('saved');
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(greenMarkup());
    await expect.poll(briefPreview, { timeout: 10_000 }).toContain(GREEN);
    expect(await page.locator('.template-mode__dirty').count()).toBe(0);
  });

  it('re-registers the manifest too, which is the half the picture above cannot show', async () => {
    // Measured, not assumed: with the reload taken out of `save`, the test above stays green.
    // A brief's compile reads `template.html` off the disk every time, so a markup edit reaches
    // it with no re-registration at all — it is the *manifest* that lives in the registry. So
    // the manifest is what this one changes: `titulo` capped below what the brief behind says.
    const brief = page.locator('.problems__code');
    expect(await brief.allTextContents()).not.toContain('E_BAD_SLOT_VALUE');

    await replaceBuffer('manifest', originalManifest().replace('max: 80', 'max: 5'));
    await page.keyboard.press('Control+S');

    await expect
      .poll(() => brief.allTextContents(), { timeout: 10_000 })
      .toContain('E_BAD_SLOT_VALUE');

    // And back, so the manifest on disk is the pack's again for the tests below.
    await replaceBuffer('manifest', originalManifest());
    await page.keyboard.press('Control+S');
    await expect
      .poll(() => brief.allTextContents(), { timeout: 10_000 })
      .not.toContain('E_BAD_SLOT_VALUE');
  });

  it('says plainly that a code template cannot be edited here', async () => {
    const code = join(scratch, 'codigo');
    mkdirSync(code, { recursive: true });
    writeFileSync(join(code, 'manifest.yaml'), originalManifest().replace('promo-curso', 'codigo'));
    writeFileSync(join(code, 'template.ts'), 'throw new Error("never run");\n');

    await pickNext(code);
    await page.click('.template-mode__open');

    await page.waitForSelector('[data-testid="template-refusal"]');
    expect(await page.textContent('[data-testid="template-refusal"]')).toContain('template.ts');
    expect(await page.locator('.template-mode__work').isVisible()).toBe(false);
  });

  it('scaffolds a new template into the template folder and draws it at once', async () => {
    await page.fill('[data-testid="template-new-name"]', 'novo');
    await page.press('[data-testid="template-new-name"]', 'Enter');

    await expect.poll(gridFormats, { timeout: 15_000 }).toEqual(['feed', 'story']);
    expect(existsSync(join(mine, 'novo', 'manifest.yaml'))).toBe(true);
    expect(existsSync(join(mine, 'novo', 'examples', 'novo.brief'))).toBe(true);
    expect(
      await page.locator('.template-mode__problem-row--error').count(),
      await page.locator('[data-testid="template-problems"]').innerText(),
    ).toBe(0);
  });

  it('closes back onto the briefs, which were there all along', async () => {
    await page.click('[data-testid="template-close"]');

    await expect.poll(() => page.locator('tyto-template-mode[open]').count()).toBe(0);
    expect(await page.locator('#editor .cm-content').isVisible()).toBe(true);
  });
});
