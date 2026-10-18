import { describe, expect, it } from 'vitest';

import { BASE_COLORS } from './themes.js';
import {
  TITLE_BAR_HEIGHT,
  drawsTitleBar,
  frameOptions,
  overlayColour,
  overlayFor,
  titleBarOverlay,
} from './title-bar.js';

/**
 * The window's frame and the colours of the system's buttons over the drawn title bar
 * (TYTO-244, ADR 0078), with no Electron under them.
 */

describe('overlayColour', () => {
  it('takes a hex colour as it is, lower-cased', () => {
    expect(overlayColour('#EBEBEC')).toBe('#ebebec');
    expect(overlayColour('#abc')).toBe('#abc');
  });

  it('drops an alpha channel: nothing shows through the frame', () => {
    expect(overlayColour('#ebebec80')).toBe('#ebebec');
    expect(overlayColour('#abcd')).toBe('#abc');
  });

  it("refuses what Electron's colour parser may not read", () => {
    expect(overlayColour('rgb(0 0 0 / 12%)')).toBeUndefined();
    expect(overlayColour('color-mix(in srgb, #fff 50%, #000)')).toBeUndefined();
    expect(overlayColour('hsl(0, 0%, 50%)')).toBeUndefined();
    expect(overlayColour(undefined)).toBeUndefined();
  });
});

describe('titleBarOverlay', () => {
  it("paints the buttons in the bar's colour with the text's glyphs, at the bar's height", () => {
    expect(titleBarOverlay(BASE_COLORS.light, BASE_COLORS.light)).toEqual({
      color: BASE_COLORS.light['surface-raised'],
      symbolColor: BASE_COLORS.light['text'],
      height: TITLE_BAR_HEIGHT,
    });
    expect(titleBarOverlay(BASE_COLORS.dark, BASE_COLORS.dark)).toEqual({
      color: '#2f343e',
      symbolColor: '#dce0e5',
      height: 32,
    });
  });

  it("takes a theme's own colours", () => {
    const sepia = { ...BASE_COLORS.light, 'surface-raised': '#e8dcc0', text: '#3b2f1e' };
    expect(titleBarOverlay(sepia, BASE_COLORS.light)).toMatchObject({
      color: '#e8dcc0',
      symbolColor: '#3b2f1e',
    });
  });

  it('falls back to the base colour, one colour at a time, where a theme wrote no hex', () => {
    const mixed = {
      ...BASE_COLORS.dark,
      'surface-raised': 'color-mix(in srgb, #000 50%, #fff)',
      text: '#ffffff',
    };
    expect(titleBarOverlay(mixed, BASE_COLORS.dark)).toMatchObject({
      color: BASE_COLORS.dark['surface-raised'],
      symbolColor: '#ffffff',
    });
  });
});

describe('overlayFor', () => {
  const applied = {
    light: { colors: { ...BASE_COLORS.light, 'surface-raised': '#111111' } },
    dark: { colors: { ...BASE_COLORS.dark, 'surface-raised': '#222222' } },
  };

  it('follows the kind the window shows', () => {
    expect(overlayFor(applied, BASE_COLORS, 'light').color).toBe('#111111');
    expect(overlayFor(applied, BASE_COLORS, 'dark').color).toBe('#222222');
  });

  it("grows the buttons with the page's zoom, a factor of 1.2 per step (TYTO-272)", () => {
    // The page's bar is 32 of its own pixels at every zoom, so in the window's it is 32 × 1.2ⁿ.
    expect(
      [-2, -1, 0, 1, 2, 5].map((zoom) => overlayFor(applied, BASE_COLORS, 'light', zoom).height),
    ).toEqual([22, 27, 32, 38, 46, 80]);
  });
});

describe('frameOptions', () => {
  const overlay = titleBarOverlay(BASE_COLORS.light, BASE_COLORS.light);

  it('hides the title bar and keeps the system buttons on Windows and Linux', () => {
    for (const platform of ['win32', 'linux']) {
      expect(drawsTitleBar(platform)).toBe(true);
      expect(frameOptions(platform, overlay)).toEqual({
        titleBarStyle: 'hidden',
        titleBarOverlay: overlay,
      });
    }
  });

  it('leaves the macOS frame as the system draws it', () => {
    expect(drawsTitleBar('darwin')).toBe(false);
    expect(frameOptions('darwin', overlay)).toEqual({});
  });
});
