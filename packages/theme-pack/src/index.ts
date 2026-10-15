import type { Plugin, ThemeContribution } from '@tyto/plugin-api';

import manifest from '../tyto-plugin.json';
import catppuccinLatte from './themes/catppuccin-latte.json';
import catppuccinMocha from './themes/catppuccin-mocha.json';
import draculaAdjusted from './themes/dracula-adjusted.json';
import dracula from './themes/dracula.json';
import gruvboxDarkAdjusted from './themes/gruvbox-dark-adjusted.json';
import gruvboxDark from './themes/gruvbox-dark.json';
import gruvboxLightAdjusted from './themes/gruvbox-light-adjusted.json';
import gruvboxLight from './themes/gruvbox-light.json';
import nordAdjusted from './themes/nord-adjusted.json';
import nord from './themes/nord.json';
import oneDarkAdjusted from './themes/one-dark-adjusted.json';
import oneDark from './themes/one-dark.json';
import solarizedDarkAdjusted from './themes/solarized-dark-adjusted.json';
import solarizedDark from './themes/solarized-dark.json';
import solarizedLightAdjusted from './themes/solarized-light-adjusted.json';
import solarizedLight from './themes/solarized-light.json';
import tokyoNightAdjusted from './themes/tokyo-night-adjusted.json';
import tokyoNightLightAdjusted from './themes/tokyo-night-light-adjusted.json';
import tokyoNightLight from './themes/tokyo-night-light.json';
import tokyoNight from './themes/tokyo-night.json';

/**
 * Well-known colour themes, ported to Tyto's tokens and shipped as a plugin through the
 * `theme` point a third party uses (TYTO-300, ADR 0077, ADR 0089).
 *
 * **The files are imported, never read.** The desktop bundles this package into main, and a
 * package that found its files relative to its own folder would look for them beside the
 * bundle, where they are not (architecture.md, on `@tyto/fonts` and `@tyto/templates`). So
 * the theme files travel as data in the bundle and the host's reader answers from
 * `THEME_PACK_FILES`, by the path each contribution names.
 *
 * Every theme here sets all forty tokens rather than leaning on the base theme's fallback.
 * A theme whose upstream colours meet the contrast floors of ADR 0089 ships once. One that
 * does not ships twice, side by side in the picker: the original, upstream's colours exactly
 * and exempt from the floors, and `<Name> (adjusted)`, which meets them and names each colour
 * it changed in `adjusted` (Rafael, 2026-10-15).
 *
 * Vim's mode badge is the exception to "upstream's colours exactly" (TYTO-301): no upstream
 * has one, so its colours are Tyto's, derived from a role and held to 4.5:1 in every theme,
 * originals included. Where a role's colour is moved to get there, `derived` says so; both of
 * a pair draw the same badge, so the move never makes a theme a pair.
 */

/** The plugin's id, which is its manifest's name. */
export const THEME_PACK_ID = manifest.name;

/** A theme file as this package writes it: ADR 0077's shape plus what was changed. */
export interface ThemePackFile {
  readonly name: string;
  readonly kind: 'light' | 'dark';
  /**
   * Which of a pair this file is; absent for a theme that ships once. Its id is the twin's
   * plus `-adjusted`, so a saved `theme` setting keeps meaning the same colours.
   */
  readonly variant?: ThemeVariant;
  readonly colors: Readonly<Record<string, string>>;
  /** Each colour changed from upstream to meet a floor, with the value it replaced. */
  readonly adjusted: readonly ThemeAdjustment[];
  /** Each vim badge colour that is not its role's colour, with why (TYTO-301, ADR 0089). */
  readonly derived: readonly ThemeDerivation[];
}

/**
 * A badge colour moved off the role it derives from — `accent` for normal, `success` for
 * insert, `syntax-keyword` for visual, `error` for replace — to read 4.5:1.
 */
export interface ThemeDerivation {
  readonly token: string;
  readonly role: string;
  readonly value: string;
  readonly reason: string;
}

/** `original`: upstream's colours, exempt from the floors. `adjusted`: changed to meet them. */
export type ThemeVariant = 'original' | 'adjusted';

export interface ThemeAdjustment {
  readonly token: string;
  readonly upstream: string;
  readonly value: string;
  readonly reason: string;
}

const theme = (id: string, file: ThemePackFile): ThemeContribution & { file: ThemePackFile } => ({
  id,
  label: file.name,
  kind: file.kind,
  path: `themes/${id}.json`,
  file,
});

// Each original right above its adjusted twin, so the two read as a pair in the picker.
const THEMES = [
  theme('dracula', dracula as ThemePackFile),
  theme('dracula-adjusted', draculaAdjusted as ThemePackFile),
  theme('catppuccin-latte', catppuccinLatte as ThemePackFile),
  theme('catppuccin-mocha', catppuccinMocha as ThemePackFile),
  theme('one-dark', oneDark as ThemePackFile),
  theme('one-dark-adjusted', oneDarkAdjusted as ThemePackFile),
  theme('nord', nord as ThemePackFile),
  theme('nord-adjusted', nordAdjusted as ThemePackFile),
  theme('solarized-dark', solarizedDark as ThemePackFile),
  theme('solarized-dark-adjusted', solarizedDarkAdjusted as ThemePackFile),
  theme('solarized-light', solarizedLight as ThemePackFile),
  theme('solarized-light-adjusted', solarizedLightAdjusted as ThemePackFile),
  theme('gruvbox-dark', gruvboxDark as ThemePackFile),
  theme('gruvbox-dark-adjusted', gruvboxDarkAdjusted as ThemePackFile),
  theme('gruvbox-light', gruvboxLight as ThemePackFile),
  theme('gruvbox-light-adjusted', gruvboxLightAdjusted as ThemePackFile),
  theme('tokyo-night', tokyoNight as ThemePackFile),
  theme('tokyo-night-adjusted', tokyoNightAdjusted as ThemePackFile),
  theme('tokyo-night-light', tokyoNightLight as ThemePackFile),
  theme('tokyo-night-light-adjusted', tokyoNightLightAdjusted as ThemePackFile),
];

/** Every theme the pack registers, in the order the picker lists them. */
export const THEME_PACK_THEMES: readonly ThemeContribution[] = THEMES.map(
  ({ id, label, kind, path }) => ({ id, label, kind, path }),
);

/** Each theme's file, by the path its contribution names. */
export const THEME_PACK_FILES: Readonly<Record<string, ThemePackFile>> = Object.fromEntries(
  THEMES.map(({ path, file }) => [path, file]),
);

/**
 * Which of a pair each theme is, by id, for a picker that tells the two apart. A theme that
 * ships once is not listed.
 */
export const THEME_PACK_VARIANTS: Readonly<Record<string, ThemeVariant>> = Object.fromEntries(
  THEMES.flatMap(({ id, file }) => (file.variant === undefined ? [] : [[id, file.variant]])),
);

/** The plugin: it registers its themes and does nothing else. */
export const themePack: Plugin = {
  id: THEME_PACK_ID,
  manifest,
  activate: (host) => {
    for (const contribution of THEME_PACK_THEMES) host.registerTheme(contribution);
  },
};
