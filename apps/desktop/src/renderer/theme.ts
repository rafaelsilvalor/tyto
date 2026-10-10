import type { IpcResponse } from '../../shared/ipc.js';

/**
 * Applies the colours main resolved for each system mode (TYTO-208, ADR 0077).
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

type Applied = IpcResponse<'theme:current'>;

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
