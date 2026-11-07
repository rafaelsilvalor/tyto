import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A plugin the plugin files fetch, contributing a panel to the running window (TYTO-466).
 *
 * The repository is made here and named by a `plugin:` entry in this suite's own `TYTO_HOME`,
 * through a `file://` address, so nothing reaches the network. Its `v1` adds a panel; moving
 * the entry to `v2`, which adds another, starts the fetched set again, and the window must
 * drop the first panel and its command and offer the second. The rules (precedence, every
 * extension point, the withdrawal) are unit-tested in `src/main/window-plugins.test.ts`.
 *
 * `TYTO_HOME` and `--user-data-dir` are this suite's own (TYTO-150).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const PLUGIN = 'painel-baixado';
const FIRST = `plugin:${PLUGIN}/primeiro`;
const SECOND = `plugin:${PLUGIN}/segundo`;
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let scratch: string;
let repository: string;
let home: string;
let app: ElectronApplication;
let page: Page;

/** Commits a version of the plugin whose one panel is `panel`, and tags it. */
function release(panel: string, tag: string): void {
  writeFileSync(
    join(repository, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerPanel({ id: '${panel}', title: '${panel}', location: 'bottom', entry: 'panel/index.html' });
}
`,
  );
  execFileSync('git', [...AUTHOR, '-C', repository, 'add', '.']);
  execFileSync('git', [...AUTHOR, '-C', repository, 'commit', '--quiet', '-m', tag]);
  execFileSync('git', [...AUTHOR, '-C', repository, 'tag', tag]);
}

/** The machine's plugin file, naming the repository at `ref`. */
function pluginFile(ref: string): void {
  writeFileSync(
    join(home, 'plugin-files', 'painel.yaml'),
    [
      'version: 1',
      'plugin:',
      `  source: { git: '${pathToFileURL(repository).href}', ref: '${ref}' }`,
      '',
    ].join('\n'),
    'utf8',
  );
}

/** Whether the command bar offers `id` now; the bar is closed again either way. */
async function offered(id: string): Promise<boolean> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(100);
  const found = (await page.locator('.command-bar__option').count()) > 0;
  await page.keyboard.press('Escape');
  return found;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-fetched-panel-'));
  home = join(scratch, 'home');
  repository = join(scratch, 'repositories', PLUGIN);
  mkdirSync(join(repository, 'dist'), { recursive: true });
  mkdirSync(join(repository, 'panel'), { recursive: true });
  writeFileSync(
    join(repository, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['panel'],
      permissions: [],
    }),
  );
  writeFileSync(join(repository, 'package.json'), JSON.stringify({ name: PLUGIN, type: 'module' }));
  writeFileSync(
    join(repository, 'panel', 'index.html'),
    '<!doctype html><meta charset="utf-8"><h1>Baixado</h1>',
  );
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repository]);
  release('primeiro', 'v1');
  release('segundo', 'v2');

  mkdirSync(join(home, 'plugin-files'), { recursive: true });
  pluginFile('v1');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a fetched plugin in the window', () => {
  it('adds its panel, served from the fetched copy', async () => {
    // The panel arrives once the sync has fetched and started the plugin; its command with it.
    await expect
      .poll(() => offered(`layout.togglePanel:${FIRST}`), { timeout: 30_000, interval: 300 })
      .toBe(true);
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type(`layout.togglePanel:${FIRST}`);
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`[data-panel="${FIRST}"] iframe`, { timeout: 10_000 });

    // The page is the copy's file: the panel's frame loads it from `tyto-plugin://`.
    const ours = () =>
      page.frames().find((each) => each.url().startsWith(`tyto-plugin://${PLUGIN}/`));
    await expect.poll(() => ours() !== undefined, { timeout: 10_000 }).toBe(true);
    const frame = ours()!;
    await frame.waitForSelector('h1', { timeout: 10_000 });
    expect(await frame.textContent('h1')).toBe('Baixado');
  }, 60_000);

  it('drops the old panel and offers the new one when a sync starts the set again', async () => {
    pluginFile('v2');
    await page.evaluate(() =>
      (window as unknown as { tyto: Record<string, (body: unknown) => Promise<unknown>> }).tyto[
        'plugin-files:sync'
      ]!({ update: false }),
    );

    await page.waitForFunction(
      (id) => document.querySelector(`[data-panel="${id}"]`) === null,
      FIRST,
      { timeout: 15_000 },
    );
    await expect
      .poll(() => offered(`layout.togglePanel:${SECOND}`), { timeout: 15_000, interval: 300 })
      .toBe(true);
    expect(await offered(`layout.togglePanel:${FIRST}`)).toBe(false);
  }, 60_000);
});
