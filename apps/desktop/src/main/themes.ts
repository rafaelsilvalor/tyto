import { readFile } from 'node:fs/promises';

import { type Diagnostic, type SourceRange, diagnostic, sourceRange } from '@tyto/core';
import {
  THEME_KINDS,
  type ThemeColorEntry,
  type ThemeColors,
  type ThemeContribution,
  type ThemeKind,
  isThemePath,
  resolveThemeColors,
} from '@tyto/plugin-api';
import { type Node, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser';

import {
  type ThemeLookup,
  type ThemeMode,
  type ThemeSetting,
  chosenThemeSetting,
  resolveThemeSetting,
} from '../../shared/theme-setting.js';
import { confinedFile } from './plugin-protocol.js';
import tytoDark from './themes/tyto-dark.json';
import tytoLight from './themes/tyto-light.json';

/**
 * Colour themes, read out of the plugin that contributes them and resolved against the base
 * theme of their kind (TYTO-208, ADR 0077).
 *
 * **A theme never breaks the window.** A file that cannot be read, does not parse or is not
 * shaped like a theme is one `E_THEME_INVALID`, and the base theme of its kind applies whole; a
 * token costs that token, which the base fills in (`resolveThemeColors`). Every diagnostic
 * carries the range in the file where there is one.
 *
 * The built-in `desktop` plugin registers Tyto Light and Tyto Dark through the same `theme`
 * point a third party uses. Their files are bundled into main rather than shipped beside it,
 * so the built-in reader answers from those imports; an installed plugin's are read from its
 * folder through `confinedFile`, the check a panel's page goes through (ADR 0045).
 */

export const BUILT_IN_THEMES = {
  light: { id: 'tyto-light', label: 'Tyto Light', kind: 'light', path: 'themes/tyto-light.json' },
  dark: { id: 'tyto-dark', label: 'Tyto Dark', kind: 'dark', path: 'themes/tyto-dark.json' },
} as const satisfies Readonly<Record<ThemeKind, ThemeContribution>>;

/** The base theme of each kind: what a theme of that kind falls back to, token by token. */
export const BASE_COLORS: Readonly<Record<ThemeKind, ThemeColors>> = {
  light: tytoLight.colors,
  dark: tytoDark.colors,
};

/** Reads a theme's file by its contributed path; throws with the reason when it cannot. */
export type ThemeReader = (path: string) => Promise<string>;

/** The built-in plugin's reader: its two files, bundled. */
export const builtInThemeReader: ThemeReader = (path) => {
  const file = { [BUILT_IN_THEMES.light.path]: tytoLight, [BUILT_IN_THEMES.dark.path]: tytoDark }[
    path
  ];
  return file === undefined
    ? Promise.reject(new Error(`the app ships no theme file '${path}'`))
    : Promise.resolve(JSON.stringify(file));
};

/**
 * An installed plugin's reader: a file inside `directory`, judged by name and then by where it
 * really is on the disk, so a link or a junction leading out of the folder is refused.
 */
export function folderThemeReader(directory: string): ThemeReader {
  return async (path) => {
    if (!isThemePath(path)) throw new Error(`its path '${path}' leaves the plugin folder`);
    const file = await confinedFile(directory, path.split('/'));
    if (file === undefined) throw new Error(`there is no file '${path}' inside the plugin folder`);
    return readFile(file, 'utf8');
  };
}

export interface LoadedTheme {
  readonly id: string;
  readonly kind: ThemeKind;
  /** Every token of the base theme of its kind: never one missing. */
  readonly colors: ThemeColors;
  readonly diagnostics: readonly Diagnostic[];
}

const OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;

const rangeOf = (node: Node): SourceRange => sourceRange(node.offset, node.offset + node.length);

/**
 * A theme, loaded: its file read and checked, and its colours resolved over the base theme.
 * Never rejects.
 */
export async function loadTheme(
  theme: ThemeContribution,
  read: ThemeReader,
  base: Readonly<Record<ThemeKind, ThemeColors>> = BASE_COLORS,
): Promise<LoadedTheme> {
  const fallback = (problems: readonly Diagnostic[]): LoadedTheme => ({
    id: theme.id,
    kind: theme.kind,
    colors: base[theme.kind],
    diagnostics: problems,
  });
  const invalid = (problem: string, range?: SourceRange): Diagnostic =>
    diagnostic(
      'E_THEME_INVALID',
      { theme: theme.id, problem, kind: theme.kind },
      range === undefined ? {} : { range },
    );

  let text: string;
  try {
    text = await read(theme.path);
  } catch (cause) {
    return fallback([invalid(cause instanceof Error ? cause.message : String(cause))]);
  }

  const errors: ParseError[] = [];
  const root = parseTree(text.replace(/^\uFEFF/u, ''), errors, OPTIONS);
  if (errors.length > 0) {
    return fallback(
      errors.map((error) =>
        invalid(
          `it is not valid JSON (${printParseErrorCode(error.error)})`,
          sourceRange(error.offset, error.offset + error.length),
        ),
      ),
    );
  }
  if (root?.type !== 'object') {
    return fallback([
      invalid('it is not an object', root === undefined ? undefined : rangeOf(root)),
    ]);
  }

  const property = (key: string): Node | undefined =>
    root.children?.find((child) => child.children?.[0]?.value === key)?.children?.[1];
  const name = property('name');
  const kind = property('kind');
  const colors = property('colors');
  if (name?.type !== 'string' || (name.value as string).length === 0) {
    return fallback([
      invalid("it has no 'name'", name === undefined ? rangeOf(root) : rangeOf(name)),
    ]);
  }
  if (
    kind?.type !== 'string' ||
    !(THEME_KINDS as readonly string[]).includes(kind.value as string)
  ) {
    return fallback([invalid("its 'kind' is not light or dark", rangeOf(kind ?? root))]);
  }
  if (kind.value !== theme.kind) {
    return fallback([
      invalid(
        `the file says '${String(kind.value)}' and the plugin says '${theme.kind}'`,
        rangeOf(kind),
      ),
    ]);
  }
  if (colors?.type !== 'object') {
    return fallback([invalid("its 'colors' is not an object", rangeOf(colors ?? root))]);
  }

  const entries: ThemeColorEntry[] = [];
  for (const pair of colors.children ?? []) {
    const [key, value] = pair.children ?? [];
    if (key === undefined || typeof key.value !== 'string') continue;
    entries.push({
      token: key.value,
      value: value?.type === 'string' ? (value.value as string) : value?.value,
      tokenRange: rangeOf(key),
      ...(value === undefined ? {} : { valueRange: rangeOf(value) }),
    });
  }
  const resolved = resolveThemeColors(theme.id, entries, base[theme.kind]);
  return { id: theme.id, kind: theme.kind, ...resolved };
}

/** A theme the registry holds, with the reader that reaches its plugin's file. */
export interface ThemeSource {
  readonly plugin: string;
  readonly theme: ThemeContribution;
  readonly read: ThemeReader;
}

/** The two themes the window applies and the mode Electron answers, as the window gets them. */
export interface AppliedThemes {
  readonly mode: ThemeMode;
  readonly light: LoadedTheme;
  readonly dark: LoadedTheme;
}

export interface ThemeService {
  /** What the `theme` setting checks an id against: every theme registered so far. */
  readonly lookup: ThemeLookup;
  /** Every theme a plugin offers, the built-in two first. Waits for the installed plugins. */
  list(): Promise<readonly ThemeContribution[]>;
  /**
   * The themes the setting chooses — or the one being previewed — loaded over their base,
   * with Electron told which mode to answer (`setMode`), so the window's media query, the
   * editor's dark flag and the native dialogs and scrollbars all follow one choice.
   */
  current(): Promise<AppliedThemes>;
  /**
   * Shows `id` as if it were chosen, until a choice or `preview(undefined)` goes back to the
   * setting. An id nobody offers previews nothing.
   */
  preview(id: string | undefined): Promise<AppliedThemes>;
  /**
   * The setting that shows `id`, from `setting` (ADR 0077): the caller writes it. Ends any
   * preview. `undefined` for an id nobody offers.
   */
  choose(id: string, setting: ThemeSetting): Promise<ThemeSetting | undefined>;
}

export interface ThemeServiceOptions {
  /** Every theme registered, in order: the built-in plugin's first. The first id wins. */
  readonly sources: () => readonly ThemeSource[];
  /** Settles when the installed plugins have started and their themes are in `sources`. */
  readonly ready: Promise<void>;
  /** The `theme` setting in effect. */
  readonly setting: () => ThemeSetting;
  /** `nativeTheme.themeSource`. */
  readonly setMode: (mode: ThemeMode) => void;
  /** Which kind the window is in now (`nativeTheme.shouldUseDarkColors`). */
  readonly shown: () => ThemeKind;
  readonly report: (problem: Diagnostic) => void;
}

const idsOf = (setting: ThemeSetting): readonly string[] =>
  typeof setting === 'string' ? [setting] : [setting.light, setting.dark];

export function createThemeService(options: ThemeServiceOptions): ThemeService {
  let settled = false;
  const ready = options.ready.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  // The theme on show while the picker is open, and the kind the window was in before it.
  let previewing: { readonly id: string; readonly before: ThemeKind } | undefined;

  const sourceOf = (id: string): ThemeSource | undefined =>
    options.sources().find(({ theme }) => theme.id === id);

  const lookup: ThemeLookup = (id) =>
    sourceOf(id)?.theme.kind ?? (settled ? 'unknown' : 'not-yet-known');

  const load = async (id: string, kind: ThemeKind, report: boolean): Promise<LoadedTheme> => {
    const source = sourceOf(id);
    const loaded =
      source === undefined || source.theme.kind !== kind
        ? await loadTheme(BUILT_IN_THEMES[kind], builtInThemeReader)
        : await loadTheme(source.theme, source.read);
    if (report) for (const problem of loaded.diagnostics) options.report(problem);
    return loaded;
  };

  const current = async (): Promise<AppliedThemes> => {
    // A theme an installed plugin will register is waited for, not replaced by the default
    // for the second the plugins take to start.
    const wanted = [
      ...idsOf(options.setting()),
      ...(previewing === undefined ? [] : [previewing.id]),
    ];
    if (wanted.some((id) => lookup(id) === 'not-yet-known')) await ready;
    let slots = resolveThemeSetting(options.setting(), lookup);
    const shown = previewing === undefined ? undefined : sourceOf(previewing.id)?.theme;
    if (shown !== undefined) slots = { ...slots, mode: shown.kind, [shown.kind]: shown.id };
    options.setMode(slots.mode);
    // A preview's problems are not logged: the person is scrolling past it.
    const report = previewing === undefined;
    const [light, dark] = await Promise.all([
      load(slots.light, 'light', report),
      load(slots.dark, 'dark', report),
    ]);
    return { mode: slots.mode, light, dark };
  };

  return {
    lookup,
    list: async () => {
      await ready;
      const seen = new Set<string>();
      return options
        .sources()
        .map(({ theme }) => theme)
        .filter((theme) => {
          if (seen.has(theme.id)) return false;
          seen.add(theme.id);
          return true;
        });
    },
    current,
    preview: (id) => {
      previewing =
        id === undefined ? undefined : { id, before: previewing?.before ?? options.shown() };
      return current();
    },
    choose: async (id, setting) => {
      const shown = previewing?.before ?? options.shown();
      previewing = undefined;
      await ready;
      const theme = sourceOf(id)?.theme;
      return theme === undefined ? undefined : chosenThemeSetting(setting, theme, shown);
    },
  };
}
