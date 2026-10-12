import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { translate } from '../shared/i18n/index.js';
import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The preview's two empty lines, through a real window (TYTO-268).
 *
 * Until this card a brief that could not be drawn — `template: nao-existe`, with no artwork
 * ever drawn before it — left the preview saying "Write a brief to see it here" under a brief
 * that was written. The pane now tells the two apart, and the decision is made from a real
 * answer: `brief:preview` compiling against the pack the app ships, which is the only place
 * an unknown template is genuinely fatal. `preview.test.ts` proves the pane draws whichever
 * line it is told to; `documents.test.ts` proves `isBroken` reads the answer; this is the
 * round trip that connects them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const EXAMPLE = join(
  dirname(createRequire(import.meta.url).resolve('@tyto/templates/package.json')),
  'templates',
  'promo-curso',
  'examples',
  'promo.brief',
);
const GOOD = readFileSync(EXAMPLE, 'utf8');
/** The example with a template nobody installed: fatal at `resolve`, `E_UNKNOWN_TEMPLATE`. */
const UNKNOWN = GOOD.replace('template: promo-curso', 'template: nao-existe');

let scratch: string;
let app: ElectronApplication;
let page: Page;
/** Where the card's screenshots go when asked for; the suite takes none otherwise. */
const shots = process.env['TYTO_PREVIEW_BROKEN_SHOTS'];

const empty = () => page.locator('#preview-empty');
const broken = () => page.locator('#preview-broken');
const paper = () => page.locator('#preview-paper');
const stale = () => page.locator('#preview-stale');

/** The document the preview is showing, or `''` before it shows one. */
const shown = async (): Promise<string> =>
  page.evaluate(() => document.getElementById('preview-frame')?.getAttribute('srcdoc') ?? '');

const replaceText = async (text: string): Promise<void> => {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+a');
  if (text === '') await page.keyboard.press('Backspace');
  else await page.keyboard.insertText(text);
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm build\` before \`pnpm --filter @tyto/desktop test:desktop\``,
    );
  }
  // Its own data folders, never the machine's (TYTO-139).
  scratch = mkdtempSync(join(tmpdir(), 'tyto-preview-broken-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the preview says why nothing is drawn', () => {
  it('asks for a brief while the buffer is empty', async () => {
    await expect.poll(() => empty().isVisible()).toBe(true);
    expect(await broken().isVisible()).toBe(false);
    expect(await paper().isVisible()).toBe(false);
    expect(await empty().textContent()).toBe(translate('en', 'preview.empty'));
  });

  it('says the brief has an error when it names a template that does not exist', async () => {
    await replaceText(UNKNOWN);

    await expect.poll(() => broken().isVisible(), { timeout: 10_000 }).toBe(true);
    expect(await broken().textContent()).toBe(translate('en', 'preview.broken'));
    // One line or the other: the old one under a written brief is what this card removed.
    expect(await empty().isVisible()).toBe(false);
    expect(await paper().isVisible()).toBe(false);
    expect(await stale().isVisible()).toBe(false);
  });

  it('asks for a brief again once the buffer is emptied', async () => {
    await replaceText('');

    await expect.poll(() => empty().isVisible(), { timeout: 10_000 }).toBe(true);
    expect(await broken().isVisible()).toBe(false);
  });

  it('keeps older artwork, marked stale, when a brief that drew turns fatal', async () => {
    await replaceText(GOOD);
    await expect.poll(() => shown(), { timeout: 10_000 }).not.toBe('');
    await expect.poll(() => stale().isVisible(), { timeout: 10_000 }).toBe(false);
    const before = await shown();

    await replaceText(UNKNOWN);

    // Rule (c) of the card, unchanged since E9.13: the last artwork that worked stays on
    // screen with the "older than the text" line over it, and neither empty line shows —
    // the picture is there, so there is nothing to explain the absence of.
    await expect.poll(() => stale().isVisible(), { timeout: 10_000 }).toBe(true);
    expect(await paper().isVisible()).toBe(true);
    expect(await shown()).toBe(before);
    expect(await broken().isVisible()).toBe(false);
    expect(await empty().isVisible()).toBe(false);
  });
});

/**
 * The screenshots the card asks for, taken only when `TYTO_PREVIEW_BROKEN_SHOTS` names a
 * folder: Rafael approves the wording by looking, in Portuguese, in both themes.
 */
describe.runIf(shots !== undefined)('screenshots', () => {
  it('shoots the broken line in pt-BR, light and dark', async () => {
    const folder = shots ?? '';
    mkdirSync(folder, { recursive: true });
    // Playwright forces `light` unless told not to; `null` hands the query back to Electron.
    await page.emulateMedia({ colorScheme: null });
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('shell.toggleLocale');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.documentElement.lang === 'pt-BR');

    // A new tab, so the pane has no older artwork to keep and the broken line shows.
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+n');
    await expect.poll(() => empty().isVisible(), { timeout: 10_000 }).toBe(true);
    await replaceText(UNKNOWN);
    await expect.poll(() => broken().isVisible(), { timeout: 10_000 }).toBe(true);

    for (const scheme of ['light', 'dark'] as const) {
      await app.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source;
      }, scheme);
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(folder, `268-broken-pt-BR-${scheme}.png`) });
    }
  }, 60_000);
});
