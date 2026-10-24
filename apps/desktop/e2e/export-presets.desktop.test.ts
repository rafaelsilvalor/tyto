import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import { firstWindow } from './first-window.js';

/**
 * Export presets through a real window (TYTO-270, ADR 0126).
 *
 * A workspace folder whose `.tyto/project.json` names a preset `entregas` — grid-1x1 and story,
 * into `entregas/` — and a `keybindings.json` that binds `ctrl+e` to it **before the folder is
 * open**, so the binding only works if the key table is resolved again when the preset's
 * command arrives. The preset runs from Ctrl+K and from the key, each time into a folder that
 * does not exist yet, and a later run over a bigger delivery shows what it removed (ADR 0054).
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

const PROJECT = `{
  "templates": ["tpl"],
  "exportPresets": {
    "entregas": { "formats": ["grid-1x1", "story"], "folder": "entregas" }
  }
}
`;

const KEYBINDINGS = `[
  { "key": "ctrl+e", "command": "export.preset:entregas" }
]
`;

const brief = (slides: number): string =>
  [
    '---',
    'template: guarda-teste',
    'formats: [grid-1x1, story]',
    '---',
    '::titulo',
    '  Entrega da campanha',
    ...Array.from({ length: slides }, (_unused, index) => [
      '::lamina',
      `  Lâmina ${String(index + 1)}`,
    ]).flat(),
  ].join('\n');

let scratch: string;
let work: string;
let out: string;
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

/** Runs a command the way the command bar would, and fails loudly if it was refused. */
async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

async function openBrief(path: string, text: string): Promise<void> {
  await answerPickers({ file: path });
  await run('editor.open');
  await window.waitForFunction(
    (wanted) => document.querySelector('.cm-content')?.textContent?.includes(wanted) === true,
    text,
  );
}

/** Waits for the export box to show a finished run into `folder`. */
async function finishedInto(folder: string): Promise<void> {
  await window.locator('.export__panel').waitFor({ state: 'visible' });
  await window.waitForSelector('[data-testid="export-status"][data-state="finished"]', {
    timeout: 90_000,
  });
  expect((await window.locator('[data-testid="export-directory"]').textContent())?.trim()).toBe(
    folder,
  );
}

const pngs = (): string[] =>
  readdirSync(out)
    .filter((name) => name.endsWith('.png'))
    .sort();

/** The codes in the run the box is showing, read off the element itself. */
const shownCodes = (): Promise<string[]> =>
  window.evaluate(() => {
    const box = document.querySelector('tyto-export-dialog') as {
      progress?: { diagnostics: { code?: string }[] };
    } | null;
    return (box?.progress?.diagnostics ?? []).map((item) => item.code ?? '');
  });

async function closeBox(): Promise<void> {
  await window.locator('.export__close').click();
  await window.locator('.export__panel').waitFor({ state: 'hidden' });
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-export-presets-e2e-'));
  work = join(scratch, 'campanha');
  out = join(work, 'entregas');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  mkdirSync(join(work, 'briefs'), { recursive: true });
  cpSync(
    join(here, '__fixtures__', 'templates', 'guarda-teste'),
    join(work, 'tpl', 'guarda-teste'),
    { recursive: true },
  );
  writeFileSync(join(work, '.tyto', 'project.json'), PROJECT, 'utf8');
  writeFileSync(join(work, 'briefs', 'uma.brief'), brief(1), 'utf8');
  writeFileSync(join(work, 'briefs', 'tres.brief'), brief(3), 'utf8');

  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'keybindings.json'), KEYBINDINGS, 'utf8');
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
  await window.waitForSelector('.tabs__tab');

  // Restricted, as every folder starts: `entregas` is inside it, so the preset stays.
  await answerPickers({ directory: work });
  await run('workspace.openFolder');
  await openBrief(join(work, 'briefs', 'uma.brief'), 'Lâmina 1');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('an export preset in the window (TYTO-270, ADR 0126)', () => {
  it('runs from Ctrl+K into a folder it makes, with both formats', async () => {
    expect(existsSync(out)).toBe(false);
    await window.keyboard.press('Control+k');
    await window.waitForSelector('.command-bar__input', { state: 'visible' });
    await window.keyboard.type('Export: entregas');
    const row = window.locator('.command-bar__option--on .command-bar__label');
    await expect.poll(() => row.textContent(), { timeout: 10_000 }).toBe('Export: entregas');

    // For a person to look at the real window; off in CI, where nobody would.
    const shot = process.env['TYTO_EXPORT_PRESETS_SHOT'];
    if (shot !== undefined) await window.screenshot({ path: shot });

    await window.keyboard.press('Enter');
    await finishedInto(out);
    expect(pngs()).toEqual(['grid-1x1-01.png', 'story-01.png']);
    expect(await shownCodes()).toEqual([]);
    await closeBox();
  }, 120_000);

  it('runs from the key keybindings.json binds to it', async () => {
    rmSync(out, { recursive: true, force: true });
    await window.click('#editor .cm-content');
    await window.keyboard.press('Control+e');
    await finishedInto(out);
    expect(pngs()).toEqual(['grid-1x1-01.png', 'story-01.png']);
    await closeBox();
  }, 120_000);

  it('removes what a bigger earlier delivery left, and keeps a person’s file', async () => {
    await openBrief(join(work, 'briefs', 'tres.brief'), 'Lâmina 3');
    await run('export.preset:entregas');
    await finishedInto(out);
    expect(pngs()).toHaveLength(6);
    await closeBox();
    writeFileSync(join(out, 'leia-me.txt'), 'a note for the client', 'utf8');

    await openBrief(join(work, 'briefs', 'uma.brief'), 'Lâmina 1');
    await window.click('#editor .cm-content');
    await window.keyboard.press('Control+e');
    await finishedInto(out);
    expect(pngs()).toEqual(['grid-1x1-01.png', 'story-01.png']);
    expect(readdirSync(out)).toContain('leia-me.txt');
    expect(await shownCodes()).toContain('W_LEFTOVER_REMOVED');
    await window.locator('[data-testid="export-leftovers"]').waitFor({ state: 'visible' });
    await closeBox();
  }, 180_000);
});
