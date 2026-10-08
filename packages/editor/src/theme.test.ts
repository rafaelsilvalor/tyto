import { describe, expect, it } from 'vitest';

import { darkPalette, lightPalette } from './theme.js';

interface Colour {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/** Reads the two forms the palettes use: `#rrggbb` and `rgba(r, g, b, a)`. */
const parse = (value: string): Colour => {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex !== null) {
    const [, red, green, blue] = hex;
    return {
      red: Number.parseInt(red ?? '', 16),
      green: Number.parseInt(green ?? '', 16),
      blue: Number.parseInt(blue ?? '', 16),
      alpha: 1,
    };
  }
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value);
  if (rgba === null) throw new Error(`not a colour this test reads: ${value}`);
  const [, red, green, blue, alpha] = rgba;
  return { red: Number(red), green: Number(green), blue: Number(blue), alpha: Number(alpha) };
};

/** `over` painted on `under`, as the browser composites a translucent background. */
const composite = (over: Colour, under: Colour): readonly number[] =>
  (['red', 'green', 'blue'] as const).map((channel) =>
    Math.round(over.alpha * over[channel] + (1 - over.alpha) * under[channel]),
  );

describe.each([
  ['light', lightPalette],
  ['dark', darkPalette],
])('the %s active line (TYTO-246)', (_name, palette) => {
  // `drawSelection` paints the selection on a layer behind the text and the active line's
  // background sits on the line above it: an opaque colour hides the selection on that line.
  it('is translucent, so the selection drawn behind it shows through', () => {
    expect(parse(palette.activeLine).alpha).toBeLessThan(1);
  });

  it('still looks like the opaque colour the gutter keeps', () => {
    const line = composite(parse(palette.activeLine), parse(palette.background));
    const gutter = parse(palette.activeLineGutter);
    const difference = line.map((value, index) =>
      Math.abs(value - [gutter.red, gutter.green, gutter.blue][index]!),
    );
    expect(Math.max(...difference)).toBeLessThanOrEqual(1);
  });
});
