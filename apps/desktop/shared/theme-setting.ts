import type { ConfigurationContribution, ThemeKind } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * The `theme` setting (TYTO-208, ADR 0077): which colour theme the window applies, in Zed's
 * shape.
 *
 * Either one theme's id, which applies whatever the system says — its kind decides light or
 * dark — or `{ mode, light, dark }`: a theme for each kind and whether the system, or the
 * person, picks between them. `mode: "light" | "dark"` is the in-app override ADR 0075
 * deferred here. Pure, and in `shared/` beside `settings.ts`, so its rules are values a test
 * drives without a window.
 */

export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export interface ThemeSlots {
  readonly mode: ThemeMode;
  readonly light: string;
  readonly dark: string;
}

/** A theme id, fixed, or a theme per kind and who picks between them. */
export type ThemeSetting = string | ThemeSlots;

export const DEFAULT_THEME_SETTING: ThemeSlots = {
  mode: 'system',
  light: 'tyto-light',
  dark: 'tyto-dark',
};

/**
 * What the app knows about a theme id: its kind, `'unknown'` when no plugin offers it, or
 * `'not-yet-known'` while the installed plugins are still starting — an id that may be
 * theirs is not refused before they have had a chance to register it.
 */
export type ThemeLookup = (id: string) => ThemeKind | 'unknown' | 'not-yet-known';

/** The built-in themes alone; any other id may be an installed plugin's. */
export const builtInThemeLookup: ThemeLookup = (id) =>
  id === DEFAULT_THEME_SETTING.light
    ? 'light'
    : id === DEFAULT_THEME_SETTING.dark
      ? 'dark'
      : 'not-yet-known';

const themeId = z.string().min(1).max(200);

/**
 * The setting's schema, checking every id against `lookup` when it is validated, so an id no
 * plugin offers is `W_SETTING_INVALID` at the value and the default applies (ADR 0073). A slot
 * holding a theme of the other kind is refused too: the `light` slot is what the window shows
 * when it is light, and a dark theme there would paint a dark window the system calls light.
 */
export function themeSettingSchema(lookup: ThemeLookup): z.ZodType<ThemeSetting> {
  const known = (id: string, context: z.RefinementCtx, slot?: ThemeKind): void => {
    const kind = lookup(id);
    if (kind === 'not-yet-known') return;
    if (kind === 'unknown') {
      context.addIssue({ code: 'custom', message: `no installed theme is called '${id}'` });
      return;
    }
    if (slot !== undefined && kind !== slot) {
      context.addIssue({
        code: 'custom',
        message: `'${id}' is a ${kind} theme and cannot be the ${slot} one`,
      });
    }
  };
  return z.union([
    themeId.superRefine((id, context) => {
      known(id, context);
    }),
    z
      .object({ mode: z.enum(THEME_MODES), light: themeId, dark: themeId })
      .strict()
      .superRefine((slots, context) => {
        known(slots.light, context, 'light');
        known(slots.dark, context, 'dark');
      }),
  ]);
}

export function themeSettingContribution(
  lookup: ThemeLookup,
): ConfigurationContribution<ThemeSetting> {
  return {
    id: 'theme',
    schema: themeSettingSchema(lookup),
    default: DEFAULT_THEME_SETTING,
    description:
      'The colour theme: a theme id, or { mode: "system" | "light" | "dark", light, dark }.',
  };
}

/**
 * The theme per kind and the mode a setting comes to, with every id one `lookup` knows.
 *
 * A fixed id is the mode of its kind, with the default in the other slot. An id the app does
 * not know — a plugin removed since the file was written — is the default of its slot, so
 * the window always has two themes it can read.
 */
export function resolveThemeSetting(setting: ThemeSetting, lookup: ThemeLookup): ThemeSlots {
  if (typeof setting === 'string') {
    const kind = lookup(setting);
    if (kind !== 'light' && kind !== 'dark') return DEFAULT_THEME_SETTING;
    return { ...DEFAULT_THEME_SETTING, mode: kind, [kind]: setting };
  }
  const slot = (kind: ThemeKind): string =>
    lookup(setting[kind]) === kind ? setting[kind] : DEFAULT_THEME_SETTING[kind];
  return { mode: setting.mode, light: slot('light'), dark: slot('dark') };
}

/**
 * Which system mode Electron is told to answer (`nativeTheme.themeSource`) before the
 * installed plugins have started: a fixed id whose kind is not known yet waits on the system.
 */
export function modeOf(setting: ThemeSetting, lookup: ThemeLookup): ThemeMode {
  if (typeof setting !== 'string') return setting.mode;
  const kind = lookup(setting);
  return kind === 'light' || kind === 'dark' ? kind : 'system';
}

/**
 * The setting after a person picked `chosen` in "Preferences: Color Theme", which must leave
 * the window showing it.
 *
 * A fixed id stays fixed. With slots, the chosen theme takes the slot of its kind; the mode
 * stays as it was when that already shows the slot — the system's choice included, when the
 * system is in that kind now (`shown`) — and otherwise becomes the theme's kind, because a
 * dark theme chosen in a light window must not vanish on Enter.
 */
export function chosenThemeSetting(
  current: ThemeSetting,
  chosen: { readonly id: string; readonly kind: ThemeKind },
  shown: ThemeKind,
): ThemeSetting {
  if (typeof current === 'string') return chosen.id;
  const visible =
    current.mode === chosen.kind || (current.mode === 'system' && shown === chosen.kind);
  return {
    ...current,
    mode: visible ? current.mode : chosen.kind,
    [chosen.kind]: chosen.id,
  };
}
