import type { Plugin, ThemeContribution } from '@tyto/plugin-api';

import manifest from '../tyto-plugin.json';
import catppuccinLatte from './themes/catppuccin-latte.json';
import dracula from './themes/dracula.json';

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
 * Every theme here sets all thirty tokens rather than leaning on the base theme's fallback,
 * and is held to the contrast floors of ADR 0089. Where an upstream colour fails a floor the
 * file carries an `adjusted` entry naming the colour it replaced.
 */

/** The plugin's id, which is its manifest's name. */
export const THEME_PACK_ID = manifest.name;

/** A theme file as this package writes it: ADR 0077's shape plus what was changed. */
export interface ThemePackFile {
  readonly name: string;
  readonly kind: 'light' | 'dark';
  readonly colors: Readonly<Record<string, string>>;
  /** Each colour changed from upstream to meet a floor, with the value it replaced. */
  readonly adjusted: readonly ThemeAdjustment[];
}

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

const THEMES = [
  theme('dracula', dracula as ThemePackFile),
  theme('catppuccin-latte', catppuccinLatte as ThemePackFile),
];

/** Every theme the pack registers, in the order the picker lists them. */
export const THEME_PACK_THEMES: readonly ThemeContribution[] = THEMES.map(
  ({ id, label, kind, path }) => ({ id, label, kind, path }),
);

/** Each theme's file, by the path its contribution names. */
export const THEME_PACK_FILES: Readonly<Record<string, ThemePackFile>> = Object.fromEntries(
  THEMES.map(({ path, file }) => [path, file]),
);

/** The plugin: it registers its themes and does nothing else. */
export const themePack: Plugin = {
  id: THEME_PACK_ID,
  manifest,
  activate: (host) => {
    for (const contribution of THEME_PACK_THEMES) host.registerTheme(contribution);
  },
};
