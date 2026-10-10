import { type Diagnostic, type SourceRange, diagnostic } from '@tyto/core';

import type { Contribution } from './contributions.js';

/**
 * The `theme` extension point: a colour theme a plugin ships as a data file, and the one pure
 * rule that turns that file's colours into values the window can set (TYTO-208, ADR 0077).
 *
 * **Data, never code.** A theme is a JSON file inside the plugin's folder, so applying one runs
 * nothing the plugin wrote, and an installed plugin may contribute one: the contribution is
 * four strings and crosses its process boundary as it is.
 *
 * **One vocabulary.** A theme names the window's `--tyto-*` colour roles without the prefix
 * (`surface`, `text-muted`, `syntax-keyword`), which is a mechanical mapping to the custom
 * properties `tokens.css` defines (ADR 0075). Which names exist is the base theme's to say:
 * this module is handed the base colours and treats every other name as unknown, so the list
 * lives in one place, the app's built-in theme files.
 */

export const THEME_KINDS = ['light', 'dark'] as const;
export type ThemeKind = (typeof THEME_KINDS)[number];

export interface ThemeContribution extends Contribution {
  /** What a picker shows: `Tyto Dark`. */
  readonly label: string;
  /** Which base theme fills in what this one leaves out, and which system mode it suits. */
  readonly kind: ThemeKind;
  /**
   * The theme file, as a path inside the plugin's folder with `/` between segments —
   * `themes/dusk.json`. A path that leaves the folder is never read, by name or by link.
   */
  readonly path: string;
}

/** A colour role's name as a theme writes it: lowercase words joined by hyphens. */
export const THEME_TOKEN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const SEGMENT = /^[^/\\:\0]+$/u;

/**
 * Whether a theme's `path` is a relative path that stays inside its folder by name: no empty,
 * `.` or `..` segment, no drive, colon, backslash or NUL. Where the file really is — through a
 * link or a junction — is the reader's check, which needs a disk.
 */
export function isThemePath(path: string): boolean {
  if (path.length === 0 || path.length > 500) return false;
  return path
    .split('/')
    .every((segment) => SEGMENT.test(segment) && segment !== '.' && segment !== '..');
}

const HEX = '#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})';
// Digits, separators and units only: no letter, so nothing but numbers fits inside.
const NUMERIC = '\\(\\s*[0-9.%\\s,/+-]+\\)';
const FUNCTION = `(?:rgba?|hsla?)${NUMERIC}`;
const STOP = `(?:${HEX}|${FUNCTION}|transparent)(?:\\s+[0-9.]+%)?`;
const SPACE = '(?:srgb|srgb-linear|display-p3|lab|oklab|lch|oklch|hsl|hwb|xyz)';
const MIX = `color-mix\\(\\s*in\\s+${SPACE}\\s*,\\s*${STOP}\\s*,\\s*${STOP}\\s*\\)`;
const COLOR = new RegExp(`^(?:${HEX}|${FUNCTION}|${MIX})$`, 'iu');

/**
 * Whether a value is a colour a theme may set: a hex colour, `rgb()`/`rgba()`, `hsl()`/`hsla()`
 * with numbers inside, or a `color-mix()` of two of those.
 *
 * **This is also the injection check.** The value becomes the right-hand side of a custom
 * property in the window's sheet, so a `;` or a `}` would close it and open a rule of the
 * plugin's choosing. The grammar admits neither, nor quotes, nor `url(`, by construction.
 */
export function isThemeColor(value: string): boolean {
  return value.length <= 200 && COLOR.test(value.trim());
}

/** One colour of a theme file, with where it was written when the reader knows. */
export interface ThemeColorEntry {
  readonly token: string;
  readonly value: unknown;
  readonly tokenRange?: SourceRange;
  readonly valueRange?: SourceRange;
}

export type ThemeColors = Readonly<Record<string, string>>;

export interface ResolvedThemeColors {
  /** Every token of the base, each the theme's colour where it set a valid one. */
  readonly colors: ThemeColors;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * The colours a theme applies: the base theme of its kind, with each token the theme set
 * validly put in its place. **Never fails.** An unknown name costs that entry and is
 * `W_THEME_TOKEN_UNKNOWN` at the name; a value that is not a colour costs that token, which
 * keeps the base's colour, and is `W_THEME_COLOR_INVALID` at the value. A token the theme
 * does not mention is simply the base's, which is the fallback rule of ADR 0077.
 */
export function resolveThemeColors(
  theme: string,
  entries: readonly ThemeColorEntry[],
  base: ThemeColors,
): ResolvedThemeColors {
  const colors: Record<string, string> = { ...base };
  const diagnostics: Diagnostic[] = [];
  for (const entry of entries) {
    if (!Object.hasOwn(base, entry.token)) {
      diagnostics.push(
        diagnostic(
          'W_THEME_TOKEN_UNKNOWN',
          { theme, token: entry.token },
          entry.tokenRange === undefined ? {} : { range: entry.tokenRange },
        ),
      );
      continue;
    }
    if (typeof entry.value !== 'string' || !isThemeColor(entry.value)) {
      const shown = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
      diagnostics.push(
        diagnostic(
          'W_THEME_COLOR_INVALID',
          { theme, token: entry.token, value: (shown ?? String(entry.value)).slice(0, 60) },
          entry.valueRange === undefined ? {} : { range: entry.valueRange },
        ),
      );
      continue;
    }
    colors[entry.token] = entry.value.trim();
  }
  return { colors, diagnostics };
}

/**
 * Checks a contribution, and throws on one that is a bug in the plugin: an id that is empty,
 * a kind that is neither light nor dark, a path that leaves the folder by name. The loader's
 * door turns the throw into `E_PLUGIN_ACTIVATE`, as it does for a setting.
 */
export function checkThemeContribution(plugin: string, theme: ThemeContribution): void {
  const problem =
    theme.id.length === 0
      ? 'an empty id'
      : theme.label.length === 0
        ? 'an empty label'
        : !(THEME_KINDS as readonly string[]).includes(theme.kind)
          ? `the kind '${String(theme.kind)}', which is neither light nor dark`
          : !isThemePath(theme.path)
            ? `the path '${theme.path}', which is not a relative path inside its folder`
            : undefined;
  if (problem !== undefined) {
    throw new TypeError(`Plugin '${plugin}' contributes a theme with ${problem}.`);
  }
}
