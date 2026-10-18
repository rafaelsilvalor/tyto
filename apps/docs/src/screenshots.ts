import { PT_BR } from './sections';

/**
 * Where a picture of the window lives, for a page in a given language (ADR 0102).
 *
 * The pictures are taken by `pnpm --filter @tyto/desktop shots` in each language and each
 * built-in theme, as `pages/public/screenshots/<locale>/<scene>-<theme>.png`. A page names a
 * scene and nothing else: the `<Screenshot>` component turns the name into both theme files
 * for the page's language, and `test/screenshots.test.ts` holds every name a page uses to a
 * pair of files that exist.
 */

/** The two themes every scene is taken in, by the id the app's `theme` setting takes. */
export const SCREENSHOT_THEMES = ['tyto-light', 'tyto-dark'] as const;

export type ScreenshotTheme = (typeof SCREENSHOT_THEMES)[number];

/** The pictures' folder for a page's `lang`: the pt-BR ones, or English for anything else. */
export const screenshotLocale = (lang: string): 'en' | typeof PT_BR =>
  lang === PT_BR ? PT_BR : 'en';

/** The site path of one scene's picture in one theme, as the page's `<img src>` names it. */
export const screenshotPath = (lang: string, scene: string, theme: ScreenshotTheme): string =>
  `/screenshots/${screenshotLocale(lang)}/${scene}-${theme}.png`;

/**
 * A numbered circle drawn over a picture, at a point given in percent of its width and
 * height, so it lands on the same part of the window at any size the page draws it.
 */
export interface ScreenshotMarker {
  readonly n: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Every scene a page's Markdown names in a `<Screenshot scene="…">` tag, in order.
 *
 * A regular expression and not a Vue parser: the tag is ours, written one way in the pages,
 * and a tag this misses is one whose picture is not checked — which the test's own count of
 * tags on the tour page would show.
 */
export const screenshotScenes = (markdown: string): string[] =>
  [...markdown.matchAll(/<Screenshot\b[^>]*?\bscene="([^"]+)"/gu)].map((match) => match[1] ?? '');
