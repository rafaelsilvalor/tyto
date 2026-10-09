import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The template folder from the command to the reloaded picker, through a real window (TYTO-142).
 *
 * Every part of TYTO-122 has its own unit test — precedence and the count in `project.test.ts`,
 * the reload in `project-reload.test.ts`, the remembered choice in `settings-store.test.ts`, the
 * channels in `ipc.test.ts`, the two commands in `commands.test.ts`. What none of them can reach
 * is `src/main/index.ts`, the composition root that joins them and the one file that names
 * Electron. So this suite makes the sentence "a person runs the command, picks a folder in the
 * native dialog, and the picker's rows change" a claim the repository tests.
 *
 * **The dialog is replaced from main**, through `app.evaluate`, the seam
 * `e2e/documents.desktop.test.ts` uses for the open and save dialogs. Nothing in the shipped app
 * changes to make this possible.
 *
 * **The command runs through the command bar's own `run`**, the entry point the bar's Enter key
 * calls, the way `e2e/template-assets.desktop.test.ts` runs its commands. It is filtered by id
 * and not typed into the bar: typing is `e2e/command-bar.desktop.test.ts`'s claim, and the
 * window's starting locale is the operating system's, so a label would be a guess.
 *
 * **The template is written here, not copied from a pack**, and says nothing about anybody: the
 * repository is public, and a pack template would also be in the picker before the folder is.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

/** A name no built-in template uses, so its row can only come from the chosen folder. */
const TEMPLATE = 'pasta-exemplo';

const MANIFEST = [
  `name: ${TEMPLATE}`,
  'version: 1.0.0',
  'description: An example template the template-folder e2e writes into a scratch folder.',
  'formats: [grid-1x1]',
  'slots:',
  '  titulo: { type: rich-text, required: true }',
  '',
].join('\n');

// Geometry and font in a `<style>` block, the shape every template in the pack has: a template
// without one is a different case, and not the one a person's folder holds.
const MARKUP = [
  '<frame format="grid-1x1" bg="#14213d">',
  '  <text slot="titulo" class="title" />',
  '</frame>',
  '',
  '<style>',
  '  .title {',
  '    x: 80;',
  '    y: 152;',
  '    w: 900;',
  '    font: 700 64px/1.1 "Source Sans 3";',
  '    color: white;',
  '  }',
  '</style>',
  '',
].join('\n');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let userData: string;
let folder: string;
let builtIn: readonly string[];

/** The template picker's rows: every option the registry produced, by name. */
const pickerRows = (): Promise<readonly string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLOptionElement>('#template option')]
      .map((option) => option.value)
      // The "no template" row the picker adds when the brief names none: not a template.
      .filter((value) => value !== ''),
  );

/** What the app wrote to the `settings.json` in its own user-data folder, or nothing. */
const remembered = (): unknown => {
  const file = join(userData, 'settings.json');
  if (!existsSync(file)) return undefined;
  return (JSON.parse(readFileSync(file, 'utf8')) as { templatesFolder?: unknown }).templatesFolder;
};

/** Answers the next folder picker with `directory`, the way a person choosing it would. */
const pickNext = (directory: string): Promise<void> =>
  app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (() =>
      Promise.resolve({ canceled: false, filePaths: [chosen] })) as never;
  }, directory);

/** Runs a command the way the bar's Enter key does, and fails loudly if the bar refuses it. */
async function run(commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-template-folder-e2e-'));
  userData = join(scratch, 'user-data');

  folder = join(scratch, 'mine');
  const template = join(folder, TEMPLATE);
  mkdirSync(template, { recursive: true });
  writeFileSync(join(template, 'manifest.yaml'), MANIFEST);
  writeFileSync(join(template, 'template.html'), MARKUP);

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  // The picker is filled by `templates:list` after the window paints; an empty list here would
  // make "the rows come back" below vacuously true.
  await page.waitForFunction(
    () => document.querySelectorAll('#template option[value]:not([value=""])').length > 0,
    undefined,
    { timeout: 15_000 },
  );
  builtIn = await pickerRows();
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the template folder, from the command to the reloaded picker (TYTO-142)', () => {
  it('starts with the built-in templates and no folder remembered', () => {
    expect(builtIn).not.toContain(TEMPLATE);
    expect(remembered()).toBeUndefined();
  });

  it("adds the folder's template to the picker once the folder is chosen", async () => {
    await pickNext(folder);
    await run('templates.chooseFolder');

    await expect.poll(pickerRows, { timeout: 15_000 }).toContain(TEMPLATE);
    // Added, not swapped: the folder sits in front of the built-in pack, it does not replace it.
    expect(await pickerRows()).toEqual(expect.arrayContaining([...builtIn]));
  });

  it('names the folder in the settings.json of its own user-data folder', () => {
    // The restart claim, measured on the real file rather than on a store built by hand.
    expect(remembered()).toBe(folder);
  });

  it('puts the rows back and forgets the folder when the choice is cleared', async () => {
    await run('templates.clearFolder');

    await expect.poll(pickerRows, { timeout: 15_000 }).not.toContain(TEMPLATE);
    expect(await pickerRows()).toEqual(builtIn);
    expect(remembered()).toBeNull();
  });
});
