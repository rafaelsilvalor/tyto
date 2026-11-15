import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { switchingFolder } from './folder-switch.js';

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

const RECIPE = join(here, 'docs-shots', '__fixtures__', 'recipes', 'reading.recipe');

for (const file of [built, FIXTURES, RECIPE]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

let scratch: string;
let work: string;
let queueFolder: string;
let settingsFile: string;
let trustFile: string;
let app: ElectronApplication;
let page: Page;

/** What main passed to the box a refused line asked in (TYTO-726). */
interface AskedBox {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  readonly defaultId?: number;
  readonly cancelId?: number;
}

/**
 * Replaces main's native box with one that answers `response` (0 is the offer, 1 is Cancel) and
 * records what it was asked, from now on. Playwright cannot click a native box; this is how
 * `agent-window.desktop.test.ts` answers one, and nothing in the app changes for it.
 */
async function answerBoxes(response: number): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const store = globalThis as { refusalBoxes?: unknown[] };
    store.refusalBoxes = [];
    dialog.showMessageBox = ((...args: unknown[]) => {
      store.refusalBoxes?.push(args.at(-1));
      return Promise.resolve({ response: answer, checkboxChecked: false });
    }) as typeof dialog.showMessageBox;
  }, response);
}

const boxes = (): Promise<AskedBox[]> =>
  app.evaluate(() => ((globalThis as { refusalBoxes?: AskedBox[] }).refusalBoxes ?? []).slice());

/** Types `line` into the panel, runs it, and answers the newest run block once it has ended. */
async function runLine(line: string): Promise<{ badge: string; state: string; text: string }> {
  const before = await page.locator('.command-run').count();
  const prompt = page.locator('.command-panel__input');
  await prompt.fill(line);
  await prompt.press('Enter');
  await page.waitForFunction(
    (count) => {
      const runs = document.querySelectorAll('.command-run');
      if (runs.length <= count) return false;
      const state = runs[runs.length - 1]
        ?.querySelector('.command-run__badge')
        ?.getAttribute('data-state');
      return state !== undefined && state !== null && state !== 'running' && state !== 'waiting';
    },
    before,
    { timeout: 15_000 },
  );
  const run = page.locator('.command-run').last();
  const badge = run.locator('.command-run__badge');
  return {
    badge: ((await badge.textContent()) ?? '').trim(),
    state: (await badge.getAttribute('data-state')) ?? '',
    text: (await run.textContent()) ?? '',
  };
}

/** A file's bytes and modification time: what "nothing changed" is measured by. */
const snapshot = (file: string): { bytes: string; modified: number } | 'absent' =>
  existsSync(file)
    ? { bytes: readFileSync(file, 'utf8'), modified: statSync(file).mtimeMs }
    : 'absent';

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
  writeFileSync(join(work, 'plano.recipe'), readFileSync(RECIPE));
  // TYTO-718: the queue panel's folder with auto-run on, and an alias of the person's that
  // expands to a refused line, both settings the window reads at start.
  queueFolder = join(scratch, 'fila');
  mkdirSync(join(queueFolder, 'inbox'), { recursive: true });
  mkdirSync(join(scratch, 'user-data'), { recursive: true });
  settingsFile = join(scratch, 'user-data', 'settings.json');
  writeFileSync(
    settingsFile,
    JSON.stringify({
      queueFolder,
      queueAutoRun: true,
      commandAliases: { entrega: 'recipe run x.recipe --apply' },
    }),
  );
  trustFile = join(scratch, 'tyto-home', 'trust.json');

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

  // TYTO-718: a line main refuses runs and ends with exit 1, so its header is ✗ 1 (the ✗ alone
  // is a line the panel refused before it ran). One box per line, with Cancel the default.
  it('refuses an alias that expands to `recipe run --apply` on Cancel, naming the alias', async () => {
    await answerBoxes(1);
    const run = await runLine('entrega');

    expect(run).toMatchObject({ badge: '✗ 1', state: 'failed' });
    expect(run.text).toContain('--apply is not available in the window');
    expect(run.text).toContain(
      "The line came from the alias 'entrega', defined in your settings (commandAliases).",
    );
    const asked = await boxes();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ defaultId: 1, cancelId: 1 });
    expect(asked[0]?.buttons).toHaveLength(2);
    expect(asked[0]?.message).toContain('x.recipe');
    expect(asked[0]?.detail).toContain('entrega');
  });

  it('refuses `watch` on the queue folder on Cancel, and leaves auto-run on', async () => {
    await answerBoxes(1);
    const before = snapshot(settingsFile);
    const run = await runLine(`watch "${queueFolder}"`);

    expect(run).toMatchObject({ badge: '✗ 1', state: 'failed' });
    expect(run.text).toContain("That folder is the queue panel's, with auto-run on");
    const asked = await boxes();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ defaultId: 1, cancelId: 1 });
    expect(asked[0]?.message).toContain(queueFolder);
    expect(snapshot(settingsFile)).toEqual(before);
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({ queueAutoRun: true });
  });

  it('refuses `mcp` with the rule and asks nothing', async () => {
    await answerBoxes(0);
    const run = await runLine('mcp');

    expect(run).toMatchObject({ badge: '✗ 1', state: 'failed' });
    expect(run.text).toContain('tyto mcp is not available in the window');
    expect(await boxes()).toEqual([]);
  });

  it("opens the recipe's notebook on the offer of `--apply`, and applies nothing", async () => {
    await answerBoxes(0);
    const recipe = join(work, 'plano.recipe');
    const before = snapshot(recipe);
    const run = await runLine(`recipe run "${recipe}" --apply`);

    expect(run.text).toContain('nothing was applied');
    expect(await boxes()).toHaveLength(1);
    await page.waitForSelector('.tabs__tab:has-text("plano.recipe")');
    expect(snapshot(recipe)).toEqual(before);
  });

  it('closes on Ctrl+` again', async () => {
    await page.locator('.command-panel__input').focus();
    await page.keyboard.press('Control+Backquote');
    await page.waitForSelector('tyto-command-panel', { state: 'detached' });
  });

  // Last, because opening a folder reloads the window. With a folder open, `--trust` offers
  // Workspace: Trust for it; Cancel trusts nothing, and trust.json is not written.
  it('refuses `--trust` with a folder open on Cancel, and trusts nothing', async () => {
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, work);
    await switchingFolder(page, () =>
      page.evaluate(() =>
        (
          document.querySelector('tyto-command-bar') as { run?: (id: string) => boolean } | null
        )?.run?.('workspace.openFolder'),
      ),
    );
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+Backquote');
    await page.waitForSelector('tyto-command-panel .command-panel__input');
    await answerBoxes(1);
    const before = snapshot(trustFile);
    const run = await runLine('render lost/perdido.brief --trust');

    expect(run).toMatchObject({ badge: '✗ 1', state: 'failed' });
    expect(run.text).toContain('--trust is not available in the window');
    const asked = await boxes();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ defaultId: 1, cancelId: 1 });
    expect(asked[0]?.message).toContain(work);
    expect(snapshot(trustFile)).toEqual(before);
  });
});
