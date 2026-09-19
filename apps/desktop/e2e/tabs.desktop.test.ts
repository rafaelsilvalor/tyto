import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * More than one brief open at once, through a real window (E9.11).
 *
 * The acceptance criterion this file exists for is one sentence long — *open two, edit both,
 * switch, save one, close the other* — and every clause of it needs a real editor: an undo
 * history, a cursor, a scroll position and a dirty marker are all properties of a running
 * CodeMirror, and jsdom has none of them. `src/renderer/documents.test.ts` proves the
 * bookkeeping and `packages/editor/src/editor.test.ts` proves the snapshots; what is left is
 * that the window actually does it, and that is here.
 *
 * The two dialogs are replaced in the main process from here, the same seam
 * `documents.desktop.test.ts` uses and for the same reason: `app.evaluate` runs with the
 * `electron` module in scope, so nothing about the shipped app changes to make this suite
 * possible.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let firstPath: string;
let secondPath: string;
let windowsPath: string;

const FIRST = ['---', 'template: promo-curso', '---', '::titulo Campanha'].join('\n');

/**
 * Long enough to scroll, which is the only way a scroll position can be asserted at all.
 *
 * Four hundred blank lines and not four hundred of anything else: the brief has to *render*
 * — this suite asserts that a selected format survives a tab switch, and a format tab only
 * exists for a brief that compiled — and `promo-curso` has four slots, so padding made of
 * directives is four hundred `E_UNKNOWN_SLOT` and no frames. Measured against the real pack
 * rather than guessed.
 */
const SECOND = [
  '---',
  'template: promo-curso',
  '---',
  '::titulo Promo',
  ...Array.from({ length: 400 }, () => ''),
].join('\n');

/**
 * Every accelerator the built menu ended up with, at any depth.
 *
 * Read off the running app rather than off the template, because the two are different
 * facts: `menu.ts` asks for roles, and which key each role carries is Electron's answer.
 * That answer is the one that can change under this repository without a line of it moving.
 */
const accelerators = async (): Promise<string[]> =>
  app.evaluate(({ Menu }) => {
    const found: string[] = [];
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.accelerator !== undefined && item.accelerator !== null) {
          found.push(item.accelerator);
        }
        if (item.submenu) walk(item.submenu.items);
      }
    };
    walk(Menu.getApplicationMenu()?.items ?? []);
    return found;
  });

const editorText = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent ?? '');

const scrollTop = async (): Promise<number> =>
  page.evaluate(() => document.querySelector('#editor .cm-scroller')?.scrollTop ?? -1);

/**
 * Waits for the buffer to be scrolled away from the top, rather than sleeping and hoping.
 *
 * CodeMirror scrolls on a measure pass and not on the dispatch, so a fixed timeout after a
 * tab switch races the restore: the scroll effect can land *after* the next keystroke and put
 * the view back where the snapshot said it was. Waiting on the condition is the only stable
 * form of this assertion.
 */
const waitForScroll = async (): Promise<void> => {
  await page.waitForFunction(
    () => (document.querySelector('#editor .cm-scroller')?.scrollTop ?? 0) > 0,
  );
};

const tabNames = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__label')].map((node) => node.textContent ?? ''),
  );

const activeTab = async (): Promise<string> =>
  page.evaluate(
    () => document.querySelector('.tabs__tab--on .tabs__label')?.textContent ?? '(none)',
  );

/** The tabs showing the unsaved dot, by name. */
const unsavedTabs = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab')]
      .filter((tab) => tab.querySelector('.tabs__dirty') !== null)
      .map((tab) => tab.querySelector('.tabs__label')?.textContent ?? ''),
  );

const selectedFormat = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('.preview__tab--on')?.textContent ?? '(none)');

const zoomLevel = async (): Promise<string> =>
  page.evaluate(() => document.getElementById('zoom-level')?.textContent ?? '');

const tab = (name: string) => page.locator('.tabs__tab').filter({ hasText: name });

const clickTab = async (name: string): Promise<void> => {
  await tab(name).locator('.tabs__name').click();
  await page.waitForTimeout(300);
};

/** Tells main which path each file dialog should answer with, for the next call. */
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

/**
 * Answers the "close without saving?" box, and counts how often it was asked.
 *
 * Index 1 is the confirming button and index 0 the cancelling one, which is the order
 * `src/main/index.ts` builds them in — and which is also why cancel is `defaultId` and
 * `cancelId`: Escape and Enter both leave the text alone.
 */
const answerConfirmWith = async (confirmed: boolean): Promise<void> => {
  await app.evaluate(({ dialog }, yes) => {
    const electronGlobal = globalThis as unknown as { tytoAsked?: number };
    electronGlobal.tytoAsked = 0;
    dialog.showMessageBox = ((): Promise<unknown> => {
      electronGlobal.tytoAsked = (electronGlobal.tytoAsked ?? 0) + 1;
      return Promise.resolve({ response: yes ? 1 : 0, checkboxChecked: false });
    }) as never;
  }, confirmed);
};

const timesAsked = async (): Promise<number> =>
  app.evaluate(() => (globalThis as unknown as { tytoAsked?: number }).tytoAsked ?? 0);

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

  scratch = mkdtempSync(join(tmpdir(), 'tyto-tabs-'));
  firstPath = join(scratch, 'campanha.brief');
  secondPath = join(scratch, 'promo.brief');
  windowsPath = join(scratch, 'windows.brief');
  writeFileSync(firstPath, FIRST, 'utf8');
  writeFileSync(secondPath, SECOND, 'utf8');
  // The same brief with the line endings a Windows editor leaves behind, written here
  // rather than committed because `.gitattributes` normalises every path in this repository
  // to LF and a committed fixture would arrive as the one thing it is not (TYTO-64 keeps a
  // real one under `tools/contract-test/` with an exemption beside it).
  writeFileSync(windowsPath, FIRST.split('\n').join('\r\n'), 'utf8');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the window a person opens', () => {
  it('has one tab in it, and it is the untitled brief they can start typing into', async () => {
    // The card's open question, answered: a brief that has never been saved gets a tab,
    // because that is the state the app opens in and there is nowhere else to put it.
    expect(await tabNames()).toEqual([expect.stringMatching(/^(Sem título|Untitled)$/u)]);
    expect(await activeTab()).toMatch(/^(Sem título|Untitled)$/u);
  });

  it('gives Mod-W to the tab rather than to the window', async () => {
    // Asserted against the menu rather than by pressing the key, and that is the whole
    // point: Electron's default menu carries `CommandOrControl+W` on Close Window, a menu
    // accelerator is handled before the page sees it, and Playwright's keys go straight to
    // the renderer through the debugger — so pressing Control+W here would pass either way
    // and tell a person on a real keyboard nothing (`src/main/menu.ts`).
    const found = await accelerators();

    expect(found).not.toContain('CommandOrControl+W');
    // And the menu is still there: removing it outright is what takes copy and paste off
    // macOS, where the clipboard shortcuts belong to the menu.
    expect(found).toContain('CommandOrControl+C');
  });

  it('gives Mod-R to nobody, because a reload discards every open tab', async () => {
    // TYTO-104, and read the same way and for the same reason: this is the assertion that
    // would catch the accelerator coming back, either because `menu.ts` asked for the role
    // again or because Electron moved a default onto an item that is still here.
    // `src/main/menu.test.ts` asserts the template; what a role *becomes* is Electron's,
    // and this is where Electron is running.
    const found = await accelerators();

    expect(found).not.toContain('CommandOrControl+R');
    expect(found).not.toContain('Shift+CommandOrControl+R');
    // The rest of the View menu survived, so the removal is about reloading rather than
    // about the submenu.
    expect(found).toContain('CommandOrControl+0');
  });
});

describe('the unsaved dot, timed rather than assumed (TYTO-112, ADR 0026)', () => {
  /**
   * How long the dot is given to appear, and the whole of why this test is here.
   *
   * `PREVIEW_DELAY` in `src/renderer/main.ts` is 200 ms, and the compile's answer ends in a
   * full `repaint()`. So an assertion that sleeps before looking cannot tell the dot painted
   * by the keystroke from the dot painted by the compile a fifth of a second later — which
   * is not a hypothetical: deleting the `paintTabs()` and `paintTitle()` calls from
   * `handle.onChange` leaves this whole suite green if every assertion waits first. Under
   * this bound it does not.
   *
   * Polled in the page on animation frames, so what is measured is the browser's clock and
   * not a round trip.
   */
  const BEFORE_THE_COMPILE = 150;

  const dotWithin = (present: boolean): Promise<unknown> =>
    page.waitForFunction(
      (want) => (document.querySelector('.tabs__dirty') !== null) === want,
      present,
      { timeout: BEFORE_THE_COMPILE, polling: 'raf' },
    );

  it('appears on the keystroke, not on the compile that follows it', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.type('x');

    await dotWithin(true);
  });

  it('goes again on the undo, which is the whole card', async () => {
    // And a flag could not do this: it went on at the first keystroke and only a save took
    // it off, so the text went back to empty and the dot stayed. The buffer is the empty
    // string again and so is what this tab compares against, so there is nothing to clear.
    await page.keyboard.press('Control+z');

    await dotWithin(false);
    // Left exactly as the window opened, because the next describe replaces this tab and
    // `isDisposable` refuses a tab with anything in it.
    expect(await editorText()).toBe('');
  });
});

describe('opening two briefs', () => {
  it('replaces the empty tab with the first one, rather than leaving it behind', async () => {
    await answerDialogsWith(firstPath);
    await runFromBar('editor.open');

    expect(await tabNames()).toEqual(['campanha.brief']);
    expect(await editorText()).toContain('Campanha');
  });

  it('adds a tab for the second, and does not disturb the first', async () => {
    await answerDialogsWith(secondPath);
    await runFromBar('editor.open');

    expect(await tabNames()).toEqual(['campanha.brief', 'promo.brief']);
    expect(await activeTab()).toBe('promo.brief');
    expect(await editorText()).toContain('Promo');
    // The window title follows the tab, which is point 5 of the card.
    expect(await page.title()).toBe('promo.brief — Tyto');
  });

  it('goes to the tab that already holds a file rather than opening it twice', async () => {
    await answerDialogsWith(firstPath);
    await runFromBar('editor.open');

    expect(await tabNames()).toEqual(['campanha.brief', 'promo.brief']);
    expect(await activeTab()).toBe('campanha.brief');
  });
});

describe('switching between them', () => {
  it('puts the buffer, the cursor and the scroll back where they were', async () => {
    // Cursor at the very top of the first, at the very bottom of the second. Where a typed
    // character lands afterwards is the assertion — a caret is not a thing a headless window
    // will show you, and where the next keystroke goes is what a cursor *is*.
    await clickTab('campanha.brief');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+Home');

    await clickTab('promo.brief');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+End');
    await waitForScroll();

    await clickTab('campanha.brief');
    expect(await editorText()).toContain('Campanha');
    await page.keyboard.type('X');
    await page.waitForTimeout(300);
    // At the top, where it was left, and not wherever a fresh buffer would have put it.
    expect(await editorText()).toMatch(/^X---/u);
    // Put back, because an `X` in front of the frontmatter is a brief that does not compile
    // and the next test needs this document's format tabs.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);

    await clickTab('promo.brief');
    // Scrolled, and deliberately not "scrolled to the same pixel": `scrollSnapshot` puts the
    // line back in view rather than restoring an offset, and an offset is not what a person
    // remembers about where they were.
    await waitForScroll();
    expect(await scrollTop()).toBeGreaterThan(0);
    // Read from the top, because `.cm-content` holds the *viewport*: four hundred lines down
    // a blank-padded brief there is nothing in the DOM to find.
    await page.keyboard.press('Control+Home');
    await page.waitForTimeout(300);
    expect(await editorText()).toContain('Promo');
  });

  it('keeps the selected format and the zoom with the document', async () => {
    await clickTab('campanha.brief');
    await page.waitForTimeout(500);
    const formats = await page.evaluate(() =>
      [...document.querySelectorAll('.preview__tab')].map((node) => node.textContent ?? ''),
    );
    // The fixture renders more than one format, or this test is asserting nothing.
    expect(formats.length).toBeGreaterThan(1);

    await page.click(`.preview__tab >> nth=1`);
    await runFromBar('preview.zoomIn');
    const chosenFormat = await selectedFormat();
    const chosenZoom = await zoomLevel();
    expect(chosenFormat).toBe(formats[1]);

    await clickTab('promo.brief');
    await page.waitForTimeout(400);
    expect(await selectedFormat()).toBe(formats[0]);

    await clickTab('campanha.brief');
    await page.waitForTimeout(400);
    expect(await selectedFormat()).toBe(chosenFormat);
    expect(await zoomLevel()).toBe(chosenZoom);
  });

  it('never lets an undo reach into the other tab', async () => {
    // The acceptance criterion in its literal form, and the reason `@tyto/editor` grew
    // snapshots rather than a `setValue`: an undo history belongs to an `EditorState`, and
    // rebuilding one from a string throws it away.
    await clickTab('campanha.brief');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' primeira');

    await clickTab('promo.brief');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('segunda ');
    await page.waitForTimeout(300);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await editorText()).not.toContain('segunda');
    // One undo took back this tab's own typing. A second must not start on the other's.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await editorText()).toContain('Promo');

    await clickTab('campanha.brief');
    expect(await editorText()).toContain('primeira');
  });
});

describe('saving one and closing the other', () => {
  it('marks the tab whose text differs from its file, and not the one that was typed in', async () => {
    // **This expectation inverted with TYTO-112, on purpose** (ADR 0026). It used to name
    // both tabs, because the marker was a stored flag: it went on at the first keystroke
    // and only a save took it off, so the undo above took promo's text back and left the
    // dot on saying the opposite of the truth. The marker is a comparison now, promo's
    // buffer is the file again, and only campanha still holds ` primeira`.
    //
    // It is also the only instrument this suite has for *"the undo restored the file's text
    // exactly"*: `.cm-content` holds the viewport, and promo.brief is four hundred lines, so
    // the text itself cannot be compared here. A partial undo would leave the dot on.
    expect(await unsavedTabs()).toEqual(['campanha.brief']);
  });

  it('writes the tab that was saved, and leaves nothing marked', async () => {
    await clickTab('campanha.brief');
    await runFromBar('editor.save');

    expect(readFileSync(firstPath, 'utf8')).toContain('primeira');
    // Nothing, and that inverted with the assertion above: campanha's buffer is now the file
    // because it was just written, promo's was already the file because it was undone back
    // to it, and no dot survives a tab agreeing with its disk (ADR 0026). The claim the old
    // `['promo.brief']` made — that a save touches one tab and not the other — is made by
    // the two `readFileSync` lines around it, which is where it always belonged.
    expect(await unsavedTabs()).toEqual([]);
    expect(readFileSync(secondPath, 'utf8')).not.toContain('segunda');
    expect(await page.title()).toBe('campanha.brief — Tyto');
  });

  it('asks before closing a tab with unsaved text, and honours a no', async () => {
    await clickTab('promo.brief');
    await page.click('#editor .cm-content');
    await page.keyboard.type('rascunho ');
    await page.waitForTimeout(300);
    expect(await unsavedTabs()).toEqual(['promo.brief']);

    await answerConfirmWith(false);
    await tab('promo.brief').locator('.tabs__close').click();
    await page.waitForTimeout(500);

    expect(await timesAsked()).toBe(1);
    expect(await tabNames()).toEqual(['campanha.brief', 'promo.brief']);
    expect(await editorText()).toContain('rascunho');
  });

  it('closes it when the answer is yes, and goes to the neighbour', async () => {
    await answerConfirmWith(true);
    await tab('promo.brief').locator('.tabs__close').click();
    await page.waitForTimeout(500);

    expect(await timesAsked()).toBe(1);
    expect(await tabNames()).toEqual(['campanha.brief']);
    expect(await activeTab()).toBe('campanha.brief');
    expect(await editorText()).toContain('primeira');
    expect(await page.title()).toBe('campanha.brief — Tyto');
  });

  it('does not ask about a tab with nothing unsaved in it', async () => {
    await answerConfirmWith(true);
    await runFromBar('document.close');
    await page.waitForTimeout(400);

    expect(await timesAsked()).toBe(0);
    // Closing the last tab leaves an empty one: there has to be somewhere to type.
    expect(await tabNames()).toEqual([expect.stringMatching(/^(Sem título|Untitled)$/u)]);
    expect(await editorText()).toBe('');
  });
});

describe('the keys', () => {
  it('goes to a tab by its number and steps between them', async () => {
    await answerDialogsWith(firstPath);
    await runFromBar('editor.open');
    await answerDialogsWith(secondPath);
    await runFromBar('editor.open');
    expect(await tabNames()).toEqual(['campanha.brief', 'promo.brief']);

    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(300);
    expect(await activeTab()).toBe('campanha.brief');

    await page.keyboard.press('Control+PageDown');
    await page.waitForTimeout(300);
    expect(await activeTab()).toBe('promo.brief');

    // Wrapping, because a "next tab" that refused at the end is a key that does nothing
    // every other press.
    await page.keyboard.press('Control+PageDown');
    await page.waitForTimeout(300);
    expect(await activeTab()).toBe('campanha.brief');
  });

  it('shows the open tabs in the command bar, and only the ones that exist', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('document.select');
    await page.waitForTimeout(200);

    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.command-bar__label')].map((node) => node.textContent ?? ''),
    );
    await page.keyboard.press('Escape');

    // Two tabs open, so two rows — not the nine slots the keymap carries.
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('campanha.brief');
    expect(labels[1]).toContain('promo.brief');
  });
});

describe('a save-as onto a file another tab has open', () => {
  /**
   * The bundled loose end of TYTO-104, and the only place it can be seen.
   *
   * Main gives the path to the tab that asked — moving somebody away from the text they
   * just wrote would be worse — so the *other* tab has to let go, and the strip has to say
   * so. `src/main/documents.test.ts` proves main stops holding it; what nothing below main
   * can prove is that the tab strip stops claiming a file it no longer has, because the
   * strip is painted by `src/renderer/main.ts` from an answer that crosses the bridge.
   */
  it('leaves one tab holding the file and takes the name off the other', async () => {
    await answerDialogsWith(firstPath);
    await runFromBar('editor.open');
    await answerDialogsWith(secondPath);
    await runFromBar('editor.open');
    expect(await tabNames()).toEqual(['campanha.brief', 'promo.brief']);

    // promo.brief is in front; save it over the file the first tab is holding.
    await answerDialogsWith(undefined, firstPath);
    await runFromBar('editor.saveAs');
    await page.waitForTimeout(500);

    // Exactly one tab named after the file, and it is the one that asked. The other keeps
    // its text and loses the claim that the text is in a file.
    expect(await tabNames()).toEqual([
      expect.stringMatching(/^(Sem título|Untitled)$/u),
      'campanha.brief',
    ]);
    expect(await activeTab()).toBe('campanha.brief');
    expect(await unsavedTabs()).toEqual([expect.stringMatching(/^(Sem título|Untitled)$/u)]);
  });
});

describe('a brief written on Windows', () => {
  /**
   * The one file that can make a derived marker lie, and the reason it is opened for real.
   *
   * CodeMirror normalises line endings when it builds a document, so the buffer of a CR LF
   * brief says LF. A marker comparing that buffer against the bytes main read would be true
   * from the first paint — a dot nobody caused, a title that says `(não salvo)`, and a
   * discard dialog in front of closing a file that was never edited. `adopt` therefore reads
   * the saved text back out of the buffer (TYTO-112, ADR 0026), and this is the only place
   * in the repository where that is exercised end to end: every committed fixture is LF
   * because `.gitattributes` says so, and the unit stand-in for an `EditorState` returns its
   * string unchanged and so cannot see it at all.
   */
  it('opens with nothing marked, having been read through CodeMirror', async () => {
    await answerDialogsWith(windowsPath);
    await runFromBar('editor.open');

    expect(await tabNames()).toContain('windows.brief');
    expect(await activeTab()).toBe('windows.brief');
    expect(await unsavedTabs()).not.toContain('windows.brief');
    expect(await page.title()).toBe('windows.brief — Tyto');
  });

  it('closes without a question, because there is nothing in it to lose', async () => {
    await answerConfirmWith(true);
    await runFromBar('document.close');
    await page.waitForTimeout(400);

    expect(await timesAsked()).toBe(0);
    expect(await tabNames()).not.toContain('windows.brief');
  });
});
