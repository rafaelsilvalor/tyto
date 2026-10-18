import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import {
  SCENES,
  type SceneWindow,
  type Shot,
  parseOnly,
  proofText,
  shotPath,
  shotsOf,
} from './docs-shots/scenes.js';
import { firstWindow } from './first-window.js';

/**
 * Photographs the real window for the user manual (TYTO-315, ADR 0102).
 *
 * `pnpm --filter @tyto/desktop shots`, after a build. Every scene in `docs-shots/scenes.ts`,
 * in each language and each theme, one launch per picture, written to
 * `apps/docs/pages/public/screenshots/<locale>/<scene>-<theme>.png`. `TYTO_SHOTS_ONLY` names the
 * scenes to take again (comma-separated); `TYTO_SHOTS_OUT` writes somewhere else, which is how
 * two runs are compared.
 *
 * **Not a suite of the app.** Its name ends in `.shots.test.ts`, so neither `pnpm check` nor
 * `test:desktop` runs it, and no workflow does: it runs when somebody asks for the pictures.
 * It is still a `*.test.ts` in `e2e/`, so `launch-isolation.test.ts` reads every launch below.
 *
 * **How each axis is forced:**
 * - **Theme** — the `theme` setting, seeded in the launch's own `settings.json` with a fixed id,
 *   so the system's light or dark plays no part; the body's colour is waited for.
 * - **Language** — main and the window both start from `app.getLocale()`, which follows the
 *   machine, and `--lang` is what it answers instead. Should a window still come up in the
 *   other language, `shell.toggleLocale` — the command a person runs — moves it until
 *   `<html lang>` is the one asked for. Each scene then proves it with one translated string.
 * - **Scale** — `--force-device-scale-factor=1`, so a picture's pixels are the window's size on
 *   every monitor, and every PNG is checked to be exactly that size.
 *
 * The capture is Playwright's page screenshot, which reads the page through the DevTools
 * protocol and never the screen: a screen copy once captured another application.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const BRIEFS = join(here, 'docs-shots', '__fixtures__', 'briefs');
const TEMPLATES = join(here, 'docs-shots', '__fixtures__', 'templates');
// `pages/public` and not `public`: the site's `srcDir` is `pages`, and VitePress serves static
// files from `<srcDir>/public`.
const DEFAULT_OUT = join(here, '..', '..', 'docs', 'pages', 'public', 'screenshots');

const out = process.env['TYTO_SHOTS_OUT'] ?? DEFAULT_OUT;
const shots = shotsOf(SCENES, parseOnly(process.env['TYTO_SHOTS_ONLY']));

let app: ElectronApplication | undefined;
let scratch: string | undefined;

afterEach(async () => {
  await closeApp(app);
  app = undefined;
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

/** Runs a command the way the command bar would, and fails if the window refused it. */
async function runCommand(page: Page, commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the window refused '${commandId}'`);
}

/** Opens a fixture brief through File > Open, with main's file picker answering it. */
async function openBrief(launched: ElectronApplication, page: Page, file: string): Promise<void> {
  await launched.evaluate(
    ({ dialog }, path) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    },
    join(BRIEFS, file),
  );
  await runCommand(page, 'editor.open');
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('.tabs__label')].some(
        (label) => label.textContent?.trim() === name,
      ),
    file,
  );
}

/** Moves the window to `locale` through the command a person runs, and waits until it is. */
async function useLocale(page: Page, locale: string): Promise<void> {
  const current = (): Promise<string> => page.evaluate(() => document.documentElement.lang);
  if ((await current()) !== locale) await runCommand(page, 'shell.toggleLocale');
  await page.waitForFunction((wanted) => document.documentElement.lang === wanted, locale, {
    polling: 25,
    timeout: 15_000,
  });
}

/** Launches the app for one picture, in its own folders, in the shot's theme and language. */
async function launchFor(shot: Shot): Promise<Page> {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-docs-shots-'));
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  // Written the way a person would keep the file, since the settings scene shows it.
  const settings = {
    theme: shot.theme.id,
    ...(shot.scene.brief === undefined ? {} : { templatesFolder: TEMPLATES }),
  };
  writeFileSync(join(userData, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  app = await _electron.launch({
    args: [
      '.',
      `--user-data-dir=${join(scratch, 'user-data')}`,
      `--lang=${shot.locale}`,
      '--force-device-scale-factor=1',
    ],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  const page = await firstWindow(app);
  // `runCommand` is refused until the editor exists, and `.shell` is in the static markup.
  await page.waitForSelector('#editor .cm-content');
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
  }, shot.scene.size);
  try {
    await page.waitForFunction(
      (size) => window.innerWidth === size.width && window.innerHeight === size.height,
      shot.scene.size,
      { timeout: 15_000 },
    );
  } catch (cause) {
    const seen = await page.evaluate(
      () => `${window.innerWidth}x${window.innerHeight} at ${window.devicePixelRatio}x`,
    );
    const { width, height } = shot.scene.size;
    throw new Error(`the window never became ${width}x${height}; it is ${seen}`, { cause });
  }
  await useLocale(page, shot.locale);
  return page;
}

/** Waits until nothing the picture shows is still arriving: theme, fonts, two quiet frames. */
async function settle(page: Page, shot: Shot): Promise<void> {
  try {
    await page.waitForFunction(
      (surface) => getComputedStyle(document.body).backgroundColor === surface,
      shot.theme.surface,
      { polling: 25, timeout: 15_000 },
    );
  } catch (cause) {
    const seen = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    throw new Error(
      `the body never took ${shot.theme.id}'s surface ${shot.theme.surface}; it is ${seen}`,
      { cause },
    );
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

describe('the manual’s pictures of the window', () => {
  it.each(shots.map((shot) => [shotPath(shot), shot] as const))(
    '%s',
    async (path, shot) => {
      if (!existsSync(built)) {
        throw new Error(`${built} is missing — run \`pnpm build\` before the shots`);
      }
      const page = await launchFor(shot);
      const launched = app!;
      const sceneWindow: SceneWindow = {
        page,
        run: (commandId) => runCommand(page, commandId),
        openBrief: (file) => openBrief(launched, page, file),
      };
      if (shot.scene.brief !== undefined) await sceneWindow.openBrief(shot.scene.brief);
      await shot.scene.arrange(sceneWindow);
      await settle(page, shot);

      const shown = await page.evaluate(({ selector, attribute }) => {
        const element = document.querySelector(selector);
        if (element === null) return null;
        const text =
          attribute === undefined ? element.textContent : element.getAttribute(attribute);
        return text?.trim() ?? null;
      }, shot.scene.proof);
      // Equal, not contained: 'Exportar' contains 'Export', so a containment check would pass
      // an English picture taken in a Portuguese window.
      expect(shown, `'${shot.scene.proof.selector}' in ${shot.locale}`).toBe(
        proofText(shot.scene, shot.locale),
      );

      // `caret: 'hide'` and `animations: 'disabled'` are what make two runs agree: a blinking
      // caret and a transition caught half-way are the only parts of a settled window that move.
      const bytes = await page.screenshot({ caret: 'hide', animations: 'disabled' });
      const png = PNG.sync.read(bytes);
      expect({ width: png.width, height: png.height }).toEqual(shot.scene.size);

      const file = join(out, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    },
    180_000,
  );
});
