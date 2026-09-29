import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * A second export from the window into the same folder (TYTO-127, ADR 0054).
 *
 * The unit tests hold the rule; this is the half only a window can answer — that the export
 * box asks for leftovers to go, and that **the person sees what went**, in a list that is on
 * screen and not only in a `result.json` nobody opens before sending the folder.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, so neither this machine's layout nor its
 * installed plugins can decide the outcome.
 */

const here = dirname(fileURLToPath(import.meta.url));

const carousel = (slides: number): string =>
  [
    '---',
    'template: carrossel-lista',
    'formats: [grid-1x1]',
    '---',
    '::titulo',
    '  Como estudar',
    ...Array.from({ length: slides }, (_unused, index) => [
      '::lamina',
      `  Item ${String(index + 1)}`,
    ]).flat(),
  ].join('\n');

let app: ElectronApplication;
let window: Page;
let scratch: string;

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

/** Exports the open brief as SVG into `out`, and waits for the run to finish. */
async function exportInto(out: string): Promise<void> {
  await answerPickers({ directory: out });
  await run('file.export');
  await window.locator('.export__panel').waitFor({ state: 'visible' });
  await window.locator('.export__choose').click();
  await window.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="export-directory"]')?.textContent?.trim() === expected,
    out,
  );
  for (const kind of ['png', 'jpeg', 'webp', 'svg']) {
    const box = window.locator(`.export__type input[value="${kind}"]`);
    if ((await box.isChecked()) !== (kind === 'svg')) await box.click();
  }
  await window.locator('.export__start').click();
  await window.waitForSelector('[data-testid="export-status"][data-state="finished"]', {
    timeout: 60_000,
  });
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-leftovers-e2e-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await app.firstWindow();
  await window.waitForSelector('#editor .cm-content');
  await window.waitForSelector('.tabs__tab');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('exporting from the window into a folder used before (ADR 0054)', () => {
  it('removes the slide the brief no longer has, keeps a person’s file, and shows it', async () => {
    const out = join(scratch, 'entrega');
    const three = join(scratch, 'tres.brief');
    const two = join(scratch, 'duas.brief');
    writeFileSync(three, carousel(3), 'utf8');
    writeFileSync(two, carousel(2).replace('Como estudar', 'Como estudar, versão curta'), 'utf8');

    await openBrief(three, 'Como estudar');
    await exportInto(out);
    // Three artworks, one format: the title rides on the first slide.
    expect(readdirSync(out)).toContain('grid-1x1-03.svg');
    writeFileSync(join(out, 'leia-me.txt'), 'a note for the client', 'utf8');

    await window.locator('.export__close').click();
    await openBrief(two, 'versão curta');
    await exportInto(out);

    expect(readdirSync(out).sort()).toEqual([
      'editaveis',
      'grid-1x1-01.svg',
      'grid-1x1-02.svg',
      'leia-me.txt',
    ]);

    // On screen, and big enough to read: jsdom can say the list exists and not that it shows.
    const list = window.locator('[data-testid="export-leftovers"]');
    await list.waitFor({ state: 'visible' });
    const box = await list.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(20);
    expect(await list.textContent()).toContain('In the folder, from the previous export:');
    expect(await list.textContent()).toContain("Removed 'grid-1x1-03.svg'");

    // For a person to look at the real window; off in CI, where nobody would.
    const shot = process.env['TYTO_LEFTOVERS_SHOT'];
    if (shot !== undefined) await window.screenshot({ path: shot });
  }, 180_000);
});
