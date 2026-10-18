import type { IpcResponse } from '../../shared/ipc.js';
import {
  type StatusBarColors,
  VIM_COLOUR_MODES,
  statusBarOverride,
} from '../../shared/status-bar-colors.js';
import { type VimModeStyle, vimBarText } from '../../shared/vim-mode-style.js';
import { typographyDeclarations } from './typography.js';

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

/**
 * The colours, and the icons' stroke when the answer carries it (TYTO-288): the mode is
 * Electron's to answer, and the problems the panel's.
 */
type Applied = Pick<IpcResponse<'theme:current'>, 'light' | 'dark'> &
  Partial<
    Pick<
      IpcResponse<'theme:current'>,
      'iconStrokeWidth' | 'statusBarColors' | 'vimModeStyle' | 'typography'
    >
  >;

const declarations = (colors: Readonly<Record<string, string>>): string =>
  Object.entries(colors)
    .map(([token, value]) => `  --tyto-${token}: ${value};`)
    .join('\n');

/**
 * The `statusBarColors` override for one theme (TYTO-301, ADR 0091): the bar's properties on
 * `.shell__foot` — doubled, so it wins over `shell.css` in any order — and each item's text
 * colour on that item. Empty when the setting is. Per theme, because a vim badge's text is the
 * best-reading colour of that theme. Keys and values are checked by the bridge's schema: an
 * item id is one of thirteen words and a colour is hex, so neither can close a rule.
 */
function overrideRules(
  colors: StatusBarColors | undefined,
  theme: Readonly<Record<string, string>>,
): string {
  if (colors === undefined) return '';
  const { bar, items } = statusBarOverride(colors, theme);
  const rules: string[] = [];
  const barDeclarations = Object.entries(bar).map(([name, value]) => `  ${name}: ${value};`);
  if (barDeclarations.length > 0) {
    rules.push(`.shell__foot.shell__foot {\n${barDeclarations.join('\n')}\n}`);
  }
  for (const [id, value] of Object.entries(items)) {
    rules.push(`.shell__foot [data-item='${id}'] {\n  --status-bar-item-text: ${value};\n}`);
  }
  return rules.map((rule) => `\n${rule}`).join('');
}

/**
 * The text of the whole bar in each of vim's modes under `vimModeStyle: "bar"` (TYTO-301, ADR
 * 0091): `--status-bar-mode-text` on the bar while it shows that mode, which `shell.css` puts
 * before the bar's own text. Chosen per theme, as a badge's text is (`vimBarText`), from the
 * mode's colour the bar wears — the override's where `statusBarColors` names one. Nothing under
 * the other two styles, which write no text on the mode's colour but the badge's own.
 */
function vimBarRules(
  style: VimModeStyle | undefined,
  theme: Readonly<Record<string, string>>,
  colors: StatusBarColors | undefined,
): string {
  if (style !== 'bar') return '';
  const text = vimBarText(theme, colors);
  return VIM_COLOUR_MODES.flatMap((mode) => {
    const colour = text[mode];
    return colour === undefined
      ? []
      : [
          `\n.shell__foot.shell__foot[data-vim-style='bar'][data-vim-mode='${mode}'] {\n` +
            `  --status-bar-mode-text: ${colour};\n}`,
        ];
  }).join('');
}

/**
 * The sheet's text: light under `:root`, dark under the system's dark mode. The icons' stroke
 * is the `iconStrokeWidth` setting, the same in both (TYTO-288), over `tokens.css`'s default.
 * The status bar's override follows each mode's colours, and so does the text vim's `bar`
 * style writes on the bar (TYTO-301).
 */
export function themeSheet(applied: Applied): string {
  const stroke =
    applied.iconStrokeWidth === undefined
      ? ''
      : `\n  --tyto-icon-stroke: ${String(applied.iconStrokeWidth)};`;
  // The person's faces and sizes (TYTO-272), the same in both modes: fonts are not theme data.
  const type = applied.typography === undefined ? '' : typographyDeclarations(applied.typography);
  const light =
    overrideRules(applied.statusBarColors, applied.light.colors) +
    vimBarRules(applied.vimModeStyle, applied.light.colors, applied.statusBarColors);
  const dark =
    overrideRules(applied.statusBarColors, applied.dark.colors) +
    vimBarRules(applied.vimModeStyle, applied.dark.colors, applied.statusBarColors);
  return [
    `:root:root {\n${declarations(applied.light.colors)}${stroke}${type}\n}${light}`,
    `@media (prefers-color-scheme: dark) {\n:root:root {\n${declarations(applied.dark.colors)}\n}${dark}\n}`,
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
