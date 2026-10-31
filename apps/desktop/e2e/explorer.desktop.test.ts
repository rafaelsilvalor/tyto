import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { switchingFolder } from './folder-switch.js';
import { firstWindow } from './first-window.js';

/**
 * The explorer in the real window (TYTO-279, ADR 0115): File ▸ Open Folder opens it in the left
 * area above the queue, a folder opens under its row, a brief opens in a tab and a picture opens
 * no tab of text (TYTO-366 shows it in the preview), a file made and a folder deleted outside the app show within the watcher's settle,
 * and a relaunch that brings the folder back leaves the panel as the person left it. Each row
 * and tab draws the icon of its type, and the folder the project's `output` names draws the
 * output folder's (TYTO-282, ADR 0116).
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, and a folder of its own; the picker is answered
 * from main. One launch and one relaunch, inside the 60 s budget (ADR 0105).
 */

const here = dirname(fileURLToPath(import.meta.url));

let scratch: string;
let work: string;
let app: ElectronApplication | undefined;
let window: Page;

async function launch(): Promise<void> {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
}

async function answerFolderPicker(directory: string): Promise<void> {
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, directory);
}

async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

/** The explorer's rows as drawn, indented by level, or `null` while the panel is closed. */
const rows = (): Promise<string[] | null> =>
  window.evaluate(() => {
    const panel = document.querySelector('tyto-explorer-panel');
    if (panel === null) return null;
    return [...panel.querySelectorAll<HTMLElement>('.explorer__row')].map(
      (row) =>
        `${'  '.repeat(Number(row.getAttribute('aria-level')) - 1)}${row.dataset.name ?? ''}`,
    );
  });

const row = (name: string) => window.locator(`.explorer__row[data-name="${name}"]`);

const tabNames = (): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-explorer-e2e-'));
  work = join(scratch, 'promo');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  mkdirSync(join(work, 'briefs'), { recursive: true });
  mkdirSync(join(work, 'old', 'inside'), { recursive: true });
  mkdirSync(join(work, 'saida'), { recursive: true });
  mkdirSync(join(work, 'tipos'), { recursive: true });
  writeFileSync(join(work, '.tyto', 'project.json'), '{ "output": "saida" }\n');
  for (const name of [
    'LEIA-ME.md',
    'dados.json',
    'Inter.woff2',
    'planilha.xlsx',
    'template.html',
  ]) {
    writeFileSync(join(work, 'tipos', name), '');
  }
  writeFileSync(
    join(work, 'briefs', 'capa.brief'),
    '---\ntemplate: promo-curso\n---\n::titulo Capa\n',
  );
  writeFileSync(join(work, 'logo.png'), '');
  writeFileSync(join(work, 'old', 'inside', 'gone.brief'), '::titulo Velho\n');
  await launch();
});

afterAll(async () => {
  if (app !== undefined) await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the explorer (TYTO-279)', () => {
  it('opens with the folder, above the queue, and lists folders first', async () => {
    expect(await rows()).toBeNull();

    await answerFolderPicker(work);
    await switchingFolder(window, () => run('workspace.openFolder'));

    await expect
      .poll(rows, { timeout: 10_000 })
      .toEqual(['.tyto', 'briefs', 'old', 'saida', 'tipos', 'logo.png']);
    const order = await window.evaluate(() =>
      [...(document.querySelector('[data-dock="left"]')?.children ?? [])].map((panel) =>
        panel.getAttribute('data-panel'),
      ),
    );
    expect(order[0]).toBe('explorer');
    expect(await window.locator('[data-item="explorer"]').getAttribute('aria-pressed')).toBe(
      'true',
    );
  }, 30_000);

  it('opens a brief in a tab, and a picture in the preview with no tab of its text', async () => {
    await row('briefs').click();
    await expect.poll(rows).toContain('  capa.brief');
    const before = await tabNames();

    // TYTO-366: a picture shows in the preview, a tab named for the file; this one is empty, so
    // the preview says it cannot be shown (`explorer-image.desktop.test.ts` shows real ones).
    await row('logo.png').click();
    await expect.poll(tabNames, { timeout: 10_000 }).toEqual([...before, 'logo.png']);

    await row('capa.brief').click();
    await expect.poll(tabNames, { timeout: 10_000 }).toContain('capa.brief');
  }, 30_000);

  it('draws each row and tab with the icon of its type (TYTO-282)', async () => {
    await row('tipos').click();
    await expect.poll(rows).toContain('  planilha.xlsx');

    const icons = await window.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.explorer__row')].map((each) => [
          each.dataset.name ?? '',
          [each.dataset.icon, each.querySelector('.explorer__icon svg') !== null],
        ]),
      ),
    );
    expect(icons).toMatchObject({
      '.tyto': ['folder', true],
      briefs: ['folderOpen', true],
      saida: ['folderOutput', true],
      'capa.brief': ['brief', true],
      'logo.png': ['image', true],
      'LEIA-ME.md': ['text', true],
      'dados.json': ['json', true],
      'Inter.woff2': ['font', true],
      'template.html': ['templateHtml', true],
      'planilha.xlsx': ['file', true],
    });
    const tabIcons = await window.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.tabs__tab .tabs__icon')].map(
        (each) => each.dataset.icon,
      ),
    );
    expect(tabIcons).toContain('brief');

    await row('tipos').click();
    await expect.poll(rows).not.toContain('  planilha.xlsx');
  }, 30_000);

  it('shows a file made outside and drops a folder deleted outside', async () => {
    await row('old').click();
    await row('inside').click();
    await expect.poll(rows).toContain('    gone.brief');

    writeFileSync(join(work, 'briefs', 'nova.brief'), '::titulo Nova\n');
    rmSync(join(work, 'old'), { recursive: true, force: true });

    await expect
      .poll(rows, { timeout: 10_000 })
      .toEqual(['.tyto', 'briefs', '  capa.brief', '  nova.brief', 'saida', 'tipos', 'logo.png']);
  }, 30_000);

  it('hides from its status-bar button, and stays hidden when the folder comes back', async () => {
    await window.locator('[data-item="explorer"]').click();
    await expect.poll(rows).toBeNull();

    await closeApp(app);
    app = undefined;
    await launch();

    // The folder is back (its name in the title), the panel is not: a restore keeps the layout.
    await expect.poll(() => window.title(), { timeout: 15_000 }).toContain('promo');
    expect(await rows()).toBeNull();

    await run('layout.togglePanel:explorer');
    await expect.poll(rows, { timeout: 10_000 }).toContain('briefs');
  }, 60_000);
});
