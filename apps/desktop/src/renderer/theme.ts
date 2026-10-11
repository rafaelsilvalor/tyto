import type { IpcResponse } from '../../shared/ipc.js';

/**
 * Applies the colours main resolved for each system mode (TYTO-208, ADR 0077): the themes the
 * `theme` setting chooses, or the one "Preferences: Color Theme" is previewing. Which of the
 * two shows is Electron's answer to `prefers-color-scheme`, which main sets from the
 * setting's mode, so this sheet never needs to know it.
 *
 * `tokens.css` paints the first frame and stays the fallback; this sheet, written once the
 * answer arrives, sets the same custom properties to the theme's values. Both modes go in one
 * sheet, the dark one under the same media query `tokens.css` uses, so a change of the system's
 * mode is still CSS alone and switches with no message and no restart.
 *
 * **`:root:root`**, so the theme wins over `tokens.css` whatever order the two sheets land in —
 * Vite injects styles itself in development. A `<style>` element and not a constructed sheet,
 * because the window's policy already allows inline styles and jsdom can read one back.
 *
 * The values were checked twice before they get here: by main against the theme grammar, and
 * by the bridge's schema on this side. A name is a role's spelling and a value is a colour, so
 * neither can close the declaration it is written into.
 */

const SHEET_ID = 'tyto-theme';

/** The colours alone: the mode is Electron's to answer, and the problems the panel's. */
type Applied = Pick<IpcResponse<'theme:current'>, 'light' | 'dark'>;

const declarations = (colors: Readonly<Record<string, string>>): string =>
  Object.entries(colors)
    .map(([token, value]) => `  --tyto-${token}: ${value};`)
    .join('\n');

/** The sheet's text: light under `:root`, dark under the system's dark mode. */
export function themeSheet(applied: Applied): string {
  return [
    `:root:root {\n${declarations(applied.light.colors)}\n}`,
    `@media (prefers-color-scheme: dark) {\n:root:root {\n${declarations(applied.dark.colors)}\n}\n}`,
  ].join('\n');
}

/**
 * The codes reading a theme can raise (ADR 0077). Their rows in the problems panel are the
 * applied themes' and nothing else's, so each answer replaces them all.
 */
export const THEME_CODES: ReadonlySet<string> = new Set([
  'E_THEME_INVALID',
  'W_THEME_TOKEN_UNKNOWN',
  'W_THEME_COLOR_INVALID',
]);

/** The installation rows with the theme rows replaced by what this answer said. */
export function withThemeRows<Row extends { readonly code: string }>(
  installation: readonly Row[],
  themeRows: readonly Row[],
): readonly Row[] {
  return [...installation.filter((row) => !THEME_CODES.has(row.code)), ...themeRows];
}

/** Writes the sheet into `document`, replacing the one a previous call wrote. */
export function applyTheme(applied: Applied, target: Document = document): void {
  let sheet = target.getElementById(SHEET_ID);
  if (sheet === null) {
    sheet = target.createElement('style');
    sheet.id = SHEET_ID;
    target.head.append(sheet);
  }
  sheet.textContent = themeSheet(applied);
}
