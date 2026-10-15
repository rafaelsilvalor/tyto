import { type Diagnostic, diagnostic } from '@tyto/core';
import type { ConfigurationContribution, SettingEntry } from '@tyto/plugin-api';
import { z } from 'zod';

import { STATUS_BAR_ITEMS, type StatusBarItemId } from './status-bar-items.js';

/**
 * The `statusBarColors` setting: colours that win over the theme's for the status bar, like
 * VS Code's `workbench.colorCustomizations` (TYTO-301, ADR 0091).
 *
 * **One override for every theme**, light and dark alike: a person who wants a red bar wants
 * it whichever theme is in front, and per-theme sections would be a second theme format.
 * Three kinds of key: the bar's own colours, vim's four mode badges, and a foreground per item
 * — the only place a per-item colour exists, since no theme token carries one.
 *
 * In `shared/` because both halves read it: main validates the setting and measures the vim
 * badges' contrast, and the window writes the colours into its sheet. Linted pure.
 */

export const VIM_COLOUR_MODES = ['normal', 'insert', 'visual', 'replace'] as const;
export type VimColourMode = (typeof VIM_COLOUR_MODES)[number];

/** What one key of the setting paints. */
export interface StatusBarColourKey {
  readonly key: string;
  readonly description: string;
  /** A value the commented example in a new `settings.json` shows. */
  readonly example: string;
}

/**
 * The bar's own colours, each the custom property it sets on the bar. Background and
 * foreground are the theme's `status-bar` tokens, set on the bar; the four hover and on-state
 * colours are properties of the bar alone, whose fallbacks in `shell.css` are the theme's
 * `hover`, `button-on` and `text` that the buttons read today — not theme tokens, so no theme
 * has to set them (ADR 0089 decision 3).
 */
const BAR_KEYS = [
  {
    key: 'background',
    property: '--tyto-status-bar',
    description: "The bar's background.",
    example: '#1e3a5f',
  },
  {
    key: 'foreground',
    property: '--tyto-status-bar-text',
    description: "The bar's text and icons.",
    example: '#f0f0f0',
  },
  {
    key: 'itemHoverBackground',
    property: '--status-bar-hover',
    description: 'A button under the pointer.',
    example: '#2b4f7e',
  },
  {
    key: 'itemHoverForeground',
    property: '--status-bar-hover-text',
    description: "A button's text under the pointer.",
    example: '#ffffff',
  },
  {
    key: 'itemActiveBackground',
    property: '--status-bar-on',
    description: 'A toggle that is on, such as an open panel.',
    example: '#3a6ea5',
  },
  {
    key: 'itemActiveForeground',
    property: '--status-bar-on-text',
    description: "A toggle's text while it is on.",
    example: '#ffffff',
  },
] as const;

const VIM_EXAMPLES: Readonly<Record<VimColourMode, string>> = {
  normal: '#3b6fd9',
  insert: '#2f8a46',
  visual: '#9b4fc0',
  replace: '#c4473a',
};

const vimKey = (mode: VimColourMode): `vimMode.${VimColourMode}` => `vimMode.${mode}`;
const itemKey = (id: StatusBarItemId): `item.${StatusBarItemId}` => `item.${id}`;

/** Every key the setting accepts, in the order the example and the messages list them. */
export const STATUS_BAR_COLOUR_KEYS: readonly StatusBarColourKey[] = [
  ...BAR_KEYS.map(({ key, description, example }) => ({ key, description, example })),
  ...VIM_COLOUR_MODES.map((mode) => ({
    key: vimKey(mode),
    description: `Vim's ${mode.toUpperCase()} badge; its text is the theme's best-reading.`,
    example: VIM_EXAMPLES[mode],
  })),
  ...STATUS_BAR_ITEMS.map((item) => ({
    key: itemKey(item.id),
    description: `The text of ${item.id}: ${item.description}`,
    example: '#ffd866',
  })),
];

const KEY_NAMES = STATUS_BAR_COLOUR_KEYS.map((entry) => entry.key) as [string, ...string[]];

/** A colour as the setting takes it: `#rgb` or `#rrggbb`, opaque, so a contrast is measurable. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;

export const statusBarColour = z
  .string({ error: 'a colour is written in quotes, as #rgb or #rrggbb' })
  .regex(HEX, 'a colour is written #rgb or #rrggbb, opaque');

const statusBarColourKey = z.enum(KEY_NAMES, {
  error: (issue) =>
    `'${String(issue.input)}' is not a status bar colour; the colours are ${KEY_NAMES.join(', ')}`,
});

export type StatusBarColors = Readonly<Partial<Record<string, string>>>;

/**
 * `statusBarColors`: each member checked on its own (`members`), so an unknown key is
 * `W_SETTING_ENTRY_INVALID` at that key and a bad colour `W_SETTING_INVALID` at that value,
 * and only that one falls back to the theme.
 */
export const statusBarColorsContribution = {
  id: 'statusBarColors',
  schema: z.partialRecord(statusBarColourKey, statusBarColour).readonly(),
  default: {},
  description:
    'Colours that win over the theme for the status bar, in every theme. ' +
    STATUS_BAR_COLOUR_KEYS.map((entry) => `${entry.key}: ${entry.description}`).join(' '),
  members: { key: statusBarColourKey, schema: statusBarColour },
} satisfies ConfigurationContribution<StatusBarColors>;

/** Red, green and blue from 0 to 255, or `undefined` for anything but `#rgb`/`#rrggbb`. */
export function parseHex(colour: string): readonly [number, number, number] | undefined {
  if (!HEX.test(colour.trim())) return undefined;
  const digits = colour.trim().slice(1);
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const channel = (at: number): number => Number.parseInt(full.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

/** WCAG 2.x relative luminance of an opaque colour. */
function luminance([red, green, blue]: readonly [number, number, number]): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** The WCAG contrast ratio of two hex colours, or `undefined` when either is not one. */
export function contrastRatio(one: string, two: string): number | undefined {
  const first = parseHex(one);
  const second = parseHex(two);
  if (first === undefined || second === undefined) return undefined;
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The theme's colours a badge's text is chosen from, as ADR 0089 decision 8 chooses it. */
export const BADGE_TEXT_CANDIDATES = ['surface', 'text', 'accent-text'] as const;

/**
 * The best-reading of the theme's surface, text and accent-text on `background`, with its
 * ratio — the rule a theme's own badge text follows. `undefined` when the theme writes none
 * of the three as a hex colour, and then the theme's own badge text stays.
 */
export function badgeText(
  background: string,
  theme: Readonly<Record<string, string>>,
): { readonly colour: string; readonly ratio: number } | undefined {
  let best: { colour: string; ratio: number } | undefined;
  for (const token of BADGE_TEXT_CANDIDATES) {
    const colour = theme[token];
    if (colour === undefined) continue;
    const ratio = contrastRatio(colour, background);
    if (ratio !== undefined && (best === undefined || ratio > best.ratio)) best = { colour, ratio };
  }
  return best;
}

/** What the override sets: custom properties on the bar, and a text colour per item. */
export interface StatusBarOverride {
  readonly bar: Readonly<Record<string, string>>;
  readonly items: Readonly<Partial<Record<StatusBarItemId, string>>>;
}

/**
 * The override as the window writes it for one theme: the bar's properties, each vim badge's
 * colour with the text the theme reads best on it, and each item's text. Per theme because a
 * badge's text is chosen from that theme's colours.
 */
export function statusBarOverride(
  colors: StatusBarColors,
  theme: Readonly<Record<string, string>>,
): StatusBarOverride {
  const bar: Record<string, string> = {};
  for (const { key, property } of BAR_KEYS) {
    const value = colors[key];
    if (value !== undefined) bar[property] = value;
  }
  for (const mode of VIM_COLOUR_MODES) {
    const value = colors[vimKey(mode)];
    if (value === undefined) continue;
    bar[`--tyto-status-bar-vim-${mode}`] = value;
    const text = badgeText(value, theme);
    if (text !== undefined) bar[`--tyto-status-bar-vim-${mode}-text`] = text.colour;
  }
  const items: Partial<Record<StatusBarItemId, string>> = {};
  for (const item of STATUS_BAR_ITEMS) {
    const value = colors[itemKey(item.id)];
    if (value !== undefined) items[item.id] = value;
  }
  return { bar, items };
}

/** The vim keys of the setting, with the mode each paints. */
export const VIM_COLOUR_KEYS: readonly { readonly key: string; readonly mode: VimColourMode }[] =
  VIM_COLOUR_MODES.map((mode) => ({ key: vimKey(mode), mode }));

/** What a badge's text has to reach, as every theme's own badge does (ADR 0089 decision 8). */
export const BADGE_CONTRAST_FLOOR = 4.5;

/** A theme in force: its id for the message, its colours to choose the text from. */
export interface ThemeInForce {
  readonly id: string;
  readonly colors: Readonly<Record<string, string>>;
}

/**
 * `W_SETTING_LOW_CONTRAST` at each vim badge colour of `statusBarColors` on which no text
 * colour of a theme in force reads 4.5:1. The colour still applies — the person chose it — and
 * the warning says the ratio measured, rounded down so it never reads as passing.
 */
export function statusBarColorsContrast(
  entries: readonly SettingEntry[],
  themes: readonly ThemeInForce[],
): Diagnostic[] {
  const entry = [...entries].reverse().find((item) => item.key === statusBarColorsContribution.id);
  if (entry === undefined || typeof entry.value !== 'object' || entry.value === null) return [];
  const written = entry.value as Readonly<Record<string, unknown>>;
  const diagnostics: Diagnostic[] = [];
  for (const { key } of VIM_COLOUR_KEYS) {
    const value = written[key];
    if (typeof value !== 'string' || !statusBarColour.safeParse(value).success) continue;
    for (const theme of themes) {
      const text = badgeText(value, theme.colors);
      if (text === undefined || text.ratio >= BADGE_CONTRAST_FLOOR) continue;
      const range = entry.memberRanges?.[key]?.valueRange ?? entry.valueRange ?? entry.keyRange;
      diagnostics.push(
        diagnostic(
          'W_SETTING_LOW_CONTRAST',
          {
            key: `${statusBarColorsContribution.id}.${key}`,
            ratio: (Math.floor(text.ratio * 100) / 100).toFixed(2),
            theme: theme.id,
          },
          range === undefined ? {} : { range },
        ),
      );
    }
  }
  return diagnostics;
}

/**
 * The key as a newly created `settings.json` shows it: commented out, with every key, an
 * example value and what it paints, so the options are in the file (TYTO-301).
 */
export function statusBarColorsExample(): string {
  const width = Math.max(...STATUS_BAR_COLOUR_KEYS.map((entry) => entry.key.length)) + 16;
  const lines = STATUS_BAR_COLOUR_KEYS.map((entry, index) => {
    const pair = `"${entry.key}": "${entry.example}"${index === STATUS_BAR_COLOUR_KEYS.length - 1 ? '' : ','}`;
    return `//   ${pair.padEnd(width)}// ${entry.description}`;
  });
  return [
    "// Colours that win over the theme's for the status bar, in every theme: #rgb or #rrggbb.",
    '// "statusBarColors": {',
    ...lines,
    '// },',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
