import { isThemeColor } from '@tyto/plugin-api';
import { THEME_PACK_FILES, THEME_PACK_ID, THEME_PACK_THEMES } from '@tyto/theme-pack';
import { describe, expect, it } from 'vitest';

import { BASE_COLORS, builtInThemeSource, loadTheme } from './themes.js';

/**
 * The themes Tyto distributes from `@tyto/theme-pack` (TYTO-300), held to ADR 0089: every one
 * sets all thirty tokens, every value is a colour, and every one meets AA on the pairs the
 * window draws text on.
 */

interface Colour {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/** The two forms the theme files write colours in: `#rrggbb` and `rgb(r g b / a%)`. */
const parse = (value: string): Colour => {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex !== null) {
    return {
      red: Number.parseInt(hex[1]!, 16),
      green: Number.parseInt(hex[2]!, 16),
      blue: Number.parseInt(hex[3]!, 16),
      alpha: 1,
    };
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)%\)$/.exec(value);
  if (rgb === null) throw new Error(`not a colour this test reads: ${value}`);
  return {
    red: Number(rgb[1]),
    green: Number(rgb[2]),
    blue: Number(rgb[3]),
    alpha: Number(rgb[4]) / 100,
  };
};

/** `over` painted on `under`, as the browser composites a translucent background. */
const composite = (over: Colour, under: Colour): readonly number[] =>
  (['red', 'green', 'blue'] as const).map((channel) =>
    Math.round(over.alpha * over[channel] + (1 - over.alpha) * under[channel]),
  );

/** WCAG 2.x relative luminance and contrast ratio, of two opaque colours. */
const luminance = (colour: Colour): number => {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(colour.red) + 0.7152 * linear(colour.green) + 0.0722 * linear(colour.blue);
};

const contrast = (one: string, two: string): number => {
  const [lighter, darker] = [luminance(parse(one)), luminance(parse(two))].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
};

/**
 * ADR 0089's floors. AA's 4.5 for anything read as text — the body, the secondary text on
 * every ground it sits on, an error and selected text — and 3 for a comment, which is
 * deliberately quiet, and for the accent line that marks the tab in front, a graphical object.
 */
const FLOORS = [
  ['text', 'surface', 4.5],
  ['text', 'surface-raised', 4.5],
  ['text-muted', 'surface', 4.5],
  ['text-muted', 'surface-raised', 4.5],
  ['text-muted', 'hover', 4.5],
  ['error', 'surface', 4.5],
  ['text', 'selection', 4.5],
  ['syntax-comment', 'surface', 3],
  ['accent', 'surface-raised', 3],
] as const;

const themes = THEME_PACK_THEMES.map((theme) => {
  const file = THEME_PACK_FILES[theme.path];
  if (file === undefined) throw new Error(`${theme.id} names '${theme.path}', which is not there`);
  return { theme, file };
});

describe('the theme pack', () => {
  it('ships a dark and a light theme', () => {
    expect(themes.map(({ theme }) => theme.kind).sort()).toEqual(['dark', 'light']);
  });

  it('is read through its own plugin, not the desktop’s', () => {
    for (const { theme } of themes) expect(builtInThemeSource(theme).plugin).toBe(THEME_PACK_ID);
  });
});

describe.each(themes.map(({ theme, file }) => [theme.label, theme, file] as const))(
  '%s',
  (_label, theme, file) => {
    const colour = (token: string): string => {
      const value = file.colors[token];
      if (value === undefined) throw new Error(`${theme.id} sets no '${token}'`);
      return value;
    };

    it('is the kind and the name its contribution says', () => {
      expect(file.kind).toBe(theme.kind);
      expect(file.name).toBe(theme.label);
    });

    it('sets exactly the thirty tokens of the base theme, leaning on no fallback', () => {
      expect(Object.keys(file.colors).sort()).toEqual(Object.keys(BASE_COLORS[theme.kind]).sort());
      expect(Object.keys(file.colors)).toHaveLength(30);
    });

    it('gives every token a colour', () => {
      const refused = Object.entries(file.colors).filter(([, value]) => !isThemeColor(value));
      expect(refused).toEqual([]);
    });

    it('loads with nothing to say, its own colours and not the base’s', async () => {
      const loaded = await loadTheme(theme, builtInThemeSource(theme).read);
      expect(loaded.diagnostics).toEqual([]);
      expect(loaded.colors).toEqual(file.colors);
    });

    // `drawSelection` paints the selection behind the text and the active line sits above it:
    // an opaque active line hides the selection on that line (TYTO-246).
    it('keeps the active line translucent', () => {
      expect(parse(colour('active-line')).alpha).toBeLessThan(1);
    });

    it('composites the active line to the colour the gutter keeps', () => {
      const line = composite(parse(colour('active-line')), parse(colour('surface')));
      const gutter = parse(colour('active-line-gutter'));
      const difference = line.map((channel, index) =>
        Math.abs(channel - [gutter.red, gutter.green, gutter.blue][index]!),
      );
      expect(Math.max(...difference)).toBeLessThanOrEqual(1);
    });

    it.each(FLOORS)('reads %s on %s at %s:1 or better (ADR 0089)', (text, ground, floor) => {
      expect(contrast(colour(text), colour(ground))).toBeGreaterThanOrEqual(floor);
    });

    it('names every colour it changed from upstream, with the value it replaced', () => {
      for (const change of file.adjusted) {
        expect(colour(change.token)).toBe(change.value);
        expect(change.upstream).not.toBe(change.value);
        expect(isThemeColor(change.upstream)).toBe(true);
      }
    });
  },
);
