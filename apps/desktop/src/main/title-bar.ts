import type { ThemeColors, ThemeKind } from '@tyto/plugin-api';

/**
 * The window's frame on Windows and Linux: no system title bar, the app's own drawn in the
 * page, and the system's minimise, maximise and close buttons kept as an overlay on top of it
 * (TYTO-244, ADR 0078).
 *
 * **macOS keeps its native frame.** The traffic lights, the menu bar and the title are the
 * system's there, and nobody can look at a Mac before the next tag; changing a frame nobody has
 * seen is how a window ends up with two titles or none. So this module answers nothing for
 * `darwin` and the window is built exactly as before.
 *
 * Pure, and `import type` only, so `pnpm check` reads every answer without an Electron.
 */

/**
 * The bar's height, in device-independent pixels.
 *
 * The overlay is drawn at this height by the system and the page reads it back through
 * `env(titlebar-area-height)`, so the two cannot disagree; the page's fallback for the same
 * number is in `shell.css`, for a window that has no overlay.
 */
export const TITLE_BAR_HEIGHT = 32;

/** What `BrowserWindow`'s `titleBarOverlay` and `setTitleBarOverlay` take. */
export interface TitleBarOverlay {
  /** The buttons' background: the bar's own colour, so the overlay reads as part of it. */
  readonly color: string;
  /** The glyphs on the buttons. */
  readonly symbolColor: string;
  readonly height: number;
}

/** The two theme roles the overlay takes, and the reason it takes them. */
const BAR = 'surface-raised';
const SYMBOL = 'text';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;
const HEX_WITH_ALPHA = /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/iu;

/**
 * A theme value the system can paint, or nothing.
 *
 * A theme may write any colour ADR 0077 allows — `rgb()`, `hsl()`, `color-mix()` — and the
 * page resolves all of them, but the overlay is painted by Electron's own colour parser, which
 * does not know `color-mix()` or the space-separated `rgb(0 0 0 / 12%)`. Hex is the one form
 * both read alike, so it is the one form taken; an alpha channel is dropped, because the
 * buttons sit on the window's frame and there is nothing behind them to show through.
 */
export function overlayColour(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (HEX.test(trimmed)) return trimmed.toLowerCase();
  if (HEX_WITH_ALPHA.test(trimmed)) {
    return (trimmed.length === 5 ? trimmed.slice(0, 4) : trimmed.slice(0, 7)).toLowerCase();
  }
  return undefined;
}

/**
 * The overlay for the theme on show, from its colours and the base theme of its kind.
 *
 * Each colour falls back to the base theme's on its own, the way a theme's tokens do (ADR
 * 0077): a third party's `color-mix()` bar costs the buttons that one colour — they show Tyto's
 * — and never the window. The built-in themes are hex throughout, so on them the buttons and
 * the drawn bar are the same colour exactly.
 */
export function titleBarOverlay(colors: ThemeColors, base: ThemeColors): TitleBarOverlay {
  return {
    color: overlayColour(colors[BAR]) ?? overlayColour(base[BAR]) ?? '#000000',
    symbolColor: overlayColour(colors[SYMBOL]) ?? overlayColour(base[SYMBOL]) ?? '#ffffff',
    height: TITLE_BAR_HEIGHT,
  };
}

/** Whether this platform draws its own title bar. */
export const drawsTitleBar = (platform: string): boolean => platform !== 'darwin';

/**
 * The `BrowserWindow` options for the frame: hidden title bar and an overlay on Windows and
 * Linux, nothing at all on macOS.
 */
export function frameOptions(
  platform: string,
  overlay: TitleBarOverlay,
): { readonly titleBarStyle?: 'hidden'; readonly titleBarOverlay?: TitleBarOverlay } {
  return drawsTitleBar(platform) ? { titleBarStyle: 'hidden', titleBarOverlay: overlay } : {};
}

/**
 * The overlay for what the window shows now: the applied theme of the kind Electron answers
 * (`nativeTheme.shouldUseDarkColors`), over the base theme of that kind.
 */
export function overlayFor(
  applied: Readonly<Record<ThemeKind, { readonly colors: ThemeColors }>>,
  base: Readonly<Record<ThemeKind, ThemeColors>>,
  shown: ThemeKind,
): TitleBarOverlay {
  return titleBarOverlay(applied[shown].colors, base[shown]);
}
