import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * **The card's acceptance criterion, which needs two programs** (E9.4, TYTO-43).
 *
 * *Exporting a brief produces the same files as `tyto render`* is a claim about the desktop
 * and the CLI agreeing, and no unit test can make it: only one of the two programs is ever
 * in a unit test's process. So this suite renders one brief twice — once through the window,
 * by clicking, and once through `apps/cli`'s binary — and compares the folders byte for byte.
 *
 * **And it is the only thing that looks at the dialog.** `src/renderer/export-dialog.test.ts`
 * drives the element in jsdom, which does no layout: it can say the Cancel button exists and
 * not that anybody can see it. This repository has shipped a broken window with a green suite
 * three times (TYTO-40, TYTO-41, TYTO-101), and the reason is exactly that gap.
 *
 * **SVG and not PNG, deliberately.** A PNG here would go through the debugger-captured
 * rasterizer (TYTO-133) and `e2e/raster.desktop.test.ts` already measures that adapter against
 * the Playwright references. Asking the same question through two programs and a dialog would
 * make a red run ambiguous — is the rasterizer wrong, or the plumbing? SVG keeps this suite
 * about the plumbing, which is what this card built.
 */

const here = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

const BRIEF = ['---', 'template: promo-curso', '---', '::titulo Exportado pela janela'].join('\n');

let app: ElectronApplication;
let window: Page;
let scratch: string;
let briefPath: string;

/**
 * Tells main what each native picker should answer with next.
 *
 * Both pickers are the same Electron function, told apart by `properties` — which is the
 * only thing distinguishing "choose a brief" from "choose a folder to write into". A stub
 * that answered both the same way would let this suite pass while `file:open` was broken.
 */
async function answerPickers(paths: {
  file?: string | undefined;
  directory?: string | undefined;
}): Promise<void> {
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

/**
 * Opens the brief in the window, which is the state every export below assumes.
 *
 * **Not a detail of the fixture — it is what makes the comparison honest.** The export takes
 * its text from the editor's buffer and its folder from the tab's path, so exporting an
 * empty untitled tab would write a `result.json` and no artwork, and the criterion would be
 * comparing an empty folder against the CLI's.
 */
async function openBrief(): Promise<void> {
  await answerPickers({ file: briefPath });
  await run('editor.open');
  await window.waitForFunction(
    (expected) => document.querySelector('.cm-content')?.textContent?.includes(expected) === true,
    'Exportado pela janela',
  );
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-export-e2e-'));
  briefPath = join(scratch, 'promo.brief');
  writeFileSync(briefPath, BRIEF, 'utf8');

  // **The CLI reads `formats.yaml` from the folder it is run in and the app reads the pack's
  // own**, so without this the two programs would be asked for different frame sizes and the
  // comparison below would be measuring the fixture rather than the code. Copied from the
  // pack, which is the file the window uses — the same arrangement
  // `tools/contract-test` makes for its project folders.
  const pack = join(dirname(require_.resolve('@tyto/templates/package.json')), 'templates');
  writeFileSync(join(scratch, 'formats.yaml'), readFileSync(join(pack, 'formats.yaml'), 'utf8'));

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  window = await app.firstWindow();
  await window.waitForSelector('.shell');
  await openBrief();
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

/** Runs the command by id, the way the command bar would. */
async function run(commandId: string): Promise<void> {
  await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as { run?: (id: string) => void } | null;
    bar?.run?.(id);
  }, commandId);
}

describe('exporting from the window (E9.4)', () => {
  it('opens a dialog that is actually on screen', async () => {
    await run('file.export');

    const panel = window.locator('.export__panel');
    await panel.waitFor({ state: 'visible' });

    // Visible, and big enough to use. jsdom answers the first and cannot answer the second;
    // a dialog rendered into a zero-height box passes every unit test there is.
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(100);

    // And it will not start until it has somewhere to write, which is the rule the unit
    // test states and this one confirms against a real render.
    //
    // `isDisabled()` and not `expect(locator).toBeDisabled()`: this suite runs under Vitest
    // with Playwright as a library, so the auto-retrying matchers of `@playwright/test` do
    // not exist here. Waiting is done with `waitFor`/`waitForSelector` and asserted with
    // plain values.
    expect(await window.locator('.export__start').isDisabled()).toBe(true);
  });

  it('writes the files, and says so', async () => {
    const out = join(scratch, 'from-window');
    await answerPickers({ directory: out });

    await run('file.export');
    await window.locator('.export__panel').waitFor({ state: 'visible' });
    await window.locator('.export__choose').click();
    await window.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="export-directory"]')?.textContent?.trim() ===
        expected,
      out,
    );

    await window.locator('.export__start').click();

    // Waited for by condition and never by a fixed timeout: a render takes as long as it
    // takes, and a sleep long enough for this machine is a flake on a slower one.
    await window.waitForSelector('[data-testid="export-status"][data-state="finished"]', {
      timeout: 60_000,
    });

    const files = readdirSync(out).sort();
    expect(files).toContain('result.json');
    expect(files.filter((name) => name.endsWith('.svg')).length).toBeGreaterThan(0);

    // The count the person read is the count that landed, which is the whole point of
    // showing one.
    const counted = await window.locator('[data-testid="export-count"]').textContent();
    const written = files.filter((name) => name !== 'result.json').length;
    expect(counted?.replace(/\s/gu, '')).toBe(`${String(written)}/${String(written)}`);
  }, 120_000);

  it('produces what `tyto render` produces, file for file', async () => {
    // **The card's criterion.** The window's folder is already on disk from the test above;
    // this renders the same brief with the CLI and compares.
    const fromWindow = join(scratch, 'from-window');
    const fromCli = join(scratch, 'from-cli');

    const cli = require_.resolve('@tyto/cli/dist/index.js');
    execFileSync(process.execPath, [cli, 'render', briefPath, '--out', fromCli, '--types', 'svg'], {
      cwd: scratch,
      stdio: 'pipe',
    });

    const listing = (directory: string): string[] =>
      readdirSync(directory)
        .filter((name) => name !== 'result.json')
        .sort();

    // `result.json` is excluded from the comparison and not from the test: it carries the
    // running program's version and the run's own diagnostics, so two programs would
    // legitimately differ there. The artifacts are what the criterion is about.
    expect(listing(fromWindow)).toEqual(listing(fromCli));

    for (const name of listing(fromWindow)) {
      const a = readFileSync(join(fromWindow, name));
      const b = readFileSync(join(fromCli, name));
      expect(a.equals(b), `${name} differs between the window and the CLI`).toBe(true);
    }
  }, 120_000);

  it('opens the folder it wrote to', async () => {
    const revealed = await app.evaluate(({ shell }) => {
      const calls: string[] = [];
      shell.openPath = (path: string) => {
        calls.push(path);
        return Promise.resolve('');
      };
      (globalThis as Record<string, unknown>)['__tytoRevealed'] = calls;
      return calls.length;
    });
    expect(revealed).toBe(0);

    await window.locator('.export__reveal').click();

    const calls = await app.evaluate(
      () => (globalThis as Record<string, unknown>)['__tytoRevealed'] as string[],
    );
    expect(calls).toEqual([join(scratch, 'from-window')]);
  }, 60_000);

  it('leaves no partial files when it is cancelled', async () => {
    // **A brief big enough to still be running when the click lands.** The promo brief is
    // two frames and finished before Playwright could reach the button — the first version
    // of this test failed with `element was detached from the DOM`, which is a race and not
    // a defect. Twenty-four slides in two formats is forty-eight frames, and the point is
    // not the number: it is that a cancel test needs something to cancel.
    const many = [
      '---',
      'template: carrossel-lista',
      'formats: [feed, story]',
      '---',
      '::titulo',
      '  Muitos slides',
      ...Array.from({ length: 24 }, (_unused, index) => [
        '::item',
        `  Item ${String(index + 1)} de vinte e quatro`,
      ]).flat(),
    ].join('\n');
    const manyPath = join(scratch, 'muitos.brief');
    writeFileSync(manyPath, many, 'utf8');

    const out = join(scratch, 'cancelled');
    await window.locator('.export__close').click();
    await answerPickers({ file: manyPath });
    await run('editor.open');
    await window.waitForFunction(
      (expected) => document.querySelector('.cm-content')?.textContent?.includes(expected) === true,
      'Muitos slides',
    );

    await answerPickers({ directory: out });
    await run('file.export');
    await window.locator('.export__panel').waitFor({ state: 'visible' });
    await window.locator('.export__choose').click();
    await window.locator('.export__start').click();

    // **This clicks Cancel and accepts either outcome, and the reason is a measurement
    // rather than a hedge.** Forty-eight SVG frames finish in well under the time it takes
    // Playwright to resolve the button and click it — the first version of this test failed
    // with `element was detached from the DOM`, twice, because the run had already ended and
    // the dialog had swapped Cancel back to Export. SVG does not rasterize; there is nothing
    // slow in the loop to catch.
    //
    // What survives that is the invariant the card actually states, and it holds either way:
    // **no partial files**. Cancelling is asserted properly where it can be — in
    // `src/main/export.test.ts`, which holds the signal and the job in one process and does
    // not race a mouse. What is left here is the half only a window can answer.
    const cancelClicked = await window
      .locator('.export__cancel')
      .click({ timeout: 2_000 })
      .then(
        () => true,
        () => false,
      );

    await window.waitForSelector(
      '[data-testid="export-status"][data-state="cancelled"], [data-testid="export-status"][data-state="finished"]',
      { timeout: 60_000 },
    );

    const state = await window.locator('[data-testid="export-status"]').getAttribute('data-state');
    process.stdout.write(
      `[TYTO-43] cancel clicked=${String(cancelClicked)} finalState=${String(state)}\n`,
    );

    // The criterion is *no partial files*, which is a claim about what is readable rather
    // than about how many there are: a cancelled run legitimately writes fewer frames, and
    // every file it did write has to be whole. Checked whichever way the race went.
    expect(existsSync(out)).toBe(true);
    const written = readdirSync(out).filter((file) => file.endsWith('.svg'));
    expect(written.length).toBeGreaterThan(0);
    for (const name of written) {
      const svg = readFileSync(join(out, name), 'utf8');
      expect(svg.trimEnd().endsWith('</svg>'), `${name} is truncated`).toBe(true);
    }
  }, 120_000);
});
