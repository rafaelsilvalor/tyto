import type { ConfigurationContribution } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * The window's type: two faces, two sizes, and the zoom (TYTO-272, ADR 0099).
 *
 * **Two bases, and every size in the window derives from one of them.** `uiFontSize` is the size
 * `tokens.css` calls `--tyto-ui-size`, and the window's whole ramp — `--tyto-text-xs` to `-lg` —
 * is that size times a fixed ratio, rounded to a pixel, so at the default 14 every size is the
 * pixel it was before the card. `codeFontSize` is `--tyto-code-size`, every CodeMirror buffer's.
 * The families are the person's name followed by the bundled face, so a name the machine does not
 * have is drawn in the face Tyto ships and the window says so (`W_FONT_FAMILY_MISSING`).
 *
 * **The zoom is Electron's and not a size**: `webContents.setZoomLevel`, a factor of 1.2 per
 * step, which scales the window and the preview's art alike, as a browser's Ctrl and + does.
 *
 * PR B of the card adds a closed set of areas (`fontSizes`, `fontFamilies`) over these bases;
 * that is why the window is told one `typography` object and not four loose values.
 *
 * In `shared/` because both halves read it: main validates the settings and the window turns
 * them into custom properties. Linted pure.
 */

/** The bundled faces, which `tokens.css` declares with `@font-face` and names as the defaults. */
export const BUNDLED_UI_FAMILY = 'Source Sans 3';
export const BUNDLED_CODE_FAMILY = 'IBM Plex Mono';

export const ZOOM = { default: 0, minimum: -5, maximum: 5 } as const;
export const UI_FONT_SIZE = { default: 14, minimum: 9, maximum: 24 } as const;
export const CODE_FONT_SIZE = { default: 14, minimum: 9, maximum: 32 } as const;

/** Electron's own step: each zoom level is 1.2 times the one below it. */
export const zoomFactor = (level: number): number => 1.2 ** level;

/** What View > Zoom In, Zoom Out and Reset Zoom do to a level, inside the setting's bounds. */
export type ZoomStep = 'in' | 'out' | 'reset';

export function steppedZoom(level: number, step: ZoomStep): number {
  if (step === 'reset') return ZOOM.default;
  const next = level + (step === 'in' ? 1 : -1);
  return Math.min(ZOOM.maximum, Math.max(ZOOM.minimum, next));
}

/**
 * A family name as a person writes it, which the window puts inside a CSS string. Quotes, a
 * backslash and the characters that end a declaration or a rule are refused, so a name can never
 * close the string it is written into; every real family name passes.
 */
const familyName = z
  .string()
  .trim()
  .min(1, { error: 'is an empty family name' })
  .max(100, { error: 'is longer than 100 characters' })
  .regex(/^[^"'\\;{}<>\p{Cc}]+$/u, {
    error: 'is not a family name: quotes, backslashes and ; { } < > are not allowed',
  });

const size = (bounds: { readonly minimum: number; readonly maximum: number }) =>
  z
    .number()
    .int({ error: 'is not a whole number of pixels' })
    .min(bounds.minimum, {
      error: `is under ${String(bounds.minimum)}; the sizes are ${String(bounds.minimum)} to ${String(bounds.maximum)}`,
    })
    .max(bounds.maximum, {
      error: `is over ${String(bounds.maximum)}; the sizes are ${String(bounds.minimum)} to ${String(bounds.maximum)}`,
    });

export const zoomContribution = {
  id: 'zoom',
  schema: z
    .number()
    .int({ error: 'is not a whole step' })
    .min(ZOOM.minimum, { error: 'is under -5; the steps are -5 to 5' })
    .max(ZOOM.maximum, { error: 'is over 5; the steps are -5 to 5' }),
  default: ZOOM.default,
  description:
    'How far the whole window is zoomed, in steps of 20%, from -5 to 5 (default 0). Ctrl and =, Ctrl and - and Ctrl and 0 write it.',
  options: [
    { value: 0, description: 'Actual size.' },
    { value: 1, description: 'One step in: 120%.' },
    { value: 2, description: 'Two steps in: 144%.' },
    { value: -1, description: 'One step out: 83%.' },
  ],
} satisfies ConfigurationContribution<number>;

export const uiFontFamilyContribution = {
  id: 'uiFontFamily',
  schema: familyName,
  default: BUNDLED_UI_FAMILY,
  description:
    "The face of the window's text outside the editor: menus, tabs, panels, the status bar, the preview's controls and the dialogs. Source Sans 3 is drawn for a name this machine does not have.",
  options: [{ value: BUNDLED_UI_FAMILY, description: 'The face Tyto ships. The default.' }],
} satisfies ConfigurationContribution<string>;

export const uiFontSizeContribution = {
  id: 'uiFontSize',
  schema: size(UI_FONT_SIZE),
  default: UI_FONT_SIZE.default,
  description:
    "The size of the window's text outside the editor, in pixels, from 9 to 24 (default 14). Smaller and larger labels keep their proportion to it.",
  options: [
    { value: 14, description: 'The default.' },
    { value: 16, description: 'A little larger.' },
    { value: 18, description: 'Larger; the tab strips grow to fit.' },
  ],
} satisfies ConfigurationContribution<number>;

export const codeFontFamilyContribution = {
  id: 'codeFontFamily',
  schema: familyName,
  default: BUNDLED_CODE_FAMILY,
  description:
    'The face of the editor: briefs, settings and the template buffers. IBM Plex Mono is drawn for a name this machine does not have.',
  options: [{ value: BUNDLED_CODE_FAMILY, description: 'The face Tyto ships. The default.' }],
} satisfies ConfigurationContribution<string>;

export const codeFontSizeContribution = {
  id: 'codeFontSize',
  schema: size(CODE_FONT_SIZE),
  default: CODE_FONT_SIZE.default,
  description: 'The size of the editor’s text, in pixels, from 9 to 32 (default 14).',
  options: [
    { value: 14, description: 'The default.' },
    { value: 16, description: 'A little larger.' },
    { value: 20, description: 'Large.' },
  ],
} satisfies ConfigurationContribution<number>;

/** The five, in the order the settings file documents them. */
export const typographyContributions = [
  zoomContribution,
  uiFontFamilyContribution,
  uiFontSizeContribution,
  codeFontFamilyContribution,
  codeFontSizeContribution,
] as const;

/** The type the window applies, on `theme:current`'s answer. Zoom is main's alone. */
export interface Typography {
  readonly uiFontFamily: string;
  readonly uiFontSize: number;
  readonly codeFontFamily: string;
  readonly codeFontSize: number;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  uiFontFamily: BUNDLED_UI_FAMILY,
  uiFontSize: UI_FONT_SIZE.default,
  codeFontFamily: BUNDLED_CODE_FAMILY,
  codeFontSize: CODE_FONT_SIZE.default,
};

/** `typography` as the bridge checks it: the settings' own schemas, so both sides agree. */
export const typographySchema = z.object({
  uiFontFamily: familyName,
  uiFontSize: uiFontSizeContribution.schema,
  codeFontFamily: familyName,
  codeFontSize: codeFontSizeContribution.schema,
});

/** The five keys as a newly created `settings.json` shows them, commented out. */
export function typographyExample(): string {
  return [
    '// How far the whole window is zoomed, in steps of 20%, -5 to 5 (default 0). Ctrl and =, Ctrl and - and Ctrl and 0 write it here.',
    '// "zoom": 0,',
    "// The face and size (9 to 24) of the window's text outside the editor. A face this machine lacks is drawn in Source Sans 3.",
    '// "uiFontFamily": "Source Sans 3",',
    '// "uiFontSize": 14,',
    '// The face and size (9 to 32) of the editor. A face this machine lacks is drawn in IBM Plex Mono.',
    '// "codeFontFamily": "IBM Plex Mono",',
    '// "codeFontSize": 14,',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
