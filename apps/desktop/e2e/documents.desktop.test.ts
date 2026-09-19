import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * Opening, saving and reopening, through a real window (E9.8).
 *
 * **The dialogs are replaced in the main process from here, not behind a flag in the app.**
 * `app.evaluate` runs in Electron's main process with the `electron` module in scope, so the
 * two calls that would put a native picker on somebody's screen are swapped for functions
 * that answer with a path. Nothing about the shipped app changes to make this suite
 * possible, which is the difference between a test seam and a test-only code path — and the
 * shape `TYTO_HEADLESS` deliberately is *not*, because a window that cannot be hidden cannot
 * be driven at all.
 *
 * What only a launched app can show, and therefore what is here: that the round trip puts
 * text in a real CodeMirror, that the preview recompiles against the file's own folder so
 * an image resolves, that the title carries the name and the unsaved marker, and that the
 * bytes on disk afterwards are the bytes that were typed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let briefPath: string;
let savedPath: string;

/** A one-pixel PNG, so the preview has a real image to resolve and embed. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const BRIEF = ['---', 'template: promo-curso', '---', '::titulo Uma promoção'].join('\n');

const editorText = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent ?? '');

const title = async (): Promise<string> => page.title();

const messages = async (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__message')]
      .map((node) => node.textContent ?? '')
      .join(' | '),
  );

const frameHtml = async (): Promise<string> =>
  page.evaluate(() => document.getElementById('preview-frame')?.getAttribute('srcdoc') ?? '');

const WITH_IMAGE = [
  '---',
  'template: promo-curso',
  '---',
  '::titulo Com imagem',
  '::imagem assets/logo.png',
].join('\n');

/** Tells main which path each dialog should answer with, for the next call. */
const answerDialogsWith = async (open?: string, save?: string): Promise<void> => {
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = () =>
        Promise.resolve(
          paths.open === null
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [paths.open] },
        );
      dialog.showSaveDialog = () =>
        Promise.resolve(
          paths.save === null
            ? { canceled: true, filePath: '' }
            : { canceled: false, filePath: paths.save },
        );
    },
    { open: open ?? null, save: save ?? null },
  );
};

/** Runs a command the way a person would: the bar, filtered by id. */
const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-documents-'));
  briefPath = join(scratch, 'campanha.brief');
  savedPath = join(scratch, 'salvo.brief');
  writeFileSync(briefPath, BRIEF, 'utf8');
  mkdirSync(join(scratch, 'assets'), { recursive: true });
  writeFileSync(join(scratch, 'assets', 'logo.png'), PIXEL);

  app = await _electron.launch({
    // `--user-data-dir` is Electron's own switch, not a seam this app added: the recent
    // list this suite writes lands in the scratch folder instead of in the developer's
    // real one, and the app is not told it is being tested.
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('before anything is open', () => {
  it('says so in the title rather than showing a blank one', async () => {
    expect(await title()).toMatch(/^(Sem título|Untitled) — Tyto$/u);
  });

  it('cannot find an image the brief names, because there is no folder to look in', async () => {
    // The before half of this card's headline claim, and it has to be asserted **here**:
    // once anything has been opened the folder is known for the rest of the session, so a
    // test that typed this later would be measuring the wrong state.
    await page.click('#editor .cm-content');
    await page.keyboard.insertText(WITH_IMAGE);
    await page.waitForTimeout(900);

    expect(await messages()).toContain('assets/logo.png');
  });
});

describe('opening a brief', () => {
  it('puts the text in the editor and its frames in the preview', async () => {
    await answerDialogsWith(briefPath);
    await runFromBar('editor.open');

    expect(await editorText()).toContain('Uma promoção');
    // The frames arrived, which is the round trip through main and back.
    const tabs = await page.evaluate(() => document.querySelectorAll('.preview__tab').length);
    expect(tabs).toBeGreaterThan(0);
  });

  it('puts the file name in the title, with no unsaved marker', async () => {
    expect(await title()).toBe('campanha.brief — Tyto');
  });

  it('marks the title unsaved on the first keystroke and not before', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('End');
    await page.keyboard.insertText(' editada');
    await page.waitForTimeout(500);

    expect(await title()).toMatch(/^campanha\.brief \((não salvo|unsaved)\) — Tyto$/u);
  });
});

describe('saving', () => {
  it('writes the buffer to the file it came from, and clears the marker', async () => {
    await runFromBar('editor.save');

    expect(readFileSync(briefPath, 'utf8')).toContain('editada');
    expect(await title()).toBe('campanha.brief — Tyto');
  });

  it('asks for a name on save-as and follows the document to it', async () => {
    await answerDialogsWith(undefined, savedPath);
    await runFromBar('editor.saveAs');

    expect(readFileSync(savedPath, 'utf8')).toContain('editada');
    expect(await title()).toBe('salvo.brief — Tyto');
  });
});

describe('the recent list', () => {
  it('offers both files, newest first', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('file.recent');
    await page.waitForTimeout(200);

    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.command-bar__label')].map((node) => node.textContent ?? ''),
    );
    await page.keyboard.press('Escape');

    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('salvo.brief');
    expect(labels[1]).toContain('campanha.brief');
  });

  it('reopens the older one, which is the whole point of the list', async () => {
    await runFromBar(`file.recent:${briefPath}`);

    expect(await title()).toBe('campanha.brief — Tyto');
    expect(await editorText()).toContain('editada');
  });

  it('says in the problems panel when a remembered file has moved', async () => {
    // The acceptance criterion's exact wording: reported rather than silently dropped.
    rmSync(savedPath);
    await runFromBar(`file.recent:${savedPath}`);

    const codes = await page.evaluate(() =>
      [...document.querySelectorAll('.problems__code')].map((node) => node.textContent ?? ''),
    );
    expect(codes).toContain('E_FILE_NOT_FOUND');
    // And the buffer was left alone: a file that is gone must not blank the window.
    expect(await editorText()).toContain('editada');
  });
});

describe('quitting and reopening', () => {
  it('still has the recent list, which is what a restart means', async () => {
    // The acceptance criterion in its literal form. `recent-files.test.ts` proves a second
    // reader sees what a first one wrote, which is the mechanism; this proves the app does
    // it — same `--user-data-dir`, a whole new process, and the list is still there.
    const second = await _electron.launch({
      args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
      cwd: join(here, '..'),
      env: { ...process.env, TYTO_HEADLESS: '1' },
    });

    try {
      const reopened = await second.firstWindow();
      await reopened.waitForSelector('#editor .cm-content');
      await reopened.keyboard.press('Control+k');
      await reopened.waitForSelector('.command-bar__input', { state: 'visible' });
      await reopened.keyboard.type('file.recent');
      await reopened.waitForTimeout(300);

      const labels = await reopened.evaluate(() =>
        [...document.querySelectorAll('.command-bar__label')].map((node) => node.textContent ?? ''),
      );

      expect(labels.join(' ')).toContain('campanha.brief');
      // The window itself opened empty: a recent list is an offer, not a session restore.
      expect(await reopened.title()).toMatch(/^(Sem título|Untitled) — Tyto$/u);
    } finally {
      await second.close();
    }
  });
});

describe('the folder the file came from', () => {
  it('finds and embeds the image once the file is opened from disk', async () => {
    const withImage = join(scratch, 'com-imagem.brief');
    writeFileSync(withImage, WITH_IMAGE, 'utf8');

    await answerDialogsWith(withImage);
    await runFromBar('editor.open');
    await page.waitForTimeout(900);

    expect(await messages()).not.toContain('assets/logo.png');
    // Embedded, not linked: the preview inherits the window's policy and a `file://` image
    // would be refused by it. The bytes are in the document.
    expect(await frameHtml()).toContain('data:image/png;base64');
  });
});
