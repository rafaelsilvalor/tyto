import type { Diagnostic } from './panel.js';
import {
  BUNDLED_CODE_FAMILY,
  BUNDLED_UI_FAMILY,
  DEFAULT_TYPOGRAPHY,
  FONT_AREAS,
  type FontAreaId,
  type FontBase,
  type Typography,
  areaFontFamily,
  areaFontSize,
} from '../../shared/typography.js';

/**
 * The person's faces and sizes in the window (TYTO-272, ADR 0099): the declarations the theme
 * sheet writes over `tokens.css`, and the row that says a face is not on this machine.
 *
 * **Only what differs from the default is written**, so a window with no typography settings
 * runs on `tokens.css` alone and is the window it was before the card, pixel for pixel.
 *
 * A family is written as a CSS string and followed by the bundled face, and for the editor by
 * `monospace` as `tokens.css` has it: a name the machine lacks falls through to the face Tyto
 * ships rather than to the browser's default. The bridge's schema refused every character that
 * could close the string before the value got here.
 */

/** The custom properties for `typography`, one per line, for the sheet's `:root` block. */
export function typographyDeclarations(typography: Typography): string {
  const lines: string[] = [];
  if (typography.uiFontSize !== DEFAULT_TYPOGRAPHY.uiFontSize) {
    lines.push(`  --tyto-ui-size: ${String(typography.uiFontSize)}px;`);
  }
  if (typography.codeFontSize !== DEFAULT_TYPOGRAPHY.codeFontSize) {
    lines.push(`  --tyto-code-size: ${String(typography.codeFontSize)}px;`);
  }
  if (typography.uiFontFamily !== BUNDLED_UI_FAMILY) {
    lines.push(`  --tyto-font-ui: ${familyValue('ui', typography.uiFontFamily)};`);
  }
  if (typography.codeFontFamily !== BUNDLED_CODE_FAMILY) {
    lines.push(`  --tyto-font-mono: ${familyValue('code', typography.codeFontFamily)};`);
  }
  return lines.map((line) => `\n${line}`).join('');
}

/** The value of a base's face property: `tokens.css`'s own for the bundled face. */
function familyValue(base: FontBase, family: string): string {
  if (base === 'ui') {
    return family === BUNDLED_UI_FAMILY
      ? `'${BUNDLED_UI_FAMILY}'`
      : `"${family}", '${BUNDLED_UI_FAMILY}'`;
  }
  return family === BUNDLED_CODE_FAMILY
    ? `'${BUNDLED_CODE_FAMILY}', monospace`
    : `"${family}", '${BUNDLED_CODE_FAMILY}', monospace`;
}

/**
 * Where an area's root is. Every area is an element carrying `data-font-area`; the completion
 * list is also CodeMirror's own tooltip, which this window cannot give an attribute, so its
 * class is named beside it.
 */
export function areaSelector(id: FontAreaId): string {
  const attribute = `[data-font-area='${id}']`;
  return id === 'completion' ? `${attribute}, .cm-tooltip.cm-tooltip-autocomplete` : attribute;
}

/**
 * The areas' rules (TYTO-272 PR B, ADR 0099): on each area's root, the base's size and face
 * properties redeclared, so the ramp `tokens.css` declares on `[data-font-area]` is computed
 * there from the area's own size.
 *
 * **Nothing while no area is set**, so a window without `fontSizes` and `fontFamilies` is the
 * window PR A left. **Every area once one is**, an unset one at its base's value: areas nest —
 * the completion list sits inside the editor, a panel's header inside the panel — and an area
 * that wrote nothing would read the size of the area around it instead of its base.
 *
 * A UI area's root re-reads the face and the base size itself (`shell.css`, at no specificity),
 * because text there with no rule of its own inherits a size and a face resolved further up.
 * The code areas' text is CodeMirror's, which reads both properties where it draws.
 */
export function fontAreaRules(typography: Typography): string {
  const sizes = Object.keys(typography.fontSizes).length > 0;
  const faces = Object.keys(typography.fontFamilies).length > 0;
  if (!sizes && !faces) return '';
  return FONT_AREAS.map((area) => {
    const lines: string[] = [];
    if (sizes) {
      const property = area.base === 'ui' ? '--tyto-ui-size' : '--tyto-code-size';
      lines.push(`  ${property}: ${String(areaFontSize(typography, area))}px;`);
    }
    if (faces) {
      const property = area.base === 'ui' ? '--tyto-font-ui' : '--tyto-font-mono';
      lines.push(`  ${property}: ${familyValue(area.base, areaFontFamily(typography, area))};`);
    }
    return `\n${areaSelector(area.id)} {\n${lines.join('\n')}\n}`;
  }).join('');
}

/** How wide `text` is drawn in the CSS `font`; `undefined` where nothing can measure. */
export type MeasureText = (font: string, text: string) => number | undefined;

/** Glyphs whose widths differ between almost any two faces, wide and narrow both. */
const SAMPLE = 'mmmmmmmmmmlli1WQ@#';
const GENERICS = ['monospace', 'serif', 'sans-serif'] as const;

/**
 * Whether this machine draws `family` itself, measured: the sample in the family with each
 * generic face behind it, against the generic face alone. A family the machine lacks falls
 * through to the generic, so it measures the same as the generic under all three; one that is
 * there measures as itself, which differs from at least one of them. The bundled faces are
 * always there, from `tokens.css`. `undefined` when nothing could measure (jsdom has no
 * canvas), so no row is raised on a guess.
 */
export function familyIsInstalled(family: string, measure: MeasureText): boolean | undefined {
  if (family === BUNDLED_UI_FAMILY || family === BUNDLED_CODE_FAMILY) return true;
  let fellThrough = true;
  for (const generic of GENERICS) {
    const alone = measure(`72px ${generic}`, SAMPLE);
    const named = measure(`72px "${family}", ${generic}`, SAMPLE);
    if (alone === undefined || named === undefined) return undefined;
    if (alone !== named) fellThrough = false;
  }
  return !fellThrough;
}

/** The code the window mints for a face this machine does not have (docs/diagnostic-codes.md). */
export const FONT_FAMILY_MISSING = 'W_FONT_FAMILY_MISSING';

/**
 * A row per family setting naming a face this machine does not have: the message in the
 * window's language, then the setting and the name. A family left at its bundled default is
 * never measured.
 */
export function missingFamilyRows(
  typography: Typography,
  measure: MeasureText,
  message: string,
): Diagnostic[] {
  const settings: readonly (readonly [string, string])[] = [
    ['uiFontFamily', typography.uiFontFamily],
    ['codeFontFamily', typography.codeFontFamily],
    ...Object.entries(typography.fontFamilies).map(
      ([area, family]) => [`fontFamilies.${area}`, family ?? ''] as const,
    ),
  ];
  return settings
    .filter(([, family]) => familyIsInstalled(family, measure) === false)
    .map(([key, family]) => ({
      severity: 'warning' as const,
      code: FONT_FAMILY_MISSING,
      message: `${message}: ${key} "${family}"`,
    }));
}

/** The installation rows with the font rows replaced by `rows`. */
export function withFontRows<Row extends { readonly code: string }>(
  installation: readonly Row[],
  rows: readonly Row[],
): readonly Row[] {
  return [...installation.filter((row) => row.code !== FONT_FAMILY_MISSING), ...rows];
}

/** A canvas-backed `MeasureText`, or one that answers `undefined` where there is no canvas. */
export function canvasMeasure(target: Document = document): MeasureText {
  let context: CanvasRenderingContext2D | null | undefined;
  return (font, text) => {
    if (context === undefined) {
      try {
        context = target.createElement('canvas').getContext('2d');
      } catch {
        context = null;
      }
    }
    if (context === null) return undefined;
    context.font = font;
    return context.measureText(text).width;
  };
}
