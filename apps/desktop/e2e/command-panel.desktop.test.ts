import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The command panel in the real window (TYTO-496, ADR 0159).
 *
 * Only what needs the window: Ctrl+` reaching the panel through the window's key table, a line
 * typed into it running in main and printing back, and a place in that output opening its file
 * in a tab. The panel's own logic — the words, the history, the tabs, find, the links — is
 * `src/renderer/command-*.test.ts` in jsdom; the runner is `cli-runner.desktop.test.ts`.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const FIXTURES = resolve(here, '..', '..', '..', 'packages', 'command-line', 'src', '__fixtures__');

for (const file of [built, FIXTURES]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

let scratch: string;
let work: string;
let app: ElectronApplication;
let page: Page;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-command-panel-e2e-'));
  work = join(scratch, 'work');
  // The CLI's fixture template, and a brief whose `./logo.png` is missing: a render reports
  // E_ASSET_NOT_FOUND at a place in the brief, which the output prints and links.
  const template = join(work, 'templates', 'cartaz');
  mkdirSync(join(template, 'assets'), { recursive: true });
  mkdirSync(join(work, 'lost'), { recursive: true });
  const copy = (from: string, to: string): void => {
    writeFileSync(to, readFileSync(join(FIXTURES, from)));
  };
  copy('cartaz.manifest.yaml', join(template, 'manifest.yaml'));
  copy('cartaz.html', join(template, 'template.html'));
  copy('mark.svg', join(template, 'assets', 'mark.svg'));
  copy('formats.yaml', join(work, 'formats.yaml'));
  copy('cartaz.brief', join(work, 'lost', 'perdido.brief'));

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the command panel', () => {
  it('opens on Ctrl+` with the caret on its input line', async () => {
    expect(await page.$('tyto-command-panel')).toBeNull();
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+Backquote');

    await page.waitForSelector('tyto-command-panel .command-panel__input');
    expect(
      await page.evaluate(() => document.activeElement?.classList.contains('command-panel__input')),
    ).toBe(true);
    // One tab of the bottom area beside Problems, the only panel drawn there (ADR 0163).
    expect(
      await page.$$eval('[data-dock="bottom"] .dock-tab', (tabs) =>
        tabs.map(
          (tab) =>
            `${tab.getAttribute('data-tab') ?? ''}:${tab.getAttribute('aria-selected') ?? ''}`,
        ),
      ),
    ).toEqual(['problems:false', 'commands:true']);
    expect(await page.$('[data-dock="bottom"] tyto-problems-panel')).toBeNull();
  });

  it('completes what is typed from the CLI’s tree, runs it, and opens the place it printed', async () => {
    const prompt = page.locator('.command-panel__input');
    const brief = join(work, 'lost', 'perdido.brief');
    // A subcommand, completed on Tab from `cli:commands`: the CLI's own tree in main.
    await prompt.pressSequentially('ren');
    await prompt.press('Tab');
    await expect.poll(() => prompt.inputValue()).toBe('render ');
    await prompt.pressSequentially(`"${brief}" --out "${join(work, 'out')}" --types svg --templ`);
    // An option, chosen from the list as it was typed: `--templates` and `--template` both fit.
    await page.waitForSelector('[role="option"]:has-text("--templates <dir>")');
    await prompt.press('Tab');
    await expect.poll(() => prompt.inputValue()).toMatch(/--templates $/u);
    await prompt.pressSequentially(
      `"${join(work, 'templates')}" --formats-file "${join(work, 'formats.yaml')}"`,
    );
    await prompt.press('Escape');
    await prompt.press('Enter');

    // The run's header says it ended with the CLI's exit code for error diagnostics (TYTO-496).
    await page.waitForSelector('.command-run__badge[data-state="failed"]:has-text("1")');
    expect(await page.locator('.command-run__command').last().textContent()).toBe(
      'render perdido.brief --out out --types svg --templates templates --formats-file formats.yaml',
    );

    const link = page.locator('.command-panel__link', { hasText: 'perdido.brief:5:1' }).first();
    await link.click();
    await page.waitForSelector('.tabs__tab:has-text("perdido.brief")');
  });

  it('keeps every backslash of a typed Windows path, `\\n` included, on its way to main', async () => {
    // A B2a screenshot showed this path arrive as `C: ao existecartaz.brief`. The suspect was the
    // screenshot script, whose JS literal turned `\n` into a newline; `String.raw` keeps this
    // test from repeating that, so the keys typed are the ones a person types.
    const path = String.raw`C:\nao existe\cartaz.brief`;
    const prompt = page.locator('.command-panel__input');
    await prompt.pressSequentially(`render "${path}"`);
    await prompt.press('Escape');
    await prompt.press('Enter');

    // The CLI in main names the file it was given when it cannot read it: what main's argv held.
    const run = page.locator('.command-run').last();
    await expect.poll(() => run.textContent(), { timeout: 15_000 }).toContain('E_INPUT_READ');
    expect(await run.textContent()).toContain(path);
    expect(await run.locator('.command-run__command').getAttribute('title')).toBe(
      `render "${path}"`,
    );
  });

  it('closes on Ctrl+` again', async () => {
    await page.locator('.command-panel__input').focus();
    await page.keyboard.press('Control+Backquote');
    await page.waitForSelector('tyto-command-panel', { state: 'detached' });
  });
});
