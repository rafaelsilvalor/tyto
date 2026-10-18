import type { Diagnostic } from './panel.js';
import {
  BUNDLED_CODE_FAMILY,
  BUNDLED_UI_FAMILY,
  DEFAULT_TYPOGRAPHY,
  type Typography,
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
    lines.push(`  --tyto-font-ui: "${typography.uiFontFamily}", '${BUNDLED_UI_FAMILY}';`);
  }
  if (typography.codeFontFamily !== BUNDLED_CODE_FAMILY) {
    lines.push(
      `  --tyto-font-mono: "${typography.codeFontFamily}", '${BUNDLED_CODE_FAMILY}', monospace;`,
    );
  }
  return lines.map((line) => `\n${line}`).join('');
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
  const settings = [
    ['uiFontFamily', typography.uiFontFamily],
    ['codeFontFamily', typography.codeFontFamily],
  ] as const;
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
