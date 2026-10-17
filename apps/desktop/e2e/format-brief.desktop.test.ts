import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Format Brief through the real window (TYTO-297, ADR 0096): Alt+Shift+F and the command bar
 * put a messy brief — tabs, a three-space indent, trailing spaces, three blank lines in a row —
 * in its canonical shape; one Ctrl+Z puts it back; a brief with a syntax error is refused with a
 * line in the status bar and no edit; `formatBriefOnSave` formats on Ctrl+S; and `tabSize: 4`,
 * saved, makes Tab insert four spaces, Format Brief indent by four and the guides step every
 * four columns, live, with no restart.
 *
 * What the buffer holds is asserted in the file, saved: never `.cm-content`, which holds only
 * the lines in the viewport.
 *
 * With `TYTO_FORMAT_BRIEF_SHOTS` set to a folder, the suite leaves pictures: the messy brief,
 * the same brief formatted, the refusal, `tabSize: 4` with its guides, and the new
 * `settings.json` with the two settings' examples.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_FORMAT_BRIEF_SHOTS'];

const MESSY = [
  '---',
  'template: agenda-semana   ',
  'formats: [grid]',
  '---',
  '::titulo   ',
  '\tAGENDA DA SEMANA  ',
  '::lamina',
  '',
  '   ORTOPEDISTA',
  '\t10-09 - 20h | Cuidado dos pés 1. | Profª. Mara Rebeiro  ',
  '',
  '',
  '',
  '      ORTOPEDISTA\t',
  '   11-09 - 20h | Cuidado com a coluna 1. | Profª. Mara Rebeiro',
  '   ',
  '',
  '::lamina',
  '  CARDIOLOGIA',
  '      12-09 - 20h | Arritmias. | Prof. João Lima   ',
  '',
  '',
].join('\n');

const canonical = (indent: string): string =>
  [
    '---',
    'template: agenda-semana',
    'formats: [grid]',
    '---',
    '::titulo',
    `${indent}AGENDA DA SEMANA`,
    '::lamina',
    `${indent}ORTOPEDISTA`,
    `${indent}10-09 - 20h | Cuidado dos pés 1. | Profª. Mara Rebeiro`,
    '',
    `${indent}ORTOPEDISTA`,
    `${indent}11-09 - 20h | Cuidado com a coluna 1. | Profª. Mara Rebeiro`,
    '',
    '::lamina',
    `${indent}CARDIOLOGIA`,
    `${indent}12-09 - 20h | Arritmias. | Prof. João Lima`,
    '',
  ].join('\n');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;
let brief: string;

const answerOpenWith = async (path: string): Promise<void> => {
  await app.evaluate(({ dialog }, open) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [open] });
  }, path);
};

const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.command-bar__input', { state: 'detached' });
};

const onDisk = (): string => readFileSync(brief, 'utf8');

/** Saves with the keyboard and waits until the file says `expected`. */
async function savedAs(expected: string): Promise<void> {
  await page.keyboard.press('Control+s');
  await expect.poll(onDisk, { timeout: 10_000 }).toBe(expected);
}

/** Writes `settings.json`, which main applies as any writer's save. */
function settings(values: Readonly<Record<string, unknown>>): void {
  writeFileSync(
    settingsFile,
    `${JSON.stringify({ theme: 'tyto-light', ...values }, null, 2)}\n`,
    'utf8',
  );
}

const focusBrief = async (): Promise<void> => {
  await page.locator('#editor .cm-content').click();
};

/** The levels of the guides the brief's pane draws, as a set. */
const guideLevels = (): Promise<number[]> =>
  page.evaluate(() =>
    [
      ...new Set(
        [...document.querySelectorAll<HTMLElement>('#editor .cm-indent-guide')].map((guide) =>
          Number(guide.dataset['level']),
        ),
      ),
    ].sort(),
  );

const notice = (): Promise<string | null> =>
  page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('#status-notice');
    return element === null || element.hidden ? null : element.textContent;
  });

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-format-brief-'));
  brief = join(scratch, 'agenda.brief');
  writeFileSync(brief, MESSY, 'utf8');
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  settingsFile = join(userData, 'settings.json');
  settings({});
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1200, 760);
  });
  await answerOpenWith(brief);
  await runFromBar('editor.open');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('agenda.brief'),
    ),
  );
  await focusBrief();
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('Format Brief', () => {
  it('puts the messy brief in its canonical shape on Alt+Shift+F', async () => {
    await page.keyboard.press('Control+Home');
    await shoot('1-messy-before');
    await page.keyboard.press('Alt+Shift+F');
    await savedAs(canonical('  '));
    await shoot('2-formatted-after');
  }, 60_000);

  it('is taken back by one Ctrl+Z', async () => {
    await page.keyboard.press('Control+z');
    await savedAs(MESSY);
  }, 60_000);

  it('runs from the command bar as well, and keeps the caret on its text', async () => {
    // The caret on the second "ORTOPEDISTA" (line 14), after its first letter.
    await page.keyboard.press('Control+Home');
    for (let line = 1; line < 14; line += 1) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await page.keyboard.press('Control+ArrowRight');
    await runFromBar('editor.formatBrief');
    await page.keyboard.type('X');
    await savedAs(canonical('  ').replace('\n\n  ORTOPEDISTA', '\n\n  ORTOPEDISTAX'));
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await savedAs(MESSY);
  }, 60_000);

  it('refuses a brief with a syntax error, says so, and changes nothing', async () => {
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('// fim\n  sem diretiva\n');
    await page.keyboard.press('Alt+Shift+F');
    await expect
      .poll(notice, { timeout: 5_000 })
      .toMatch(/^(Format Brief: not formatted|Arrumar brief: nada mudou)/u);
    await shoot('3-refused');
    await savedAs(`${MESSY}// fim\n  sem diretiva\n`);
    await page.keyboard.press('Control+z');
    await savedAs(MESSY);
  }, 60_000);

  it('answers the key in vim normal mode', async () => {
    await runFromBar('editor.toggleVim');
    await page.waitForSelector('tyto-status-bar .status-bar__vim');
    await focusBrief();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+Shift+F');
    await savedAs(canonical('  '));
    // `u` is vim's undo, and takes the whole format back too.
    await page.keyboard.press('u');
    await savedAs(MESSY);
    await runFromBar('editor.toggleVim');
    await focusBrief();
  }, 60_000);

  it('formats on save when formatBriefOnSave is true, and not when it is false', async () => {
    // Both ride on the theme's answer, so the guides going away is the sign the setting landed.
    settings({ formatBriefOnSave: true, indentGuides: false });
    await expect.poll(guideLevels, { timeout: 15_000 }).toEqual([]);
    await focusBrief();
    await savedAs(canonical('  '));
    // One Ctrl+Z takes the format back, as if it had been the command.
    await page.keyboard.press('Control+z');
    settings({ formatBriefOnSave: false });
    await expect.poll(guideLevels, { timeout: 15_000 }).not.toEqual([]);
    await savedAs(MESSY);
  }, 90_000);

  it('with tabSize 4 saved: Format Brief indents by four and the guides step by four, live', async () => {
    settings({ tabSize: 4 });
    await focusBrief();
    await expect
      .poll(
        async () => {
          await page.keyboard.press('Alt+Shift+F');
          await page.keyboard.press('Control+s');
          await page.waitForTimeout(300);
          return onDisk();
        },
        { timeout: 20_000 },
      )
      .toBe(canonical('    '));
    // Four columns are one level: one guide per block, none deeper.
    await expect.poll(guideLevels, { timeout: 10_000 }).toEqual([1]);
    await shoot('4-tabsize-4-guides');

    // Back to 2 with the text left at four: the same lines are two levels now.
    settings({ tabSize: 2 });
    await expect.poll(guideLevels, { timeout: 15_000 }).toEqual([1, 2]);
  }, 90_000);

  it('with tabSize 4 saved: Tab inserts four spaces', async () => {
    settings({ tabSize: 4 });
    await focusBrief();
    await page.keyboard.press('Control+Home');
    // The guides are the sign the setting has landed: four-space bodies at one level.
    await expect.poll(guideLevels, { timeout: 15_000 }).toEqual([1]);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Control+s');
    await expect.poll(() => onDisk().split('\n')[0], { timeout: 10_000 }).toBe('    ---');
    await page.keyboard.press('Control+z');
    await savedAs(canonical('    '));
  }, 60_000);

  it('lists both settings, commented, in a new settings.json', async () => {
    rmSync(settingsFile, { force: true });
    await runFromBar('settings.open');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tabs__tab')].some((tab) =>
        (tab.textContent ?? '').includes('settings.json'),
      ),
    );
    await expect.poll(() => existsSync(settingsFile), { timeout: 15_000 }).toBe(true);
    const text = readFileSync(settingsFile, 'utf8');
    expect(text).toContain('// "formatBriefOnSave": false,');
    expect(text).toContain('// "tabSize": 2,');
    // Scrolled to the end with the wheel, where the two examples are.
    await page.locator('#editor .cm-content').hover();
    for (let step = 0; step < 10; step += 1) await page.mouse.wheel(0, 400);
    await shoot('5-settings-json');
  }, 60_000);
});
