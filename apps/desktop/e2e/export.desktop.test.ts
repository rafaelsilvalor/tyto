import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
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
  await waitForBriefText('Exportado pela janela');
}

/**
 * Waits for an opened brief to be readable in the editor, and **says what failed if it is not**.
 *
 * Shared by the two places that open a file, so a red run reports the same four-stage picture
 * wherever it happened.
 */
async function waitForBriefText(expected: string): Promise<void> {
  try {
    await window.waitForFunction(
      (wanted) => document.querySelector('.cm-content')?.textContent?.includes(wanted) === true,
      expected,
    );
  } catch (cause) {
    // **A red run says which stage did not happen** (TYTO-154). The wait above can expire for
    // four different reasons and used to report one sentence for all of them: thirty seconds
    // passed. The command was proved to have run by `run` itself, so what is left to tell
    // apart is whether main answered, whether the document reached the window, and whether
    // CodeMirror had drawn it — and the tab's own label is what separates the middle two,
    // because a document that arrived renames the tab whether or not a glyph is on screen yet.
    const seen = await window.evaluate(() => ({
      tabs: [...document.querySelectorAll('.tabs__label')].map((node) => node.textContent?.trim()),
      // `.cm-content` holds the **viewport** and not the buffer, which is a trap this
      // repository has been caught by before: an empty string here can mean "nothing was
      // opened" or "opened and scrolled past". The tab labels above are what disambiguate it.
      viewport: document.querySelector('.cm-content')?.textContent?.slice(0, 120) ?? null,
      editorMounted: document.querySelector('#editor .cm-content') !== null,
    }));
    throw new Error(
      `the brief never reached the editor: no '${expected}' in the viewport.\n` +
        `  tabs:           ${JSON.stringify(seen.tabs)}\n` +
        `  editor mounted: ${String(seen.editorMounted)}\n` +
        `  viewport:       ${JSON.stringify(seen.viewport)}\n` +
        `  A tab named promo.brief with an empty viewport means main answered and the draw is\n` +
        `  the problem; an untitled tab means the open never came back from main.`,
      { cause },
    );
  }
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
  // **`.shell` is in `index.html` and is therefore no signal at all** (TYTO-154): it is there
  // before a line of the renderer has run, so waiting for it was waiting for nothing. Every
  // other suite here waits for something the script builds; this one now waits for the same
  // two things, and `#editor .cm-content` is the load-bearing one — `runCommand` refuses
  // every command until the editor exists, and the tab strip is painted before it does.
  await window.waitForSelector('#editor .cm-content');
  await window.waitForSelector('.tabs__tab');
  await openBrief();
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Runs the command by id, the way the command bar would — and **checks that it ran**.
 *
 * **This is the flake TYTO-154 was opened for.** The bar's `run` is a no-op until the window
 * has finished loading, and `runCommand` answers `false` for as long as the editor is not
 * mounted, so a command fired too early was swallowed in silence and the wait after it spent
 * thirty seconds on a document nobody had asked for. Measured on this machine: the editor
 * mounts 32-80 ms after `.shell` exists, and a probe firing at `.shell` lost that race in 2
 * of 6 launches while the same probe waiting for the editor won it 6 of 6.
 *
 * The wait in `beforeAll` is what closes the race; this is what stops it coming back silently
 * if anything ever fires a command before the window is ready again.
 */
async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);

  if (!ran) {
    throw new Error(
      `the command bar refused '${commandId}' — the window was not ready to run it. ` +
        `Nothing was sent to main, so whatever this test waits for next will never arrive.`,
    );
  }
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
    await waitForBriefText('Muitos slides');

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

/**
 * Choosing formats and scale, measured in the files that land (TYTO-137).
 *
 * **PNG here, and the suite above is deliberately SVG** — the docstring at the top says why,
 * and this is the exception that proves the rule rather than a drift away from it: the card's
 * criterion is *twice the pixels*, and an SVG has none. What makes it safe is that nothing
 * here compares against the CLI. It compares this program's own 1× against its own 2×, so a
 * red run cannot be ambiguous between the rasterizer and the plumbing — both sides of the
 * comparison went through the same rasterizer.
 *
 * `promo-curso` declares `feed` and `story`, which is what makes it the fixture for this: one
 * of the two can be unticked, and the frame that lands says which one stayed by its size.
 */
describe('choosing formats and scale (TYTO-137)', () => {
  /** Ticks exactly the file types named, whatever was ticked before. */
  const tickTypes = async (wanted: readonly string[]): Promise<void> => {
    for (const kind of ['png', 'jpeg', 'webp', 'svg']) {
      const box = window.locator(`.export__type input[value="${kind}"]`);
      const on = await box.isChecked();
      if (on !== wanted.includes(kind)) await box.click();
    }
  };

  const exportInto = async (
    out: string,
    options: { formats?: readonly string[]; scale?: 1 | 2 } = {},
  ): Promise<void> => {
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

    await tickTypes(['png']);

    if (options.formats !== undefined) {
      const boxes = window.locator('.export__format input');
      const count = await boxes.count();
      for (let index = 0; index < count; index++) {
        const box = boxes.nth(index);
        const value = (await box.getAttribute('value')) ?? '';
        const on = await box.isChecked();
        if (on !== options.formats.includes(value)) await box.click();
      }
    }

    if (options.scale !== undefined) {
      await window.locator('[data-testid="export-scale"]').selectOption(String(options.scale));
    }

    await window.locator('.export__start').click();
    await window.waitForSelector('[data-testid="export-status"][data-state="finished"]', {
      timeout: 120_000,
    });
    await window.locator('.export__close').click();
  };

  const framesIn = (out: string): { name: string; width: number; height: number }[] =>
    readdirSync(out)
      .filter((name) => name.endsWith('.png'))
      .sort()
      .map((name) => {
        const png = PNG.sync.read(readFileSync(join(out, name)));
        return { name, width: png.width, height: png.height };
      });

  beforeAll(async () => {
    // The cancel case above opened another brief, and this one is about `promo-curso`'s two
    // formats. Reopening is also what re-reads the checklist: the dialog is handed the list
    // when it opens, so the tab has to be right first.
    await openBrief();
  }, 60_000);

  it('renders only the formats that stayed ticked', async () => {
    const out = join(scratch, 'feed-only');
    await exportInto(out, { formats: ['feed'] });

    const frames = framesIn(out);

    // One frame and not two, and 1080×1080 rather than 1080×1920: the count says a format was
    // dropped and the size says **which one**, which a count alone could not.
    expect(frames).toHaveLength(1);
    expect([frames[0]?.width, frames[0]?.height]).toEqual([1080, 1080]);
    expect(readdirSync(out)).toContain('result.json');
  }, 180_000);

  it('doubles the pixels at 2x, and not the room the design gets', async () => {
    const out = join(scratch, 'feed-retina');
    await exportInto(out, { formats: ['feed'], scale: 2 });

    const frames = framesIn(out);

    expect(frames).toHaveLength(1);
    // **Twice the pixels of the 1× export above**, which is the card's second criterion. The
    // same design at more resolution is what `deviceScaleFactor` means; a design given twice
    // the room would come back 2160 wide with the artwork still 1080 across, and
    // `packages/raster` holds that distinction against a reference image.
    expect([frames[0]?.width, frames[0]?.height]).toEqual([2160, 2160]);
  }, 180_000);
});
