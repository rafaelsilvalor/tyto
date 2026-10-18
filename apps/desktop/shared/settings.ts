import type { ConfigurationContribution } from '@tyto/plugin-api';
import { z } from 'zod';

import { type BriefColumnLook, briefColumnsContribution } from './brief-columns.js';
import { type StatusBarColors, statusBarColorsContribution } from './status-bar-colors.js';
import { type StatusBarItemId, statusBarItemsContribution } from './status-bar-items.js';
import {
  DEFAULT_THEME_SETTING,
  type ThemeLookup,
  type ThemeSetting,
  builtInThemeLookup,
  themeSettingContribution,
} from './theme-setting.js';
import {
  codeFontFamilyContribution,
  codeFontSizeContribution,
  uiFontFamilyContribution,
  uiFontSizeContribution,
  zoomContribution,
} from './typography.js';
import { type VimModeStyle, vimModeStyleContribution } from './vim-mode-style.js';

/**
 * What the app remembers about how this person works, as opposed to where they put a
 * splitter (TYTO-122).
 *
 * `shared/` and not `src/main/`, for `shared/layout.ts`'s reason: main validates what it
 * reads off a disk and the window is told what the answer was, so the shape has to be one
 * declaration both halves import. Linted pure — no Node, no DOM.
 *
 * **Nineteen settings the built-in `desktop` plugin declares** through the `configuration`
 * extension point (TYTO-206, ADR 0073), like any plugin's: built-in is a plugin. Their keys
 * stay unprefixed, exactly as every `settings.json` written before that card spells them.
 * Each one is validated alone, so a hand-broken value costs that key and nothing else.
 */

const templatesFolder = {
  id: 'templatesFolder',
  /**
   * A folder of templates searched **before** the built-in pack.
   *
   * The same door the CLI already has — `templates/<name>/` beside the brief, ADR 0020 —
   * given to the window. `null` is "only the built-in pack", which is where every install
   * starts and where clearing the setting goes back to. `min(1)`: an empty path would reach
   * `loadTemplateRegistry` as a root and be reported as unreadable on every launch.
   *
   * An absolute path, and main never hands it to anything but `loadTemplateRegistry`. It is
   * not a second way for the renderer to reach a disk: the window is *told* the path so it
   * can show it in the footer, and the only thing it can do with it is display it.
   */
  schema: z.string().min(1).nullable(),
  default: null,
  description: 'A folder of templates searched before the built-in pack, or null for none.',
} satisfies ConfigurationContribution<string | null>;

const queueFolder = {
  id: 'queueFolder',
  /**
   * The local queue's folder (TYTO-45): the parent of `inbox/`, `outbox/` and `done/`, the
   * same folder `tyto watch <folder>` is given. `null` until a person picks one.
   */
  schema: z.string().min(1).nullable(),
  default: null,
  description: 'The local queue folder (the parent of inbox, outbox and done), or null.',
} satisfies ConfigurationContribution<string | null>;

const queueAutoRun = {
  id: 'queueAutoRun',
  /**
   * Whether a task dropped into the inbox is rendered without being asked. Off until a person
   * turns it on, so opening the app never renders a folder by surprise.
   */
  schema: z.boolean(),
  default: false,
  description: 'Render a task dropped into the queue inbox without being asked.',
} satisfies ConfigurationContribution<boolean>;

const queueKinds = {
  id: 'queueKinds',
  /**
   * The file types each queue folder produces (TYTO-188, ADR 0061), keyed by the folder's
   * absolute path. A folder with no entry produces PNG alone, which is what the queue did
   * before a person could choose (ADR 0044).
   *
   * Per folder, because a folder is a contract with whoever drops tasks into it: pointing the
   * window at another queue must not change what the first one hands back.
   */
  schema: z.record(z.string().min(1), z.array(z.string().min(1)).min(1).readonly()),
  default: {},
  description: 'The file types each queue folder produces, by folder path.',
} satisfies ConfigurationContribution<Readonly<Record<string, readonly string[]>>>;

/**
 * How thick the window's icons are drawn, in units of their 16-unit grid (TYTO-288, ADR 0085):
 * the status bar's nine, "Open preview to the side" and the lock. Rafael chose a setting with
 * 1.25 as the default after a sheet of the eleven at 1.5, 1.25 and 1.0.
 *
 * Bounded at 0.75 and 2. Below 0.75 a line at 16 px is under one device pixel at 100 % scaling
 * and the browser paints it grey; above 2 the gaps the icons are drawn with — the settings
 * icon's sliders, the gap between the plugins icon's squares — close up and the shapes run
 * together. A value outside them is `W_SETTING_INVALID` at the value and the default applies,
 * as every setting's does (ADR 0073).
 */
export const ICON_STROKE_WIDTH = { default: 1.25, minimum: 0.75, maximum: 2 } as const;

const iconStrokeWidth = {
  id: 'iconStrokeWidth',
  schema: z.number().min(ICON_STROKE_WIDTH.minimum).max(ICON_STROKE_WIDTH.maximum),
  default: ICON_STROKE_WIDTH.default,
  description: 'How thick the icons are drawn, from 0.75 to 2 (default 1.25).',
} satisfies ConfigurationContribution<number>;

/**
 * Whether the editor draws a guide per indent level (TYTO-293, ADR 0088). On by default, as
 * VS Code's are; it reaches the window on `theme:current`'s answer, and the editor swaps the
 * guides in or out in place, so a save shows or hides them in every tab with no restart.
 */
export const indentGuidesContribution = {
  id: 'indentGuides',
  schema: z.boolean(),
  default: true,
  description: 'Draw a vertical guide at each indent level in the editor (default true).',
  // Spelled out so the settings tab's hover says what each does, not only that it is a boolean.
  options: [
    { value: true, description: 'A guide per indent level; the block holding the cursor darker.' },
    { value: false, description: 'No guides.' },
  ],
} satisfies ConfigurationContribution<boolean>;

/**
 * The key as a newly created `settings.json` shows it: commented out, with its two values, so
 * the option is in the file (TYTO-293).
 */
export function indentGuidesExample(): string {
  return [
    '// Draw a vertical guide at each indent level in the editor: true (the default) or false.',
    '// "indentGuides": true,',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * Whether the editor pins the head line of the block the top of the pane is inside (TYTO-295,
 * ADR 0094): `::lamina` while scrolling its body, a template's elements stacked. On by default,
 * as VS Code's is; on `theme:current`'s answer like `indentGuides`, applied in place.
 */
export const stickyScrollContribution = {
  id: 'stickyScroll',
  schema: z.boolean(),
  default: true,
  description:
    "Keep a block's head line pinned at the top of the editor while scrolling inside it (default true).",
  options: [
    {
      value: true,
      description: 'The head line of the block at the top stays pinned; a click goes to it.',
    },
    { value: false, description: 'Nothing pinned.' },
  ],
} satisfies ConfigurationContribution<boolean>;

/** The key as a newly created `settings.json` shows it, commented out (TYTO-295). */
export function stickyScrollExample(): string {
  return [
    "// Pin a block's head line at the top of the editor while scrolling inside it: true (the default) or false.",
    '// "stickyScroll": true,',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * Whether Save formats a brief first (TYTO-297, ADR 0096), as VS Code's `editor.formatOnSave`.
 * Off by default: a save writes what the person sees. Read at the moment of saving, so a change
 * to it applies to the next save with no restart.
 */
export const formatBriefOnSaveContribution = {
  id: 'formatBriefOnSave',
  schema: z.boolean(),
  default: false,
  description: 'Format a brief (Format Brief) every time it is saved (default false).',
  options: [
    {
      value: true,
      description:
        'Save fixes the indentation, trailing spaces and repeated blank lines first. A brief with a syntax error is saved as it is.',
    },
    { value: false, description: 'Save writes the brief exactly as it is.' },
  ],
} satisfies ConfigurationContribution<boolean>;

/** The key as a newly created `settings.json` shows it, commented out (TYTO-297). */
export function formatBriefOnSaveExample(): string {
  return [
    '// Format a brief (fix indentation, trailing spaces and repeated blank lines) every time it is saved: true or false (the default).',
    '// "formatBriefOnSave": false,',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * Spaces per indent level in the editor (TYTO-297, ADR 0096): what Tab inserts and Shift+Tab
 * removes, how wide a tab character is drawn, the step of the indent guides, and the indent
 * Format Brief writes a body line with. Spaces only — Tab never inserts a tab character. On
 * `theme:current`'s answer like `indentGuides`, applied in place with no restart.
 *
 * Bounded at 1 and 8, `MIN_TAB_SIZE` and `MAX_TAB_SIZE` in `@tyto/editor`; an integer, since a
 * column is.
 */
export const TAB_SIZE = { default: 2, minimum: 1, maximum: 8 } as const;

export const tabSizeContribution = {
  id: 'tabSize',
  schema: z.number().int().min(TAB_SIZE.minimum).max(TAB_SIZE.maximum),
  default: TAB_SIZE.default,
  description:
    'Spaces per indent level: what Tab inserts, the indent guides’ step and the indent Format Brief writes, from 1 to 8 (default 2).',
  options: [
    { value: 2, description: 'Two spaces per level, the indent the built-in examples use.' },
    { value: 4, description: 'Four spaces per level.' },
  ],
} satisfies ConfigurationContribution<number>;

/** The key as a newly created `settings.json` shows it, commented out (TYTO-297). */
export function tabSizeExample(): string {
  return [
    '// Spaces per indent level: what Tab inserts, the indent guides’ step and the indent Format Brief writes, 1 to 8 (default 2).',
    '// "tabSize": 2,',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * The nineteen, in the order the settings file is documented in. `theme` checks its ids against
 * `lookup`, which main builds from every theme the plugins registered (TYTO-208); the default
 * knows the built-in two and lets any other id through.
 */
export function settingContributions(
  lookup: ThemeLookup = builtInThemeLookup,
): readonly ConfigurationContribution[] {
  return [
    templatesFolder,
    queueFolder,
    queueAutoRun,
    queueKinds,
    themeSettingContribution(lookup),
    iconStrokeWidth,
    statusBarItemsContribution,
    statusBarColorsContribution,
    vimModeStyleContribution,
    indentGuidesContribution,
    stickyScrollContribution,
    formatBriefOnSaveContribution,
    tabSizeContribution,
    briefColumnsContribution,
    zoomContribution,
    uiFontFamilyContribution,
    uiFontSizeContribution,
    codeFontFamilyContribution,
    codeFontSizeContribution,
  ] as readonly ConfigurationContribution[];
}

export interface Settings {
  readonly templatesFolder: string | null;
  readonly queueFolder: string | null;
  readonly queueAutoRun: boolean;
  readonly queueKinds: Readonly<Record<string, readonly string[]>>;
  readonly theme: ThemeSetting;
  readonly iconStrokeWidth: number;
  /** Which status bar items show, in order inside their side (TYTO-301, ADR 0091). */
  readonly statusBarItems: readonly StatusBarItemId[];
  /** Colours that win over the theme's for the status bar (TYTO-301, ADR 0091). */
  readonly statusBarColors: StatusBarColors;
  /** How the status bar shows vim's mode: badge, top border or whole bar (TYTO-301). */
  readonly vimModeStyle: VimModeStyle;
  /** Whether the editor draws indent guides (TYTO-293). */
  readonly indentGuides: boolean;
  /** Whether the editor pins the head line of the block at the top (TYTO-295). */
  readonly stickyScroll: boolean;
  /** Whether Save formats a brief first (TYTO-297). */
  readonly formatBriefOnSave: boolean;
  /** Spaces per indent level in the editor (TYTO-297). */
  readonly tabSize: number;
  /** How the editor tells the columns of a `|` line apart (TYTO-298). */
  readonly briefColumns: BriefColumnLook;
  /** How far the window is zoomed, in Electron's steps of 1.2 (TYTO-272, ADR 0099). */
  readonly zoom: number;
  /** The face and size of the window's text outside the editor (TYTO-272). */
  readonly uiFontFamily: string;
  readonly uiFontSize: number;
  /** The face and size of every editor buffer (TYTO-272). */
  readonly codeFontFamily: string;
  readonly codeFontSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  templatesFolder: templatesFolder.default,
  queueFolder: queueFolder.default,
  queueAutoRun: queueAutoRun.default,
  queueKinds: queueKinds.default,
  theme: DEFAULT_THEME_SETTING,
  iconStrokeWidth: iconStrokeWidth.default,
  statusBarItems: statusBarItemsContribution.default,
  statusBarColors: statusBarColorsContribution.default,
  vimModeStyle: vimModeStyleContribution.default,
  indentGuides: indentGuidesContribution.default,
  stickyScroll: stickyScrollContribution.default,
  formatBriefOnSave: formatBriefOnSaveContribution.default,
  tabSize: tabSizeContribution.default,
  briefColumns: briefColumnsContribution.default,
  zoom: zoomContribution.default,
  uiFontFamily: uiFontFamilyContribution.default,
  uiFontSize: uiFontSizeContribution.default,
  codeFontFamily: codeFontFamilyContribution.default,
  codeFontSize: codeFontSizeContribution.default,
};

/** What a queue folder produces until a person chooses otherwise (ADR 0044). */
export const DEFAULT_QUEUE_KINDS: readonly string[] = ['png'];

/**
 * The nineteen out of the resolved values, which already hold every declared key with a value
 * its schema accepted or its default (`resolveSettings`).
 */
export function settingsFrom(values: Readonly<Record<string, unknown>>): Settings {
  const pick = <Key extends keyof Settings>(key: Key): Settings[Key] =>
    (key in values ? values[key] : DEFAULT_SETTINGS[key]) as Settings[Key];
  return {
    templatesFolder: pick('templatesFolder'),
    queueFolder: pick('queueFolder'),
    queueAutoRun: pick('queueAutoRun'),
    queueKinds: pick('queueKinds'),
    theme: pick('theme'),
    iconStrokeWidth: pick('iconStrokeWidth'),
    statusBarItems: pick('statusBarItems'),
    statusBarColors: pick('statusBarColors'),
    vimModeStyle: pick('vimModeStyle'),
    indentGuides: pick('indentGuides'),
    stickyScroll: pick('stickyScroll'),
    formatBriefOnSave: pick('formatBriefOnSave'),
    tabSize: pick('tabSize'),
    briefColumns: pick('briefColumns'),
    zoom: pick('zoom'),
    uiFontFamily: pick('uiFontFamily'),
    uiFontSize: pick('uiFontSize'),
    codeFontFamily: pick('codeFontFamily'),
    codeFontSize: pick('codeFontSize'),
  };
}
