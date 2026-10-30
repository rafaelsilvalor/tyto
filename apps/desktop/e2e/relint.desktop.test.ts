import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { waitForWindowTemplates } from './window-templates.js';

/**
 * The underline follows a compile that no keystroke started (TYTO-351).
 *
 * Changing the templates folder compiles every open brief again (`afterTemplatesReread`), and
 * the problems panel always followed. The brief's red underline did not: CodeMirror's linter
 * reruns on a change of text, and a re-preview changes none, so the underline stayed until the
 * next keystroke. A brief here names a template that exists only in a scratch folder; choosing
 * that folder must take the underline away with no key pressed — in the tab in front, and in a
 * tab that was behind another one while the folder changed.
 *
 * The folder dialog is replaced from main and the command runs through the command bar's own
 * `run`, the seams `e2e/template-folder.desktop.test.ts` uses. `TYTO_RELINT_SHOTS` names a folder
 * for the before and after pictures; without it nothing is written.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_RELINT_SHOTS'];

/** A name no built-in template uses, so the brief resolves only once the folder is chosen. */
const TEMPLATE = 'pasta-relint';

const MANIFEST = [
  `name: ${TEMPLATE}`,
  'version: 1.0.0',
  'description: A template the relint e2e writes into a scratch folder.',
  'formats: [grid-1x1]',
  'slots:',
  '  titulo: { type: rich-text, required: true }',
  '',
].join('\n');

const MARKUP = [
  '<frame format="grid-1x1" bg="#14213d">',
  '  <text slot="titulo" class="title" />',
  '</frame>',
  '',
  '<style>',
  '  .title {',
  '    x: 80;',
  '    y: 152;',
  '    w: 900;',
  '    font: 700 64px/1.1 "Source Sans 3";',
  '    color: white;',
  '  }',
  '</style>',
  '',
].join('\n');

/**
 * What `E_UNKNOWN_TEMPLATE` underlines: the frontmatter key, which is where `resolve` ranges it
 * (`ast.frontmatter.ranges.template`). The only underline in this brief while the folder is out.
 */
const UNDERLINED = ['template'];

const BRIEF = ['---', `template: ${TEMPLATE}`, '---', '::titulo Relint', ''].join('\n');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let folder: string;

/** Answers the next folder picker with `directory`, the way a person choosing it would. */
const pickNext = (directory: string): Promise<void> =>
  app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (() =>
      Promise.resolve({ canceled: false, filePaths: [chosen] })) as never;
  }, directory);

/** Runs a command the way the bar's Enter key does, and fails loudly if the bar refuses it. */
async function run(commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

/** Replaces the buffer in one transaction, so no completion popup can take a keystroke. */
async function setBrief(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

/** The text under every error underline in the editor. */
const underlined = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-lintRange-error')].map(
      (node) => node.textContent ?? '',
    ),
  );

/** How many keys were pressed since `since`: none may be, for the claim to mean anything. */
const keysSince = (since: number): Promise<number> =>
  page.evaluate((mark) => (window as unknown as { __keys: number[] }).__keys.length - mark, since);

const keyMark = (): Promise<number> =>
  page.evaluate(() => (window as unknown as { __keys: number[] }).__keys.length);

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-relint-e2e-'));
  folder = join(scratch, 'mine');
  mkdirSync(join(folder, TEMPLATE), { recursive: true });
  writeFileSync(join(folder, TEMPLATE, 'manifest.yaml'), MANIFEST);
  writeFileSync(join(folder, TEMPLATE, 'template.html'), MARKUP);

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await waitForWindowTemplates(page, ['carrossel-lista'], 15_000);
  // Every key that reaches the page, counted in the capture phase so nothing can hide one.
  await page.evaluate(() => {
    const keys: number[] = [];
    (window as unknown as { __keys: number[] }).__keys = keys;
    window.addEventListener('keydown', () => keys.push(1), true);
  });
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the underline after a templates folder change (TYTO-351)', () => {
  it('underlines the template while the folder is not chosen', async () => {
    await setBrief(BRIEF);
    await expect.poll(underlined, { timeout: 15_000 }).toEqual(UNDERLINED);
    await shoot('1-before-folder');
  });

  it('takes the underline away when the folder is chosen, with no key pressed', async () => {
    const mark = await keyMark();
    await pickNext(folder);
    await run('templates.chooseFolder');

    await expect.poll(underlined, { timeout: 15_000 }).toEqual([]);
    expect(await keysSince(mark)).toBe(0);
    await shoot('2-after-folder');
  });

  it('puts it back when the folder is cleared, with no key pressed', async () => {
    const mark = await keyMark();
    await run('templates.clearFolder');

    await expect.poll(underlined, { timeout: 15_000 }).toEqual(UNDERLINED);
    expect(await keysSince(mark)).toBe(0);
  });

  /**
   * A tab behind another one is compiled when the folder changes, but no pane shows it, so
   * nothing lints it then. Its underline is drawn again when it comes back to the front.
   */
  it('shows a tab that was behind while the folder changed without the stale underline', async () => {
    await run('document.new');
    await expect.poll(() => page.locator('.tabs__tab').count(), { timeout: 15_000 }).toBe(2);
    await expect.poll(underlined, { timeout: 15_000 }).toEqual([]);

    const mark = await keyMark();
    await pickNext(folder);
    await run('templates.chooseFolder');
    // Long enough for the reread to compile the tab behind (milliseconds on this machine): an
    // answer that landed after the tab came forward would be drawn by the relint anyway, and
    // the case this measures is the one where it landed while nobody showed it.
    await page.waitForTimeout(2000);
    await page.locator('.tabs__tab').first().click();
    await expect
      .poll(() => page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent))
      .toContain(TEMPLATE);

    await expect.poll(underlined, { timeout: 15_000 }).toEqual([]);
    // And it stays away: a lint reading an older answer would put it back after the restore.
    await page.waitForTimeout(1000);
    expect(await underlined()).toEqual([]);
    expect(await keysSince(mark)).toBe(0);
    await shoot('3-background-tab-back');
  });
});
