import {
  cpSync,
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
import { switchingFolder } from './folder-switch.js';
import { firstWindow } from './first-window.js';

/**
 * A delivery's export through a real window (TYTO-490, ADR 0157 §6).
 *
 * A workspace folder with one delivery, `mca-1/editaveis/mca-1.brief`, and a brief outside any
 * delivery. The button beside "Open preview to the side" is enabled for the first and runs the
 * export into the export box with no dialog to fill: the artwork at the delivery's root,
 * `result.json` and `template.txt` beside the brief. For the second it is shown disabled with a
 * tooltip, and the command is refused. A second delivery, `mca-2`, draws a picture from the
 * project's `art/` folder, which its export copies into `mca-2/assets/` (TYTO-499, ADR 0161).
 * The unit suites hold the rules; this is what only the window answers — that main's answer
 * reaches the button, and a click reaches the disk.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139), and `closeApp` at the end.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const PROJECT = `{ "templates": ["tpl"], "assets": ["art"] }
`;

/** A real 1×1 PNG in the project's `art/`, outside every delivery's `assets/`. */
const LOGO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

const PICTURE_BRIEF = [
  '---',
  'template: promo-curso',
  'formats: [grid-1x1]',
  'imagem: logo.png',
  '---',
  '::titulo',
  '  Com a foto do projeto',
].join('\n');

const BRIEF = [
  '---',
  'template: guarda-teste',
  'formats: [grid-1x1, story]',
  '---',
  '::titulo',
  '  Entrega da campanha',
  '::lamina',
  '  Lâmina 1',
].join('\n');

let scratch: string;
let work: string;
let delivery: string;
let app: ElectronApplication;
let window: Page;

async function answerPickers(paths: { file?: string; directory?: string }): Promise<void> {
  await app.evaluate(
    ({ dialog }, chosen) => {
      dialog.showOpenDialog = (options?: unknown) => {
        const properties = (options as { properties?: string[] } | undefined)?.properties ?? [];
        const wanted = properties.includes('openDirectory') ? chosen.directory : chosen.file;
        return Promise.resolve(
          wanted === null
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [wanted] },
        );
      };
    },
    { file: paths.file ?? null, directory: paths.directory ?? null },
  );
}

/** Runs a command the way the command bar would; `false` when the bar refused it. */
async function run(commandId: string): Promise<boolean> {
  return window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
}

async function openBrief(path: string, text: string): Promise<void> {
  await answerPickers({ file: path });
  if (!(await run('editor.open'))) throw new Error("the command bar refused 'editor.open'");
  await window.waitForFunction(
    (wanted) => document.querySelector('.cm-content')?.textContent?.includes(wanted) === true,
    text,
  );
}

const button = () => window.locator('[data-action="delivery.export"]');

/** Waits until the button says `disabled`: main answers `delivery:of` after the tab is painted. */
async function buttonDisabled(disabled: boolean): Promise<void> {
  await window.waitForFunction(
    (wanted) =>
      document.querySelector('[data-action="delivery.export"]')?.getAttribute('aria-disabled') ===
      wanted,
    disabled ? 'true' : 'false',
  );
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-export-delivery-e2e-'));
  work = join(scratch, 'campanha');
  delivery = join(work, 'mca-1');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  mkdirSync(join(work, 'briefs'), { recursive: true });
  mkdirSync(join(delivery, 'editaveis'), { recursive: true });
  cpSync(
    join(here, '__fixtures__', 'templates', 'guarda-teste'),
    join(work, 'tpl', 'guarda-teste'),
    { recursive: true },
  );
  writeFileSync(join(work, '.tyto', 'project.json'), PROJECT, 'utf8');
  writeFileSync(join(delivery, 'editaveis', 'mca-1.brief'), BRIEF, 'utf8');
  writeFileSync(join(work, 'briefs', 'solto.brief'), BRIEF.replace('Lâmina 1', 'Solta'), 'utf8');
  mkdirSync(join(work, 'art'), { recursive: true });
  writeFileSync(join(work, 'art', 'logo.png'), LOGO);
  mkdirSync(join(work, 'mca-2', 'editaveis'), { recursive: true });
  writeFileSync(join(work, 'mca-2', 'editaveis', 'mca-2.brief'), PICTURE_BRIEF, 'utf8');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
  await window.waitForSelector('.tabs__tab');

  await answerPickers({ directory: work });
  await switchingFolder(window, async () => {
    if (!(await run('workspace.openFolder'))) throw new Error('the folder did not open');
  });
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("a delivery's export in the window (TYTO-490, ADR 0157 §6)", () => {
  it('exports from the button: artwork at the root, the report beside the brief', async () => {
    await openBrief(join(delivery, 'editaveis', 'mca-1.brief'), 'Lâmina 1');
    await buttonDisabled(false);

    // For a person to look at the real window; off in CI, where nobody would.
    const enabledShot = process.env['TYTO_EXPORT_DELIVERY_SHOT'];
    if (enabledShot !== undefined) await window.screenshot({ path: `${enabledShot}-enabled.png` });

    await button().click();
    await window.locator('.export__panel').waitFor({ state: 'visible' });
    await window.waitForSelector('[data-testid="export-status"][data-state="finished"]', {
      timeout: 40_000,
    });
    expect((await window.locator('[data-testid="export-directory"]').textContent())?.trim()).toBe(
      delivery,
    );
    if (enabledShot !== undefined) await window.screenshot({ path: `${enabledShot}-box.png` });
    // Finished, and with nothing to say: the dialog is the report a person reads.
    expect(await window.locator('.export__problems').count()).toBe(0);

    // The brief's formats, and png, since the project names neither (ADR 0157 §6).
    expect(readdirSync(delivery).sort()).toEqual(['editaveis', 'grid-1x1-01.png', 'story-01.png']);
    expect(readdirSync(join(delivery, 'editaveis')).sort()).toEqual([
      'mca-1.brief',
      'result.json',
      'template.txt',
    ]);
    await window.locator('.export__close').click();
    await window.locator('.export__panel').waitFor({ state: 'hidden' });
  }, 60_000);

  it("copies a picture from the project's art/ into the delivery's assets/ (TYTO-499)", async () => {
    const pictured = join(work, 'mca-2');
    await openBrief(join(pictured, 'editaveis', 'mca-2.brief'), 'Com a foto do projeto');
    await buttonDisabled(false);

    await button().click();
    await window.locator('.export__panel').waitFor({ state: 'visible' });
    await window.waitForSelector('[data-testid="export-status"][data-state="finished"]', {
      timeout: 40_000,
    });

    // The copy beside the artwork, and the project's own picture still where it was.
    expect(readdirSync(join(pictured, 'assets'))).toEqual(['logo.png']);
    expect(readFileSync(join(pictured, 'assets', 'logo.png'))).toEqual(LOGO);
    expect(readdirSync(join(work, 'art'))).toEqual(['logo.png']);
    expect(readdirSync(pictured).sort()).toEqual(['assets', 'editaveis', 'grid-1x1-01.png']);
    await window.locator('.export__close').click();
    await window.locator('.export__panel').waitFor({ state: 'hidden' });
  }, 60_000);

  it('shows the button disabled, saying why, for a brief in no delivery, and refuses the command', async () => {
    await openBrief(join(work, 'briefs', 'solto.brief'), 'Solta');
    await buttonDisabled(true);

    expect(await button().getAttribute('title')).toMatch(/editaveis/u);
    // `force`: Playwright counts `aria-disabled` as disabled and would wait for it to change.
    await button().click({ force: true });
    expect(await window.locator('.export__panel').isVisible()).toBe(false);
    expect(await run('delivery.export')).toBe(false);

    const disabledShot = process.env['TYTO_EXPORT_DELIVERY_SHOT'];
    if (disabledShot !== undefined) {
      await button().hover();
      await window.screenshot({ path: `${disabledShot}-disabled.png` });
    }
  }, 30_000);
});
