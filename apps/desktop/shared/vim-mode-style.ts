import type { ConfigurationContribution } from '@tyto/plugin-api';
import { z } from 'zod';

import {
  type StatusBarColors,
  VIM_COLOUR_MODES,
  type VimColourMode,
  badgeText,
} from './status-bar-colors.js';

/**
 * The `vimModeStyle` setting: how the status bar shows vim's mode (TYTO-301, ADR 0091).
 *
 * Three looks, each in the mode's colour — the theme's `status-bar-vim-<mode>`, or
 * `statusBarColors`' `vimMode.<mode>` over it:
 *
 * - `badge`, the default and the look before the setting: only the mode's word is coloured;
 * - `border`: the bar keeps its colours and a strip along its top edge takes the mode's;
 * - `bar`: the whole bar takes the mode's colour, and its text is chosen as a badge's is.
 *
 * With vim off every style draws the plain bar. In `shared/` because both halves read it: main
 * validates the setting and the window writes the bar's text for each mode. Linted pure.
 */

export const VIM_MODE_STYLES = [
  {
    id: 'badge',
    description: "Only the mode's name is coloured, as a badge. The default.",
  },
  {
    id: 'border',
    description: "A strip along the bar's top edge takes the mode's colour; the bar keeps its own.",
  },
  {
    id: 'bar',
    description: "The whole bar takes the mode's colour, with text chosen to read on it.",
  },
] as const;

export type VimModeStyle = (typeof VIM_MODE_STYLES)[number]['id'];

const STYLE_IDS = VIM_MODE_STYLES.map((style) => style.id) as [VimModeStyle, ...VimModeStyle[]];

/** Each value with what it does, as the description and a refusal both say them. */
const styleList = (): string =>
  VIM_MODE_STYLES.map((style) => `'${style.id}' (${style.description})`).join(', ');

export const vimModeStyleContribution = {
  id: 'vimModeStyle',
  schema: z.enum(STYLE_IDS, {
    error: () => `the styles are ${STYLE_IDS.map((id) => `'${id}'`).join(', ')}`,
  }),
  default: 'badge',
  description: `How the status bar shows vim's mode: ${styleList()}`,
  // The same table the commented example and the refusal read, so the tab's suggestions and
  // hover can never offer a style the schema refuses (TYTO-304).
  options: VIM_MODE_STYLES.map((style) => ({ value: style.id, description: style.description })),
} satisfies ConfigurationContribution<VimModeStyle>;

/**
 * The text the `bar` style writes on the bar in each mode, for one theme: the best-reading of
 * the theme's surface, text and accent-text on the mode's colour — the rule a badge's text
 * follows (ADR 0089 decision 8) — so the bar reads as its badge does. The mode's colour is the
 * override's where `statusBarColors` names it, else the theme's. Where neither colour is hex,
 * the theme's own badge text stays.
 */
export function vimBarText(
  theme: Readonly<Record<string, string>>,
  colors: StatusBarColors = {},
): Readonly<Record<VimColourMode, string | undefined>> {
  const text = {} as Record<VimColourMode, string | undefined>;
  for (const mode of VIM_COLOUR_MODES) {
    const background = colors[`vimMode.${mode}`] ?? theme[`status-bar-vim-${mode}`];
    const best = background === undefined ? undefined : badgeText(background, theme);
    text[mode] = best?.colour ?? theme[`status-bar-vim-${mode}-text`];
  }
  return text;
}

/**
 * The key as a newly created `settings.json` shows it: commented out, with the three values
 * and what each does, so the options are in the file (TYTO-301).
 */
export function vimModeStyleExample(): string {
  const width = Math.max(...STYLE_IDS.map((id) => id.length)) + 4;
  return [
    "// How the status bar shows vim's mode, in the mode's colour. One of:",
    ...VIM_MODE_STYLES.map((style) => `//   ${`"${style.id}"`.padEnd(width)}${style.description}`),
    `// "vimModeStyle": "badge",`,
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
