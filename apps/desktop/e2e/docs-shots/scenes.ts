import type { Page } from 'playwright';

import type { CatalogueKey } from '../../shared/i18n/catalogue.js';
import { type Locale, translate } from '../../shared/i18n/index.js';

/**
 * The pictures of the window the user manual shows, declared once (TYTO-315, ADR 0102).
 *
 * **A scene is a name, a brief, a window size and the steps that arrange it.** The runner
 * (`e2e/docs-shots.shots.test.ts`) photographs every scene in every language and every theme
 * below, each in a launch of its own, so a card that changes the window regenerates the
 * pictures it touched by name: `TYTO_SHOTS_ONLY=command-bar-open pnpm --filter @tyto/desktop shots`.
 *
 * This module is pure data and pure functions — it imports Playwright for its types only — so
 * `scenes.test.ts` holds the list to its rules inside `pnpm check`, where nothing launches.
 */

/** The languages every scene is taken in: each one is a folder of the manual's images. */
export const SHOT_LOCALES = ['en', 'pt-BR'] as const satisfies readonly Locale[];

export type ShotLocale = (typeof SHOT_LOCALES)[number];

/**
 * The two built-in themes, by the id the `theme` setting takes, with the colour the window's
 * body has once that theme is applied — what the runner waits for before it takes a picture,
 * because a capture taken before the theme lands is a light window with a dark file name.
 * The colours are `--tyto-surface` in each theme, the same values `theme.desktop.test.ts` holds.
 */
export const SHOT_THEMES = [
  { id: 'tyto-light', surface: 'rgb(250, 250, 250)' },
  { id: 'tyto-dark', surface: 'rgb(40, 44, 51)' },
] as const;

export type ShotTheme = (typeof SHOT_THEMES)[number];

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The largest window a scene may ask for: the Linux runner's display under `xvfb`.
 *
 * A window bigger than the display it is on comes back cut to that display without an error —
 * a 1080x1920 story measured 1080x1024 on CI — so a scene that fits this fits everywhere.
 */
export const LARGEST_WINDOW: WindowSize = { width: 1280, height: 1024 };

/** What a scene's steps can do to the window they arrange. */
export interface SceneWindow {
  readonly page: Page;
  /** Runs a command by id, as the command bar would, and fails if the window refused it. */
  run(commandId: string): Promise<void>;
  /** Opens one of the briefs in `docs-shots/__fixtures__/briefs` through the window's own Open. */
  openBrief(file: string): Promise<void>;
}

export interface Scene {
  /** The file name the pictures carry, and what `TYTO_SHOTS_ONLY` names. */
  readonly name: string;
  /**
   * The brief in `docs-shots/__fixtures__/briefs` the scene opens before it is arranged, or none.
   *
   * A scene with a brief gets the fixture templates folder in its settings, which is a path on
   * the machine that took the picture; a scene that shows `settings.json` opens no brief, so
   * the file it shows holds the theme and nothing of that machine.
   */
  readonly brief?: string;
  readonly size: WindowSize;
  /**
   * A string the scene shows in the window's language, and where: the proof that the
   * language was applied. The runner fails a picture whose element does not hold exactly
   * `translate(locale, key)` — in its text, or in `attribute` when the string is one the
   * element carries rather than prints — so a language switch that silently did not happen
   * cannot fill the `pt-BR` folder with English windows.
   */
  readonly proof: {
    readonly selector: string;
    readonly key: CatalogueKey;
    readonly attribute?: string;
  };
  readonly arrange: (window: SceneWindow) => Promise<void>;
}

/** The size most scenes use: a laptop's window, and well inside {@link LARGEST_WINDOW}. */
const LAPTOP: WindowSize = { width: 1280, height: 800 };

/** Opens the following preview beside the brief, retrying until the window accepts it. */
async function previewBeside(page: Page): Promise<void> {
  const tab = '[data-tab-kind="preview"]';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await page.$(tab)) !== null) break;
    await page.focus('#editor .cm-content');
    await page.keyboard.press('Control+Shift+V');
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('tyto-preview-pane:not([hidden]) .preview__paper iframe', {
    timeout: 30_000,
  });
}

export const SCENES: readonly Scene[] = [
  {
    name: 'window-tour',
    brief: 'reading-list.brief',
    size: LAPTOP,
    proof: { selector: '#problems-heading', key: 'problems.heading' },
    arrange: async ({ page }) => {
      await previewBeside(page);
    },
  },
  {
    name: 'command-bar-open',
    brief: 'reading-list.brief',
    size: LAPTOP,
    proof: {
      selector: '.command-bar__input',
      key: 'command.bar.placeholder',
      attribute: 'placeholder',
    },
    arrange: async ({ page }) => {
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.command-bar__input', { state: 'visible' });
    },
  },
  {
    name: 'problems-panel',
    brief: 'with-a-mistake.brief',
    size: LAPTOP,
    proof: { selector: '#problems-heading', key: 'problems.heading' },
    arrange: async ({ page }) => {
      await page.waitForSelector('button.problems__row', { timeout: 30_000 });
    },
  },
  {
    name: 'export-dialog',
    brief: 'reading-list.brief',
    size: LAPTOP,
    proof: { selector: '.export__title', key: 'export.heading' },
    arrange: async ({ page, run }) => {
      await run('file.export');
      await page.locator('.export__panel').waitFor({ state: 'visible' });
    },
  },
  {
    name: 'settings-tab',
    size: LAPTOP,
    // The empty Problems panel names the file (TYTO-322), so this proof also fails if the
    // window never tells the panel what is in front.
    proof: { selector: '.problems__empty', key: 'problems.empty.settings' },
    arrange: async ({ page, run }) => {
      await run('settings.open');
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.tabs__tab')].some((tab) =>
          (tab.textContent ?? '').includes('settings.json'),
        ),
      );
    },
  },
];

/** One picture: a scene, in one language and one theme. */
export interface Shot {
  readonly scene: Scene;
  readonly locale: ShotLocale;
  readonly theme: ShotTheme;
}

/**
 * Every picture the scenes make, or only those of the scenes `only` names.
 *
 * A name in `only` that no scene has is an error and not an empty run: a typo would otherwise
 * regenerate nothing and report success.
 */
export function shotsOf(scenes: readonly Scene[], only: readonly string[] = []): Shot[] {
  const unknown = only.filter((name) => !scenes.some((scene) => scene.name === name));
  if (unknown.length > 0) {
    throw new Error(`no scene is named ${unknown.map((name) => `'${name}'`).join(', ')}`);
  }
  const chosen = only.length === 0 ? scenes : scenes.filter((scene) => only.includes(scene.name));
  return chosen.flatMap((scene) =>
    SHOT_LOCALES.flatMap((locale) => SHOT_THEMES.map((theme) => ({ scene, locale, theme }))),
  );
}

/** Where a picture goes, relative to the screenshots folder: `<locale>/<scene>-<theme>.png`. */
export function shotPath(shot: Shot): string {
  return `${shot.locale}/${shot.scene.name}-${shot.theme.id}.png`;
}

/** The names `TYTO_SHOTS_ONLY` holds, comma-separated; none means every scene. */
export function parseOnly(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/** What the window must say in `locale` for the scene's proof to hold. */
export function proofText(scene: Scene, locale: ShotLocale): string {
  return translate(locale, scene.proof.key);
}

/** Every rule the scene list breaks, one sentence each; empty when it breaks none. */
export function sceneProblems(scenes: readonly Scene[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const scene of scenes) {
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(scene.name)) {
      problems.push(`'${scene.name}' is not a kebab-case file name`);
    }
    if (seen.has(scene.name)) problems.push(`'${scene.name}' is declared twice`);
    seen.add(scene.name);
    const { width, height } = scene.size;
    if (width > LARGEST_WINDOW.width || height > LARGEST_WINDOW.height) {
      problems.push(
        `'${scene.name}' asks for ${width}x${height}, larger than ` +
          `${LARGEST_WINDOW.width}x${LARGEST_WINDOW.height}: it would be cut to the display`,
      );
    }
    const texts = SHOT_LOCALES.map((locale) => proofText(scene, locale));
    if (new Set(texts).size !== texts.length) {
      problems.push(
        `'${scene.name}' proves its language with '${scene.proof.key}', which reads ` +
          `'${texts[0]}' in more than one language and so proves nothing`,
      );
    }
  }
  return problems;
}
