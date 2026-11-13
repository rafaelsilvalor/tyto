import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '@tyto/command-line';
import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { switchingFolder } from './folder-switch.js';

/**
 * A recipe's `call` credential stored and forgotten from the plugins screen, in the real window
 * (TYTO-671, ADR 0193 decision 5).
 *
 * **What only a running app can say.** `recipe-credentials.test.ts` runs the store over real
 * files and proves Apply sends, with an injected `fetch`, since `call` sends only to `https:`
 * and this suite has no certificate to serve one; `plugins-dialog.test.ts` renders the section
 * in jsdom. Here the value crosses the preload into the real `safeStorage` store under this
 * suite's own `--user-data-dir`: the section lists the name and never the value, the page's
 * HTML never holds it, Forget removes the keychain file, and a trusted folder's recipe whose
 * `call` names it plans requests the window can send (no "sends none") once it is stored.
 *
 * The rows come from a plugin source with a static table, installed by the real `tyto plugin
 * install`; the folder is trusted through `tyto trust add` before launch. Its own `TYTO_HOME`,
 * `--user-data-dir` and `--lang=en`. With `TYTO_RECIPE_CREDENTIALS_SHOTS` set to a folder it
 * leaves a picture of the screen with the section, and as the control, the screen at the same
 * wait before anything was stored.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');
for (const file of [built, cli]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}
const shots = process.env['TYTO_RECIPE_CREDENTIALS_SHOTS'];

const PLUGIN = 'fixture-tasks';
const VERB = 'fixture.tasks';
const NAME = 'routine';
const VALUE = 'e2e-value-never-on-screen';
const HOST = 'hooks.example.com';
const RECIPE = [
  'recipe dispatch',
  // A blank line between the steps: each is a block of its own, and draws its result (ADR 0196).
  VERB,
  '',
  `call url=https://${HOST}/run token=${NAME} body={"title":"{title|}"}`,
  '',
].join('\n');

/** A source with two rows and no network: what the recipe sends is not this suite's question. */
const PLUGIN_CODE = `
export function activate(host) {
  host.registerRecipeVerb({
    id: '${VERB}',
    kind: 'source',
    arguments: [],
    async page() {
      const fetchedAt = new Date().toISOString();
      const row = (title) => ({
        key: title, values: { title }, provenance: { source: 'fixture', id: title, fetchedAt },
      });
      return {
        ok: true,
        value: { table: { columns: [{ name: 'title', type: 'text', origin: 'fixture' }],
          rows: [row('First'), row('Second')] } },
        diagnostics: [],
      };
    },
  });
}
`;

let scratch: string;
let home: string;
let work: string;
let app: ElectronApplication | undefined;
let page: Page;
/** Whether this machine's `safeStorage` can encrypt, read once the app is up. */
let keychain: boolean;

const quiet = { out: () => {}, err: () => {} };
const SECTION = 'tyto-plugins-dialog .plugins__recipe-credentials';

/** The keychain entry's file, under this suite's user-data folder (`credential-store.ts`). */
const entry = (): string =>
  join(scratch, 'user-data', 'credentials', `${encodeURIComponent(`recipe:${NAME}`)}.bin`);

/** Runs a command the way the command bar would, and fails loudly if it was refused. */
async function command(commandId: string): Promise<void> {
  const ran = await page.evaluate(
    (id) =>
      (
        document.querySelector('tyto-command-bar') as { run?: (id: string) => boolean } | null
      )?.run?.(id) ?? false,
    commandId,
  );
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

function install(): void {
  const folder = join(scratch, 'plugin', PLUGIN);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(join(folder, 'dist', 'index.js'), PLUGIN_CODE);
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['recipe-verb'],
      permissions: [],
      namespace: 'fixture',
    }),
  );
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

/** Opens the plugins screen through its menu item, and waits for the section's list. */
async function openPlugins(): Promise<void> {
  await app?.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('plugins.show')?.click();
  });
  await page.waitForSelector(
    `${SECTION} .plugins__recipe-credentials-none, ${SECTION} .plugins__recipe-credential-list`,
  );
}

/**
 * Runs the open recipe and answers the call cell's status line and plan once the run answered:
 * the call cell is marked failed, or its plan is drawn, as `want` says. The lines are drawn before a run answers, saying
 * when it will fetch, so the first drawing is not the answer.
 */
async function runRecipe(want: 'failed' | 'planned'): Promise<{ status: string; plan: string }> {
  await command('recipe.run');
  const handle = await page.waitForFunction(
    (wanted) => {
      const call = document.querySelectorAll('#editor .recipe-cell-status')[1];
      const plan = document.querySelector('#editor .recipe-plan')?.textContent ?? '';
      const failed = call?.hasAttribute('data-failed') === true;
      const status = failed ? 'failed' : plan === '' ? '' : 'planned';
      return status === wanted ? { status, plan } : undefined;
    },
    want,
    { timeout: 20_000 },
  );
  return (await handle.jsonValue()) as { status: string; plan: string };
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-credentials-'));
  home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(work, '.tyto', 'project.json'),
    JSON.stringify({ recipes: { call: { hosts: [HOST] } } }),
  );
  writeFileSync(join(work, 'dispatch.recipe'), RECIPE);
  install();
  const trusted = await run(['trust', 'add', work], {
    version: '0.0.0-e2e',
    cwd: work,
    home,
    console: quiet,
    confirm: () => Promise.resolve(true),
    rasterizer: () => {
      throw new Error('no render here');
    },
  });
  expect(trusted).toBe(0);

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  keychain = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
  process.stdout.write(`[TYTO-671] safeStorage available=${String(keychain)}\n`);
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, work);
  await switchingFolder(page, () => command('workspace.openFolder'));
  // The plugins start after the window opens (ADR 0044): the verb is asked for until main has it.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const verbs = await page.evaluate(async () => {
      const bridge = (
        window as unknown as {
          tyto?: Record<string, (request: object) => Promise<{ verbs: string[] }>>;
        }
      ).tyto;
      return (await bridge?.['recipe:verbs']?.({}))?.verbs ?? [];
    });
    if (verbs.includes(VERB)) break;
    if (Date.now() > deadline) throw new Error(`no '${VERB}' among ${verbs.join(', ')}`);
    await page.waitForTimeout(250);
  }
  await app.evaluate(
    ({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    },
    join(work, 'dispatch.recipe'),
  );
  await command('editor.open');
  await page.waitForSelector('#editor .recipe-cell');
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("a recipe's call credential from the plugins screen (TYTO-671)", () => {
  it('refuses to plan the call while nothing is stored', async () => {
    const before = await runRecipe('failed');
    // The cell says to see Problems, where `call`'s refusal names the plugins screen
    // (`recipe-credentials.test.ts` reads that sentence).
    expect(before.status).toBe('failed');
    expect(before.plan).toBe('');
  });

  it('stores one: the list shows the name only, and the page never holds the value', async () => {
    await openPlugins();
    expect(await page.textContent(`${SECTION} .plugins__recipe-credentials-none`)).toContain(
      'None stored.',
    );
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, 'recipe-credentials-control.png') });
    }

    await page.fill(`${SECTION} .plugins__recipe-credential-name`, NAME);
    await page.fill(`${SECTION} .plugins__recipe-credential-value`, VALUE);
    await page.click(`${SECTION} .plugins__recipe-credential-save`);
    if (!keychain) {
      // Nothing to encrypt with: nothing is stored in the clear, and the section says so.
      await page.waitForSelector(`${SECTION} .plugins__recipe-credential-failed`);
      expect(existsSync(entry())).toBe(false);
      return;
    }
    await page.waitForSelector(`${SECTION} .plugins__recipe-credential[data-name="${NAME}"]`);
    if (shots !== undefined) {
      await page.screenshot({ path: join(shots, 'recipe-credentials.png') });
    }

    expect(await page.inputValue(`${SECTION} .plugins__recipe-credential-value`)).toBe('');
    expect(await page.textContent(`${SECTION} .plugins__recipe-credential`)).toContain(NAME);
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html).not.toContain(VALUE);
    expect(existsSync(entry())).toBe(true);
    expect(readFileSync(entry()).toString('utf8')).not.toContain(VALUE);
    await page.keyboard.press('Escape');
  });

  it("plans the call once stored, as requests the window sends: no 'sends none'", async () => {
    if (!keychain) return;
    const after = await runRecipe('planned');
    expect(after.plan).toContain(`requests to ${HOST}`);
    expect(after.plan).not.toContain('sends none');
    expect(after.plan).toContain('POST https://hooks.example.com/run {"title":"First"}');
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html).not.toContain(VALUE);
  });

  it('forgets it: the keychain file is gone and the list is empty again', async () => {
    if (!keychain) return;
    await openPlugins();
    await page.click(
      `${SECTION} .plugins__recipe-credential[data-name="${NAME}"] .plugins__recipe-credential-forget`,
    );
    await page.waitForSelector(`${SECTION} .plugins__recipe-credentials-none`);
    expect(existsSync(entry())).toBe(false);
  });
});
