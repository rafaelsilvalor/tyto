/**
 * The contrast between two colours, as WCAG 2 measures it (TYTO-837): the ratio of their relative
 * luminances, each plus 0.05, the lighter over the darker — 1 for one colour against itself, 21
 * for black against white. A template that lets a brief choose its colours (ADR 0226) measures
 * the pairs it draws text in and reports `W_TEMPLATE_LOW_CONTRAST` below its own threshold; 4.5
 * is WCAG's for body text.
 *
 * Pure: no DOM, no canvas. Hex only, the forms a declared colour takes (`#rgb`, `#rgba`,
 * `#rrggbb`, `#rrggbbaa`); alpha is ignored, since a template draws these colours opaque.
 */

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;

/** The relative luminance of a hex colour, 0 for black and 1 for white; undefined for no hex. */
export function relativeLuminance(hex: string): number | undefined {
  const match = HEX.exec(hex);
  if (match === null) return undefined;
  let digits = match[1]!;
  if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join('');
  const channel = (at: number): number => {
    const value = parseInt(digits.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** The WCAG 2 contrast ratio of two hex colours, 1 to 21; undefined when either is no hex. */
export function contrastRatio(a: string, b: string): number | undefined {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  if (first === undefined || second === undefined) return undefined;
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
