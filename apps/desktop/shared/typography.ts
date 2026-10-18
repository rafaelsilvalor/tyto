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
 * PR B of the card adds a closed set of areas (`fontSizes`, `fontFamilies`) over these bases,
 * which is why the window is told one `typography` object and not loose values.
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
export const familyName = z
  .string()
  .trim()
  .min(1, { error: 'is an empty family name' })
  .max(100, { error: 'is longer than 100 characters' })
  .regex(/^[^"'\\;{}<>\p{Cc}]+$/u, {
    error: 'is not a family name: quotes, backslashes and ; { } < > are not allowed',
  });

export const size = (bounds: { readonly minimum: number; readonly maximum: number }) =>
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

/** What an area's size or face falls back to while it is not set: one of the two bases. */
export type FontBase = 'ui' | 'code';

/**
 * One part of the window with a size and a face of its own (TYTO-272 PR B, ADR 0099 decision
 * 2): the base it follows while unset, the largest size it takes, and what it covers.
 */
export interface FontArea {
  readonly id: string;
  readonly base: FontBase;
  readonly maximum: number;
  readonly description: string;
}

/**
 * **The areas are a closed list the app declares**, not selectors a person writes: a selector
 * is a contract with the markup, and the markup is free to change. Each area's root carries
 * `data-font-area="<id>"`, where the window redeclares the base's custom properties, so the
 * ramp inside the area follows (`tokens.css`). The title bar is capped at 18, under the
 * system buttons' 32 px. The explorer has no root until TYTO-279 builds one.
 */
export const FONT_AREAS = [
  {
    id: 'editor',
    base: 'code',
    maximum: CODE_FONT_SIZE.maximum,
    description: 'The brief editor and the template buffers.',
  },
  {
    id: 'json',
    base: 'code',
    maximum: CODE_FONT_SIZE.maximum,
    description: 'The settings, keybindings and snippets tabs.',
  },
  {
    id: 'completion',
    base: 'code',
    maximum: CODE_FONT_SIZE.maximum,
    description: "The editor's suggestion list.",
  },
  {
    id: 'problems',
    base: 'ui',
    maximum: UI_FONT_SIZE.maximum,
    description: "The problems panel's rows.",
  },
  {
    id: 'commandBar',
    base: 'ui',
    maximum: UI_FONT_SIZE.maximum,
    description: 'The command bar (Ctrl+K) and its lists.',
  },
  {
    id: 'titleBar',
    base: 'ui',
    maximum: 18,
    description: "The window's title bar, up to 18; the native menus keep the system's text.",
  },
  {
    id: 'tabs',
    base: 'ui',
    maximum: UI_FONT_SIZE.maximum,
    description: "The editor groups' tab strips, which grow to fit.",
  },
  {
    id: 'paneHeaders',
    base: 'ui',
    maximum: UI_FONT_SIZE.maximum,
    description: "The breadcrumb row, a preview's bar and the panels' headers.",
  },
  {
    id: 'statusBar',
    base: 'ui',
    maximum: UI_FONT_SIZE.maximum,
    description: 'The status bar.',
  },
  {
    id: 'queue',
    base: 'ui',
    maximum: UI_FONT_SIZE.maximum,
    description: "The queue panel's body.",
  },
  {
    id: 'explorer',
    base: 'ui',
    maximum: UI_FONT_SIZE.maximum,
    description: 'The file explorer, once the window has one (TYTO-279); nothing yet.',
  },
] as const satisfies readonly FontArea[];

export type FontAreaId = (typeof FONT_AREAS)[number]['id'];

const AREA_IDS = FONT_AREAS.map((area) => area.id) as [FontAreaId, ...FontAreaId[]];

const fontArea = z.enum(AREA_IDS, {
  error: (issue) => `'${String(issue.input)}' is not an area; the areas are ${AREA_IDS.join(', ')}`,
});

/** An area's own bounds: its base's minimum, and its own maximum. */
const areaSize = (area: FontArea) =>
  size({
    minimum: area.base === 'code' ? CODE_FONT_SIZE.minimum : UI_FONT_SIZE.minimum,
    maximum: area.maximum,
  });

const baseKeys = (base: FontBase): string =>
  base === 'code' ? 'codeFontSize and codeFontFamily' : 'uiFontSize and uiFontFamily';

const areaOptions = FONT_AREAS.map((area) => ({
  value: area.id,
  description: `${area.description} Follows ${baseKeys(area.base)} while unset.`,
}));

export type FontSizes = Readonly<Partial<Record<FontAreaId, number>>>;
export type FontFamilies = Readonly<Partial<Record<FontAreaId, string>>>;

/** Each area's own bounds, which the bridge checks again and the `members` rule by name. */
const AREA_SIZES = Object.fromEntries(FONT_AREAS.map((area) => [area.id, areaSize(area)]));

const fontSizesSchema = z
  .partialRecord(fontArea, z.number())
  .superRefine((sizes, context) => {
    for (const [area, value] of Object.entries(sizes)) {
      const checked = AREA_SIZES[area]?.safeParse(value);
      if (checked?.success === false) {
        context.addIssue({
          code: 'custom',
          path: [area],
          message: checked.error.issues.map((issue) => issue.message).join('; '),
        });
      }
    }
  })
  .readonly();

const fontFamiliesSchema = z.partialRecord(fontArea, familyName).readonly();

/**
 * `fontSizes`: a size in pixels per area, over its base. Each member is checked on its own
 * (`members`), so an unknown area is `W_SETTING_ENTRY_INVALID` at its name and a size outside
 * that area's own bounds `W_SETTING_INVALID` at the value, and only that area follows its base.
 */
export const fontSizesContribution = {
  id: 'fontSizes',
  schema: fontSizesSchema,
  default: {},
  description:
    'A text size in pixels for one part of the window, over its base (uiFontSize or codeFontSize). An area left out follows its base. ' +
    FONT_AREAS.map((area) => `${area.id}: ${area.description}`).join(' '),
  members: {
    key: fontArea,
    schema: size({ minimum: UI_FONT_SIZE.minimum, maximum: CODE_FONT_SIZE.maximum }),
    schemaByName: AREA_SIZES,
    options: areaOptions,
  },
} satisfies ConfigurationContribution<FontSizes>;

/**
 * `fontFamilies`: a face per area, over its base's face and with the bundled face behind it; a
 * face this machine lacks is `W_FONT_FAMILY_MISSING`, as for the bases.
 */
export const fontFamiliesContribution = {
  id: 'fontFamilies',
  schema: fontFamiliesSchema,
  default: {},
  description:
    'A face for one part of the window, over its base (uiFontFamily or codeFontFamily). An area left out follows its base. ' +
    FONT_AREAS.map((area) => `${area.id}: ${area.description}`).join(' '),
  members: { key: fontArea, schema: familyName, options: areaOptions },
} satisfies ConfigurationContribution<FontFamilies>;

/** The seven, in the order the settings file documents them. */
export const typographyContributions = [
  zoomContribution,
  uiFontFamilyContribution,
  uiFontSizeContribution,
  codeFontFamilyContribution,
  codeFontSizeContribution,
  fontSizesContribution,
  fontFamiliesContribution,
] as const;

/** The type the window applies, on `theme:current`'s answer. Zoom is main's alone. */
export interface Typography {
  readonly uiFontFamily: string;
  readonly uiFontSize: number;
  readonly codeFontFamily: string;
  readonly codeFontSize: number;
  /** A size per area that has one (TYTO-272 PR B); the rest follow their base. */
  readonly fontSizes: FontSizes;
  /** A face per area that has one; the rest follow their base. */
  readonly fontFamilies: FontFamilies;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  uiFontFamily: BUNDLED_UI_FAMILY,
  uiFontSize: UI_FONT_SIZE.default,
  codeFontFamily: BUNDLED_CODE_FAMILY,
  codeFontSize: CODE_FONT_SIZE.default,
  fontSizes: {},
  fontFamilies: {},
};

/** `typography` as the bridge checks it: the settings' own schemas, so both sides agree. */
export const typographySchema = z.object({
  uiFontFamily: familyName,
  uiFontSize: uiFontSizeContribution.schema,
  codeFontFamily: familyName,
  codeFontSize: codeFontSizeContribution.schema,
  fontSizes: fontSizesSchema,
  fontFamilies: fontFamiliesSchema,
});

type DeclaredArea = (typeof FONT_AREAS)[number];

/** The size an area is drawn at: its own, or its base's. */
export function areaFontSize(typography: Typography, area: DeclaredArea): number {
  return (
    typography.fontSizes[area.id] ??
    (area.base === 'code' ? typography.codeFontSize : typography.uiFontSize)
  );
}

/** The face an area is drawn in: its own, or its base's. */
export function areaFontFamily(typography: Typography, area: DeclaredArea): string {
  return (
    typography.fontFamilies[area.id] ??
    (area.base === 'code' ? typography.codeFontFamily : typography.uiFontFamily)
  );
}

/** One commented line per area, inside an object the example opens and closes. */
const areaLines = (value: (area: DeclaredArea) => string): string[] =>
  FONT_AREAS.map(
    (area, index) =>
      `//   "${area.id}": ${value(area)}${index === FONT_AREAS.length - 1 ? '' : ','}`,
  );

/** The seven keys as a newly created `settings.json` shows them, commented out. */
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
    '// A size per part of the window. Write only the parts to change: a part left out follows its',
    '// base. editor, json and completion follow codeFontSize (9 to 32), the rest uiFontSize (9 to 24; titleBar up to 18).',
    '// "fontSizes": {',
    ...areaLines((area) =>
      String(area.base === 'code' ? CODE_FONT_SIZE.default : UI_FONT_SIZE.default),
    ),
    '// },',
    '// A face per part of the window, the same way, over codeFontFamily or uiFontFamily.',
    '// "fontFamilies": {',
    ...areaLines((area) =>
      JSON.stringify(area.base === 'code' ? BUNDLED_CODE_FAMILY : BUNDLED_UI_FAMILY),
    ),
    '// },',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
