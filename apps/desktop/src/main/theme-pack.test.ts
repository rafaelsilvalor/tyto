import { isThemeColor } from '@tyto/plugin-api';
import {
  THEME_PACK_FILES,
  THEME_PACK_ID,
  THEME_PACK_THEMES,
  THEME_PACK_VARIANTS,
  type ThemePackFile,
} from '@tyto/theme-pack';
import { describe, expect, it } from 'vitest';

import { closestPair, colourDifference, MINIMUM_MODE_DIFFERENCE } from './colour-difference.js';
import { UPSTREAM_BADGE_COLOURS, UPSTREAM_COLOURS } from './theme-pack-upstream.js';
import { BASE_COLORS, builtInThemeSource, loadTheme, themeVariant } from './themes.js';

/**
 * The themes Tyto distributes from `@tyto/theme-pack` (TYTO-300), held to ADR 0089: every one
 * sets all forty-two tokens and every value is a colour. A theme that ships once, and every
 * adjusted twin, meets AA on the pairs the window draws text on; an original is exempt from the
 * floors and is held instead to upstream's colours, recorded in `theme-pack-upstream.ts`. Vim's
 * mode badge is held to AA in every theme, originals included (TYTO-301), and so is the editor's
 * active indent guide, to 3:1 (TYTO-293).
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
  // TYTO-301: the bar's text, which copies `text-muted` on `surface-raised`.
  ['status-bar-text', 'status-bar', 4.5],
] as const;

/**
 * Vim's mode badge and the role each mode's colour derives from (TYTO-301). The badge is Tyto's
 * and not upstream's, so it is held to 4.5 in every theme, originals included (ADR 0089).
 */
const BADGES = [
  ['normal', 'accent'],
  ['insert', 'success'],
  ['visual', 'syntax-keyword'],
  ['replace', 'error'],
] as const;

/**
 * HSL hue in degrees and saturation from 0 to 1 of a `#rrggbb` colour: what a lightness move
 * keeps (ADR 0089 decision 4).
 */
const hueAndSaturation = (value: string): readonly [number, number] => {
  const { red, green, blue } = parse(value);
  const [r, g, b] = [red / 255, green / 255, blue / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const range = max - min;
  if (range === 0) return [0, 0];
  const saturation = lightness > 0.5 ? range / (2 - max - min) : range / (max + min);
  const sector =
    max === r
      ? (g - b) / range + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / range + 2
        : (r - g) / range + 4;
  return [sector * 60, saturation];
};

/**
 * Whether `moved` is `source` with only its lightness changed, to what rounding to whole
 * `#rrggbb` channels allows: 2 degrees of hue and 2 points of saturation.
 */
const keepsHueAndSaturation = (moved: string, source: string): boolean => {
  const [hue, saturation] = hueAndSaturation(moved);
  const [sourceHue, sourceSaturation] = hueAndSaturation(source);
  const hueGap = Math.abs(hue - sourceHue);
  return Math.min(hueGap, 360 - hueGap) <= 2 && Math.abs(saturation - sourceSaturation) <= 0.02;
};

/**
 * The editor's indent guides (TYTO-293, ADR 0088). A guide is `border`'s colour and decorative,
 * held to no floor. The guide of the block holding the cursor is Tyto's derivation, as the badge
 * is, so it is held in every theme, originals included: 3:1 on the surface, WCAG's floor for a
 * graphical object, and ΔE2000 10 from the guide beside it, a difference seen at a glance.
 */
const ACTIVE_GUIDE_FLOOR = 3;

/** Why a theme's active guide is what it is: `text-disabled`, or that with the lightness moved. */
const activeGuideProblems = (colors: Readonly<Record<string, string>>): readonly string[] => {
  const problems: string[] = [];
  const active = colors['indent-guide-active']!;
  if (colors['indent-guide'] !== colors['border']) problems.push('the guide is not border');
  const ratio = contrast(active, colors['surface']!);
  if (ratio < ACTIVE_GUIDE_FLOOR) problems.push(`active ${ratio.toFixed(2)}:1 on surface`);
  const difference = colourDifference(active, colors['indent-guide']!);
  if (difference < MINIMUM_MODE_DIFFERENCE) {
    problems.push(`active ΔE ${difference.toFixed(1)} from the guide`);
  }
  return problems;
};

/** The colours a badge's text is chosen from: the best-reading of the three. */
const BADGE_TEXT_ROLES = ['surface', 'text', 'accent-text'] as const;

const themes = THEME_PACK_THEMES.map((theme) => {
  const file = THEME_PACK_FILES[theme.path];
  if (file === undefined) throw new Error(`${theme.id} names '${theme.path}', which is not there`);
  return { theme, file };
});

const ADJUSTED_SUFFIX = '-adjusted';

const fileOf = (id: string): ThemePackFile | undefined =>
  themes.find(({ theme }) => theme.id === id)?.file;

const originalId = (id: string): string => id.slice(0, -ADJUSTED_SUFFIX.length);

const failedFloors = (file: ThemePackFile): readonly string[] =>
  FLOORS.filter(
    ([text, ground, floor]) => contrast(file.colors[text]!, file.colors[ground]!) < floor,
  ).map(([text, ground]) => `${text} / ${ground}`);

describe('the theme pack', () => {
  it('ships dark and light themes', () => {
    expect(new Set(themes.map(({ theme }) => theme.kind))).toEqual(new Set(['dark', 'light']));
  });

  it('is read through its own plugin, not the desktop’s', () => {
    for (const { theme } of themes) expect(builtInThemeSource(theme).plugin).toBe(THEME_PACK_ID);
  });

  it('gives every theme an id of its own', () => {
    const ids = themes.map(({ theme }) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records upstream’s colours for every original, and only for originals', () => {
    const originals = themes.filter(({ file }) => file.variant === 'original');
    expect(Object.keys(UPSTREAM_COLOURS).sort()).toEqual(
      originals.map(({ theme }) => theme.id).sort(),
    );
  });

  it('tells the picker which of a pair each theme is, and nothing for a theme that ships once', () => {
    for (const { theme, file } of themes) {
      expect(themeVariant(theme)).toBe(file.variant);
      expect(THEME_PACK_VARIANTS[theme.id]).toBe(file.variant);
    }
    expect(themeVariant({ id: 'constructor', label: 'x', kind: 'dark', path: 'x.json' })).toBe(
      undefined,
    );
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

    it('sets exactly the forty-two tokens of the base theme, leaning on no fallback', () => {
      expect(Object.keys(file.colors).sort()).toEqual(Object.keys(BASE_COLORS[theme.kind]).sort());
      expect(Object.keys(file.colors)).toHaveLength(42);
    });

    // Held in originals too: the guide is Tyto's, never upstream's (TYTO-293).
    it('draws the guide in border and the active guide 3:1 and ΔE 10 apart from it', () => {
      expect(activeGuideProblems(file.colors)).toEqual([]);
    });

    it('draws the active guide in text-disabled, or moves only its lightness and says why', () => {
      const note = file.derived.find((entry) => entry.token === 'indent-guide-active');
      if (note === undefined) {
        expect(colour('indent-guide-active')).toBe(colour('text-disabled'));
        return;
      }
      expect(note.role).toBe('text-disabled');
      expect(note.value).toBe(colour('indent-guide-active'));
      expect(keepsHueAndSaturation(note.value, colour('text-disabled'))).toBe(true);
      // Moved only because text-disabled itself fails the rule.
      expect(
        activeGuideProblems({ ...file.colors, 'indent-guide-active': colour('text-disabled') }),
      ).not.toEqual([]);
    });

    // The badge is Tyto's derivation, never upstream's, so an original is held here too.
    it.each(BADGES)('reads vim’s %s badge at 4.5:1 or better (TYTO-301)', (mode) => {
      const badge = `status-bar-vim-${mode}`;
      expect(contrast(colour(`${badge}-text`), colour(badge))).toBeGreaterThanOrEqual(4.5);
    });

    // An adjusted twin draws its original's badge, so a role either file sets may be the source.
    const sources = [file, ...(file.variant === 'adjusted' ? [fileOf(originalId(theme.id))] : [])];

    it.each(BADGES)('colours the %s badge with %s, or says why not', (mode, role) => {
      const token = `status-bar-vim-${mode}`;
      const note = file.derived.find((entry) => entry.token === token);
      if (note === undefined) {
        expect(colour(token)).toBe(colour(role));
        return;
      }
      expect(note.role).toBe(role);
      expect(note.value).toBe(colour(token));
      expect(note.value).not.toBe(colour(role));
      expect(note.reason.length).toBeGreaterThan(0);
    });

    // A badge's colour is its role's, its role's with the lightness moved, or — where the role
    // would draw two modes alike — another colour of the same palette, lightness moved at most.
    it.each(BADGES)('draws the %s badge from its own palette', (mode, role) => {
      const note = file.derived.find((entry) => entry.token === `status-bar-vim-${mode}`);
      if (note === undefined) return;
      if (note.from === undefined) {
        const roleColours = sources.map((source) => source?.colors[role]);
        expect(roleColours.some((value) => value && keepsHueAndSaturation(note.value, value))).toBe(
          true,
        );
        return;
      }
      expect(note.reason).toMatch(/^distinct from (normal|insert|visual|replace):/);
      const palette = [
        ...sources.map((source) => source?.colors[note.from!.name]),
        UPSTREAM_BADGE_COLOURS[file.variant === 'adjusted' ? originalId(theme.id) : theme.id]?.[
          note.from.name
        ],
      ];
      expect(palette).toContain(note.from.value);
      expect(keepsHueAndSaturation(note.value, note.from.value)).toBe(true);
    });

    // Rafael, 2026-10-15: the badge's word changes with the mode, and so must its colour. Not
    // just unequal — ΔE2000 of 10 is a difference seen at a glance (`colour-difference.ts`).
    const modeColours = Object.fromEntries(
      BADGES.map(([mode]) => [mode, colour(`status-bar-vim-${mode}`)]),
    );
    const closest = closestPair(modeColours);
    it(`tells the four modes apart by colour (closest: ${closest.names.join(' and ')}, ΔE ${closest.difference.toFixed(1)})`, () => {
      expect(new Set(Object.values(modeColours)).size).toBe(BADGES.length);
      expect(closest.difference).toBeGreaterThanOrEqual(MINIMUM_MODE_DIFFERENCE);
    });

    it.each(BADGES)('writes the %s badge in surface, text or accent-text', (mode) => {
      const candidates = sources.flatMap((source) =>
        BADGE_TEXT_ROLES.map((role) => source?.colors[role]),
      );
      expect(candidates).toContain(colour(`status-bar-vim-${mode}-text`));
    });

    it('notes only badge colours and the active guide, each once', () => {
      const tokens = file.derived.map((entry) => entry.token);
      expect(new Set(tokens).size).toBe(tokens.length);
      for (const token of tokens) {
        expect([
          ...BADGES.map(([mode]) => `status-bar-vim-${mode}`),
          'indent-guide-active',
        ]).toContain(token);
      }
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

    // An original is upstream's colours and exempt (ADR 0089, Rafael 2026-10-15); every other
    // theme the pack ships is held to the floors.
    if (file.variant !== 'original') {
      it.each(FLOORS)('reads %s on %s at %s:1 or better (ADR 0089)', (text, ground, floor) => {
        expect(contrast(colour(text), colour(ground))).toBeGreaterThanOrEqual(floor);
      });
    }

    it('names every colour it changed from upstream, with the value it replaced', () => {
      for (const change of file.adjusted) {
        expect(colour(change.token)).toBe(change.value);
        expect(change.upstream).not.toBe(change.value);
        expect(isThemeColor(change.upstream)).toBe(true);
        expect(change.reason.length).toBeGreaterThan(0);
      }
    });

    if (file.variant === undefined) {
      // Rafael's rule: a theme that needs a change ships as a pair, so one that ships once is
      // upstream's colours with nothing changed.
      it('ships once because it changes nothing', () => {
        expect(file.adjusted).toEqual([]);
      });
    }

    if (file.variant === 'original') {
      const twin = fileOf(`${theme.id}${ADJUSTED_SUFFIX}`);

      it('is upstream’s colours exactly, as recorded from the source', () => {
        const recorded = UPSTREAM_COLOURS[theme.id] ?? {};
        expect(Object.keys(recorded).length).toBeGreaterThan(0);
        for (const [token, value] of Object.entries(recorded)) {
          expect({ token, value: colour(token) }).toEqual({ token, value });
        }
        expect(file.adjusted).toEqual([]);
      });

      it('fails a floor, which is why it ships beside an adjusted twin', () => {
        expect(failedFloors(file)).not.toEqual([]);
      });

      it('has an adjusted twin of its kind, named for it', () => {
        expect(twin?.variant).toBe('adjusted');
        expect(twin?.kind).toBe(file.kind);
        expect(twin?.name).toBe(`${file.name} (adjusted)`);
      });

      it('differs from its twin only in the colours the twin lists as adjusted', () => {
        const reverted = { ...twin?.colors };
        for (const change of twin?.adjusted ?? []) {
          expect(change.upstream).toBe(colour(change.token));
          reverted[change.token] = change.upstream;
        }
        expect(reverted).toEqual(file.colors);
      });
    }

    if (file.variant === 'adjusted') {
      it('has an original twin and says what it changed', () => {
        expect(theme.id.endsWith(ADJUSTED_SUFFIX)).toBe(true);
        expect(fileOf(theme.id.slice(0, -ADJUSTED_SUFFIX.length))?.variant).toBe('original');
        expect(file.adjusted).not.toEqual([]);
      });
    }
  },
);

// The built-in two are the token file's colours (ADR 0077) and draw the guides by the same rule.
describe.each(['light', 'dark'] as const)('Tyto %s', (kind) => {
  it('draws the guide in border and the active guide 3:1 and ΔE 10 apart from it', () => {
    expect(activeGuideProblems(BASE_COLORS[kind])).toEqual([]);
    expect(BASE_COLORS[kind]['indent-guide-active']).toBe(BASE_COLORS[kind]['text-disabled']);
  });
});
