import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { previewPart, previewSrcdoc } from './preview-pane.js';

/**
 * A Markdown file's preview, in the real window (TYTO-247, ADR 0132): opening a `.md` opens no
 * preview by itself; "Open preview to the side" shows the file drawn, follows typing, and follows
 * another `.md` brought to the front; the status bar draws no Export with a text file in front.
 *
 * **What the preview draws reaches nothing**, measured against a local server that counts what
 * reaches it (ADR 0124 §8): the file holds a Markdown image, a raw `<img>` and a link this suite
 * clicks, all at the server, and the preview asks for none of them (0 of 3). The control is the
 * HTML a renderer that kept them would write, in a window of its own with no sandbox and no CSP,
 * where all three arrive (3 of 3): without it a 0 would prove only that the server was not
 * reachable. The preview's own document is then put in that same open window, where it still
 * reaches nothing: the first layer, `markdownToHtml`, holds alone.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, and a folder of its own; `--lang=en`. With
 * `TYTO_MARKDOWN_SHOTS` set to a folder it leaves pictures of the window in both themes.
 */

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env['TYTO_MARKDOWN_SHOTS'];

let scratch: string;
let work: string;
let app: ElectronApplication | undefined;
let window: Page;
let server: Server;
let origin: string;
const hits = { x: 0, y: 0, z: 0 };

const NOTES = [
  '# Notas da campanha',
  '',
  'Texto com *ênfase*, **força**, ~~riscado~~ e `código`.',
  '',
  '> Uma citação.',
  '',
  '- [x] Capa aprovada',
  '- [ ] Story',
  '',
  '| Peça | Formato |',
  '| --- | --- |',
  '| Capa | 1080 × 1080 |',
  '| Story | 1080 × 1920 |',
  '',
].join('\n');

const hostile = (at: string): string =>
  ['# Hostil', '', `![x](${at}/x.png)`, '', `<img src="${at}/y.png">`, '', `[z](${at}/z)`, ''].join(
    '\n',
  );

/** What a renderer that kept images, raw HTML and links would write for {@link hostile}. */
const unsanitised = (at: string): string =>
  '<!doctype html><html><body>' +
  `<h1>Hostil</h1><p><img alt="x" src="${at}/x.png"></p>` +
  `<img src="${at}/y.png"><p><a href="${at}/z">z</a></p>` +
  '</body></html>';

async function run(commandId: string): Promise<boolean> {
  return window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
}

const row = (name: string) => window.locator(`.explorer__row[data-name="${name}"]`);

const tabNames = (): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

const previewTabs = (): Promise<number> => window.locator('[data-tab-kind="preview"]').count();

const exportButtons = (): Promise<number> =>
  window.locator('tyto-status-bar [data-command="file.export"]').count();

/** Opens a file from the explorer; the window refuses opens until it has read its session. */
async function open(name: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await row(name).click();
        return tabNames();
      },
      { timeout: 15_000 },
    )
    .toContain(name);
  await window.locator('.tabs__tab', { hasText: name }).first().click();
}

/** Loads `html` in a window with no sandbox and no CSP, clicks its first link, and closes it. */
async function inOpenWindow(html: string): Promise<void> {
  await app?.evaluate(async ({ BrowserWindow }, page) => {
    const probe = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
    await probe.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await probe.webContents.executeJavaScript('document.querySelector("a")?.click(); true');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    probe.destroy();
  }, html);
}

/** Screenshots in both schemes, when asked for; the window is left light. */
async function shoot(name: string): Promise<void> {
  if (shots === undefined || app === undefined) return;
  mkdirSync(shots, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, scheme);
    // scheme: the screenshot in each theme Rafael approves by looking; main is told too.
    await window.emulateMedia({ colorScheme: scheme });
    await window.waitForTimeout(500);
    await window.screenshot({ path: join(shots, `${name}-${scheme}.png`) });
  }
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'system';
  });
  await window.emulateMedia({ colorScheme: null });
}

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/x.png') hits.x += 1;
    if (request.url === '/y.png') hits.y += 1;
    if (request.url === '/z') hits.z += 1;
    response.writeHead(200, { 'access-control-allow-origin': '*' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  scratch = mkdtempSync(join(tmpdir(), 'tyto-markdown-preview-e2e-'));
  work = join(scratch, 'promo');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'notas.md'), NOTES);
  writeFileSync(join(work, 'hostil.md'), hostile(origin));
  writeFileSync(join(work, 'leia.txt'), 'Leia antes.\n');
  writeFileSync(join(work, 'capa.brief'), '---\ntemplate: promo-curso\n---\n::titulo Capa\n');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, work);
  if (!(await run('workspace.openFolder'))) throw new Error('workspace.openFolder was refused');
  await row('notas.md').waitFor({ timeout: 15_000 });
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  await new Promise((resolve) => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
});

describe('a Markdown file in the preview (TYTO-247)', () => {
  it('opens a .md with no preview, and colours it as Markdown', async () => {
    await open('notas.md');
    await window.waitForFunction(() =>
      document.querySelector('#editor .cm-content')?.textContent?.includes('Notas da campanha'),
    );
    await window.waitForTimeout(500);
    expect(await previewTabs()).toBe(0);
    // The heading is coloured by the Markdown grammar: a styled span holds it.
    const heading = await window.evaluate(() =>
      [...document.querySelectorAll('#editor .cm-line span')].some((span) =>
        span.textContent?.includes('Notas da campanha'),
      ),
    );
    expect(heading).toBe(true);
    expect(await window.locator('[data-action="preview.openToSide"]').count()).toBe(1);
  }, 120_000);

  it('draws no Export button with a .md or a .txt in front, and one with a brief', async () => {
    expect(await exportButtons()).toBe(0);
    await open('leia.txt');
    await expect.poll(exportButtons).toBe(0);
    expect(await window.locator('[data-action="preview.openToSide"]').count()).toBe(0);
    await open('capa.brief');
    await expect.poll(exportButtons).toBe(1);
    await open('notas.md');
    await expect.poll(exportButtons).toBe(0);
  }, 120_000);

  it('shows the file drawn through "Open preview to the side", and follows typing', async () => {
    await window.locator('[data-action="preview.openToSide"]').first().click();
    await expect.poll(previewTabs, { timeout: 10_000 }).toBe(1);
    await expect
      .poll(() => previewSrcdoc(window), { timeout: 10_000 })
      .toContain('<h1>Notas da campanha</h1>');
    const srcdoc = await previewSrcdoc(window);
    expect(srcdoc).toContain('<table><thead><tr><th>Peça</th>');
    expect(srcdoc).toContain('<input type="checkbox" disabled checked>Capa aprovada');
    expect(srcdoc).toContain('<del>riscado</del>');
    expect(await window.textContent(previewPart('info'))).toBe('notas.md');
    // No formats, no strip, no zoom: a note has none.
    expect(await window.locator(previewPart('formats')).isHidden()).toBe(true);
    expect(await window.locator(previewPart('zoom-group')).isHidden()).toBe(true);
    // The status bar has no Export on the preview either.
    await window.locator('.tabs__tab[data-tab-kind="preview"]').first().click();
    await expect.poll(exportButtons).toBe(0);

    await window.locator('.tabs__tab', { hasText: 'notas.md' }).first().click();
    await window.click('#editor .cm-content');
    await window.keyboard.press('Control+End');
    await window.keyboard.type('\n**Nova linha**');
    await expect
      .poll(() => previewSrcdoc(window), { timeout: 10_000 })
      .toContain('<strong>Nova linha</strong>');
    await shoot('markdown-preview');
  }, 120_000);

  it('follows another .md brought to the front', async () => {
    await open('hostil.md');
    await expect
      .poll(() => previewSrcdoc(window), { timeout: 10_000 })
      .toContain('<h1>Hostil</h1>');
  }, 60_000);

  it('reaches nothing: no image, no raw <img>, and a clicked link goes nowhere', async () => {
    const srcdoc = await previewSrcdoc(window);
    // A tag that loads or links; the escaped source text has no `<` to start one.
    expect(srcdoc).not.toMatch(/<[^>]*\s(?:src|href)=/u);
    await window
      .frameLocator(previewPart('frame'))
      .locator('a', { hasText: 'z' })
      .click({ timeout: 10_000 });
    await window.waitForTimeout(1500);
    process.stdout.write(`[TYTO-247] hits from the preview: ${JSON.stringify(hits)}\n`);
    expect(hits).toEqual({ x: 0, y: 0, z: 0 });
  }, 60_000);

  it('the control: what an unsanitising renderer would write, with no sandbox and no CSP, reaches all three', async () => {
    await inOpenWindow(unsanitised(origin));
    await expect.poll(() => ({ ...hits }), { timeout: 10_000 }).toEqual({ x: 1, y: 1, z: 1 });
    process.stdout.write(`[TYTO-247] hits from the control: ${JSON.stringify(hits)}\n`);
  }, 60_000);

  it("the preview's own document, in that open window, still reaches nothing", async () => {
    const before = { ...hits };
    await inOpenWindow(await previewSrcdoc(window));
    await window.waitForTimeout(500);
    process.stdout.write(
      `[TYTO-247] hits from the preview's document unsandboxed: ${JSON.stringify(hits)}\n`,
    );
    expect(hits).toEqual(before);
  }, 60_000);
});
