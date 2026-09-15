import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E9.12's acceptance criteria, through a real window.
 *
 * `src/renderer/command-bar.test.ts` drives the element in jsdom and answers everything
 * about typing, arrowing and focus. Three claims survive only a launched app, and they are
 * the ones here.
 *
 * **`Mod-K` reaches the bar from outside the editor.** The opener is a window listener and
 * not a CodeMirror binding, on the argument that an unhandled keystroke in the editor
 * bubbles out to it. jsdom cannot test that argument, because there is no CodeMirror
 * swallowing keys in it.
 *
 * **A binding and a bar entry are the same command.** The registry's whole reason to exist.
 * Undo is the one command that has both, so undo is what proves it — and it has to be a real
 * CodeMirror, because the registry's undo coordinates with the text history through
 * `undoDepth` and a double would only agree with the test.
 *
 * **A command actually changes the window.** Running the locale switch from the bar has to
 * repaint the headings, which is a round trip through `main.ts`'s state that no unit sees
 * whole.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let app: ElectronApplication;
let page: Page;

const openBar = async (): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
};

const barIsOpen = async (): Promise<boolean> =>
  page.evaluate(() => document.querySelector('.command-bar__panel') !== null);

const optionLabels = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.command-bar__label')].map((node) => node.textContent ?? ''),
  );

/**
 * The preview pane's heading, which is the cheapest visible proof that the locale moved.
 *
 * `Prévia` or `Preview` — and which one the window starts in is the operating system's
 * answer, not this suite's, so nothing here names a starting locale. `editor.heading` would
 * have been the obvious pick and is the wrong one: it is "Brief" in both catalogues.
 */
const previewHeading = async (): Promise<string> =>
  page.evaluate(() => document.getElementById('preview-heading')?.textContent ?? '');

const editorText = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent ?? '');

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  app = await _electron.launch({
    args: ['.'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await app?.close();
});

describe('opening the bar', () => {
  it('opens on Mod-K with the editor focused, and the keystroke never reaches the buffer', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('::titulo Olá');

    await openBar();

    expect(await barIsOpen()).toBe(true);
    // The buffer is untouched — and this assertion is weaker than it looks, so it says so:
    // taking `preventDefault` out of the opener does not fail it, because `Ctrl-K` inserts
    // no text in a browser to begin with. What it does guard is the opener running any
    // *other* edit on the way past, and that the bar opening does not blow the buffer away.
    // The `preventDefault` stays for the default nothing here exercises; it is not what this
    // line proves.
    expect(await editorText()).toBe('::titulo Olá');
    await page.keyboard.press('Escape');
  });

  it('opens with nothing focused at all, which a CodeMirror binding could not', async () => {
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });

    await openBar();

    expect(await barIsOpen()).toBe(true);
    await page.keyboard.press('Escape');
  });

  it('closes on the same keystroke that opened it', async () => {
    await openBar();
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(150);

    expect(await barIsOpen()).toBe(false);
  });

  it('lists the window commands, with the key beside the ones a set binds', async () => {
    // Filtered by id rather than by label throughout this file. The window starts in
    // whatever locale the operating system reports, so a test that typed a Portuguese word
    // would pass on one machine and fail on the next — and matching the id is a feature
    // the bar has precisely so that a command stays findable in either language.
    await openBar();
    await page.keyboard.type('preview.');
    await page.waitForTimeout(150);
    expect((await optionLabels()).length).toBeGreaterThanOrEqual(5);

    await page.keyboard.press('Control+A');
    await page.keyboard.type('editor.undo');
    await page.waitForTimeout(150);
    const undoKey = await page.evaluate(
      () => document.querySelector('.command-bar__key')?.textContent ?? '',
    );
    expect(undoKey).toBe('Ctrl+z');

    // The locale switch has no binding anywhere, and is listed all the same. That is the
    // point of a palette and the one thing a keymap cannot do.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('shell.toggleLocale');
    await page.waitForTimeout(150);
    expect(await optionLabels()).toHaveLength(1);
    expect(await page.evaluate(() => document.querySelector('.command-bar__key'))).toBeNull();

    await page.keyboard.press('Escape');
  });
});

describe('running a command', () => {
  it('types, chooses and changes the window', async () => {
    const before = await previewHeading();
    expect(['Prévia', 'Preview']).toContain(before);

    await openBar();
    await page.keyboard.type('shell.toggleLocale');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);

    expect(await barIsOpen()).toBe(false);
    const after = await previewHeading();
    expect(after).not.toBe(before);
    expect(['Prévia', 'Preview']).toContain(after);

    // The footer's picker agrees, which is the half that would rot silently: it is a view
    // of the locale and not its owner, so a command that moved one and not the other would
    // leave the window disagreeing with itself.
    const picker = await page.evaluate(
      () => (document.getElementById('locale') as HTMLSelectElement | null)?.value ?? '',
    );
    expect(picker).toBe(after === 'Prévia' ? 'pt-BR' : 'en');

    // Put it back, so every test after this one sees the locale the window started in.
    await openBar();
    await page.keyboard.type('shell.toggleLocale');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    expect(await previewHeading()).toBe(before);
  });
});

describe('a binding and a bar entry are the same command', () => {
  it('undoes the same edit either way', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('primeiro');
    await page.waitForTimeout(300);
    await page.keyboard.insertText(' segundo');
    await page.waitForTimeout(300);
    expect(await editorText()).toBe('primeiro segundo');

    // The binding.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const afterBinding = await editorText();
    expect(afterBinding).not.toBe('primeiro segundo');

    // The bar, naming the same id.
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(200);
    expect(await editorText()).toBe('primeiro segundo');

    await openBar();
    await page.keyboard.type('editor.undo');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    expect(await editorText()).toBe(afterBinding);
  });

  it('leaves focus in the editor afterwards', async () => {
    // A palette that runs a command and leaves the cursor nowhere makes the next keystroke
    // disappear, which is the kind of bug a green unit suite never sees.
    await page.click('#editor .cm-content');
    await openBar();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    const focused = await page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof Element && active.closest('#editor') !== null;
    });
    expect(focused).toBe(true);
  });
});
