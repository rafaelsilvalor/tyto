import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { themeTokens } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import { closestPair, MINIMUM_MODE_DIFFERENCE } from '../src/main/colour-difference.js';
import { GROUP_MINIMUM, SPLITTER_THICKNESS } from '../src/renderer/group-resize.js';

/**
 * The modes vim's badge has a colour for (TYTO-301), as `status-bar.ts` lists them. Written
 * again rather than imported: that module defines a custom element, which needs a DOM.
 */
const VIM_BADGE_MODES = ['normal', 'insert', 'visual', 'replace'] as const;

/**
 * The window's visual language is one file, and these are the checks that keep it one
 * (TYTO-96, ADR 0075).
 *
 * jsdom resolves no `var()`, so nothing that lays the window out in a unit test can see a
 * colour go missing. A `var(--tyto-x)` naming a token `tokens.css` does not define is simply
 * dropped by the browser — no error, the property falls back to its initial value — so the
 * guard is a comparison of names, made here, for the renderer's own sheets and for the
 * properties `@tyto/editor` reads. The second half is the card's acceptance grep: no literal
 * colour, radius, size or font outside `tokens.css`.
 */

/**
 * Here and not beside `tokens.css`, for `launch-isolation.test.ts`'s reason: it reads source and
 * launches nothing, so `vitest.config.ts` runs it in `pnpm check`. The renderer is a DOM folder
 * and may not import `node:fs`, even in a test (ADR 0010), and a bundler `?raw` import of a
 * stylesheet comes back empty under Vitest, which does not process CSS.
 */
const renderer = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const TOKEN_FILE = 'tokens.css';

const read = (name: string): string => readFileSync(join(renderer, name), 'utf8');

/** The renderer's own files, tests aside, which is where a literal could hide. */
const rendererFiles = (): string[] =>
  readdirSync(renderer).filter(
    (name) => /\.(css|ts|html)$/.test(name) && !name.endsWith('.test.ts') && name !== TOKEN_FILE,
  );

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** `name → value` for each custom property declared directly inside `block`. */
const declarations = (block: string): Map<string, string> => {
  const found = new Map<string, string>();
  for (const match of block.matchAll(/(--tyto-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1]!, match[2]!.trim().replace(/\s+/g, ' '));
  }
  return found;
};

/** The light record (`:root`) and the dark one (`:root` inside the media query). */
const themes = (): { light: Map<string, string>; dark: Map<string, string> } => {
  const css = withoutComments(read(TOKEN_FILE));
  const media = css.indexOf('@media (prefers-color-scheme: dark)');
  if (media < 0) throw new Error('tokens.css has no dark block');
  return { light: declarations(css.slice(0, media)), dark: declarations(css.slice(media)) };
};

/**
 * The built-in themes, `src/main/themes/tyto-*.json` (TYTO-208, ADR 0077): what the window
 * applies over `tokens.css` once main answers. One truth and not two — the test below holds
 * every colour of each file equal to the token file's — so a colour changed in only one of
 * the two places fails here rather than flickering between first paint and theme.
 */
const builtInTheme = (kind: 'light' | 'dark'): Map<string, string> => {
  const file = join(renderer, '..', 'main', 'themes', `tyto-${kind}.json`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { colors: Record<string, string> };
  return new Map(Object.entries(parsed.colors).map(([token, value]) => [`--tyto-${token}`, value]));
};

const usedNames = (text: string): string[] =>
  [...text.matchAll(/var\((--tyto-[a-z0-9-]+)/g)].map((match) => match[1]!);

describe('every token used is a token defined', () => {
  const { light, dark } = themes();

  it('defines the roles the plan names', () => {
    for (const role of [
      'surface',
      'surface-raised',
      'surface-sunken',
      'border',
      'hairline',
      'text',
      'text-muted',
      'text-disabled',
      'accent',
      'accent-text',
      'focus-ring',
      'selection',
      'hover',
      'button-on',
      'error',
      'warning',
      'info',
      'success',
      'font-ui',
      'font-mono',
      'radius-sm',
      'radius-md',
      'hairline-width',
    ]) {
      expect(light.has(`--tyto-${role}`), role).toBe(true);
    }
  });

  it('gives dark no token light lacks, so a dark-only name cannot hide in one theme', () => {
    expect([...dark.keys()].filter((name) => !light.has(name))).toEqual([]);
  });

  it.each(rendererFiles())('%s names only defined tokens', (name) => {
    expect(usedNames(read(name)).filter((token) => !light.has(token))).toEqual([]);
  });

  it('defines every property the editor reads', () => {
    expect(themeTokens.length).toBeGreaterThan(10);
    expect(themeTokens.filter((token) => !light.has(token))).toEqual([]);
  });

  it('resolves every var() inside the token file to a token it defines', () => {
    const inside = usedNames(withoutComments(read(TOKEN_FILE)));
    expect(inside.filter((token) => !light.has(token))).toEqual([]);
  });
});

/** One finding per offending declaration, so a red run names the file and the line. */
const literalsIn = (name: string): string[] => {
  const text = read(name);
  const findings: string[] = [];
  const lines = (name.endsWith('.css') ? withoutComments(text) : text).split('\n');
  lines.forEach((line, index) => {
    const where = `${name}:${index + 1}: ${line.trim()}`;
    if (name.endsWith('.css')) {
      const declaration = /^\s*([a-z-]+)\s*:\s*(.*?);?\s*$/.exec(line);
      if (/#[0-9a-f]{3,8}\b/i.test(line)) findings.push(`hex colour  ${where}`);
      if (/\b(?:rgba?|hsla?|color-mix)\(/.test(line)) findings.push(`colour function  ${where}`);
      if (/:\s*(?:white|black)\b/.test(line)) findings.push(`named colour  ${where}`);
      if (declaration === null) return;
      const [, property, value] = declaration;
      if (property!.startsWith('--')) {
        findings.push(`custom property declared outside the token file  ${where}`);
      } else if (
        // Sizes since TYTO-288: the pane shape's heights are tokens, and a guard that let a
        // `height` in pixels through could not keep them the only heights a strip has.
        (/^(?:border-radius|font-size|gap|row-gap|column-gap|padding|margin|border)(?:-[a-z-]+)?$/.test(
          property!,
        ) ||
          /^(?:min-|max-)?(?:width|height)$/.test(property!)) &&
        /\b\d+(?:\.\d+)?px\b/.test(value!)
      ) {
        findings.push(`px literal  ${where}`);
      } else if (
        property === 'font-family' &&
        !/^(?:var\(--tyto-font-[a-z]+\)|inherit)$/.test(value!)
      ) {
        findings.push(`font stack  ${where}`);
      } else if (property === 'font' && value !== 'inherit') {
        findings.push(`font shorthand  ${where}`);
      } else if (property === 'font-weight' && /\d/.test(value!)) {
        findings.push(`font weight  ${where}`);
      }
      return;
    }
    // TypeScript and HTML: a style written inline would dodge the sheet. Comments in TS name
    // pull requests as `#287`, so a hex counts only where a colour property precedes it.
    if (/(?:color|background|border|fill|stroke)[^\n]*#[0-9a-f]{3,8}\b/i.test(line)) {
      findings.push(`hex colour  ${where}`);
    }
    if (/\b(?:rgba?|hsla?|color-mix)\(/.test(line)) findings.push(`colour function  ${where}`);
    if (/font-family\s*:|system-ui|ui-monospace/.test(line)) findings.push(`font  ${where}`);
    if (/border-radius\s*:\s*\d/.test(line)) findings.push(`radius  ${where}`);
  });
  return findings;
};

describe('the sizes a rule elsewhere repeats (TYTO-288)', () => {
  // A group is held at its minimum twice: by `.editor-group` while the window shrinks, and by
  // `GROUP_MINIMUM` while a splitter is dragged (TYTO-289). Two numbers that must agree.
  it('gives a group the same minimum in the sheet and in the splitter', () => {
    const { light } = themes();
    expect(light.get('--tyto-group-min-width')).toBe(`${String(GROUP_MINIMUM.row)}px`);
    expect(light.get('--tyto-group-min-height')).toBe(`${String(GROUP_MINIMUM.column)}px`);
  });

  // A split is held at its groups' minimum plus the lines between them, counted in TypeScript
  // (`footprintOf`) and drawn at the hairline's width (TYTO-299). Two numbers that must agree.
  it('counts the line between two groups at the hairline’s width', () => {
    const { light } = themes();
    expect(light.get('--tyto-hairline-width')).toBe(`${String(SPLITTER_THICKNESS)}px`);
    expect(light.get('--tyto-dock-min-width')).toMatch(/^\d+px$/);
    expect(light.get('--tyto-dock-min-height')).toMatch(/^\d+px$/);
  });

  it('declares both lines of the pane shape in pixels', () => {
    const { light } = themes();
    expect(light.get('--tyto-pane-strip-height')).toMatch(/^\d+px$/);
    expect(light.get('--tyto-pane-header-height')).toMatch(/^\d+px$/);
  });
});

describe('no literal outside tokens.css (the acceptance grep)', () => {
  it('finds the renderer files it is meant to read', () => {
    expect(rendererFiles()).toContain('shell.css');
    expect(rendererFiles()).toContain('index.html');
    expect(rendererFiles().length).toBeGreaterThan(20);
  });

  it.each(rendererFiles())('%s writes no colour, radius, size or font of its own', (name) => {
    expect(literalsIn(name)).toEqual([]);
  });
});

interface Colour {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/** Reads the two forms the token file writes colours in: `#rrggbb` and `rgb(r g b / a%)`. */
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

/** WCAG 2.x relative luminance and contrast ratio. */
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

describe('the built-in theme files are the token file (ADR 0077)', () => {
  const { light, dark } = themes();

  it('theme exactly the colours the token file redefines for dark, no more and no fewer', () => {
    expect(dark.size).toBe(42);
    for (const kind of ['light', 'dark'] as const) {
      expect([...builtInTheme(kind).keys()].sort(), kind).toEqual([...dark.keys()].sort());
    }
  });

  it.each(['light', 'dark'] as const)('gives every colour of %s the token file’s value', (kind) => {
    const tokens = kind === 'dark' ? dark : light;
    const differing = [...builtInTheme(kind)].filter(
      ([token, value]) => tokens.get(token) !== value,
    );
    expect(differing).toEqual([]);
  });
});

describe.each(['light', 'dark'] as const)('the %s theme', (name) => {
  const { light, dark } = themes();
  // The built-in theme's colour first, since that is what is applied; the token file for the
  // rest. The floors hold the built-ins; a third party's theme is not held to them (ADR 0077).
  const applied = builtInTheme(name);
  const value = (token: string): string =>
    applied.get(token) ?? (name === 'dark' ? dark.get(token) : undefined) ?? light.get(token) ?? '';

  // `drawSelection` paints the selection on a layer behind the text and the active line's
  // background sits on the line above it: an opaque colour hides the selection on that line.
  it('keeps the active line translucent, so a selection drawn behind it shows (TYTO-246)', () => {
    expect(parse(value('--tyto-active-line')).alpha).toBeLessThan(1);
  });

  it('composites the active line to the colour the gutter keeps', () => {
    const line = composite(parse(value('--tyto-active-line')), parse(value('--tyto-surface')));
    const gutter = parse(value('--tyto-active-line-gutter'));
    const difference = line.map((channel, index) =>
      Math.abs(channel - [gutter.red, gutter.green, gutter.blue][index]!),
    );
    expect(Math.max(...difference)).toBeLessThanOrEqual(1);
  });

  // AA asks 4.5 for body text; the body text is held to AAA's 7 because it is most of what is
  // on screen, and the secondary text, the errors and selected text to AA. A comment is
  // deliberately quiet and held to 3, the floor for large or non-essential text.
  it.each<readonly [string, string, number]>([
    ['--tyto-text', '--tyto-surface', 7],
    ['--tyto-text', '--tyto-surface-raised', 7],
    ['--tyto-text-muted', '--tyto-surface', 4.5],
    ['--tyto-text-muted', '--tyto-surface-raised', 4.5],
    ['--tyto-error', '--tyto-surface', 4.5],
    ['--tyto-syntax-comment', '--tyto-surface', 3],
    ['--tyto-text', '--tyto-selection', 4.5],
    // TYTO-288: an inactive tab's name is muted, and a hovered tab paints `hover` behind it.
    ['--tyto-text-muted', '--tyto-hover', 4.5],
    // The focused group's tab in front is marked by an accent line on the strip, which is a
    // graphical object and not text: WCAG's 3:1 for one.
    ['--tyto-accent', '--tyto-surface-raised', 3],
    // TYTO-301: the bar's own text, and vim's mode on its badge, are text: AA.
    ['--tyto-status-bar-text', '--tyto-status-bar', 4.5],
    ...VIM_BADGE_MODES.map(
      (mode) =>
        [`--tyto-status-bar-vim-${mode}-text`, `--tyto-status-bar-vim-${mode}`, 4.5] as const,
    ),
  ])('reads %s on %s at %s:1 or better', (text, ground, floor) => {
    expect(contrast(value(text), value(ground))).toBeGreaterThanOrEqual(floor);
  });

  // Rafael, 2026-10-15: no two of vim's modes share a colour, and the closest two are told
  // apart at a glance — ΔE2000 of 10 (ADR 0089 decision 8, `colour-difference.ts`).
  const modeColours = Object.fromEntries(
    VIM_BADGE_MODES.map((mode) => [mode, value(`--tyto-status-bar-vim-${mode}`)]),
  );
  const closest = closestPair(modeColours);
  it(`tells vim's four modes apart by colour (closest: ${closest.names.join(' and ')}, ΔE ${closest.difference.toFixed(1)})`, () => {
    expect(new Set(Object.values(modeColours)).size).toBe(VIM_BADGE_MODES.length);
    expect(closest.difference).toBeGreaterThanOrEqual(MINIMUM_MODE_DIFFERENCE);
  });
});

/** The declarations of the one rule in `shell.css` whose selector is exactly `selector`. */
const ruleOf = (selector: string): Map<string, string> => {
  const css = withoutComments(read('shell.css'));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    (match) => match[1]!.trim() === selector,
  );
  if (rules.length !== 1) throw new Error(`shell.css has ${String(rules.length)} '${selector}'`);
  return new Map(
    [...rules[0]![2]!.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1]!,
      match[2]!.trim(),
    ]),
  );
};

describe('the status bar wears its own tokens (TYTO-301)', () => {
  it('paints the bar with the bar’s pair', () => {
    const foot = ruleOf('.shell__foot');
    expect(foot.get('background')).toBe('var(--tyto-status-bar)');
    expect(foot.get('color')).toBe('var(--tyto-status-bar-text)');
  });

  // The badge was `accent-text` on `accent` until this card: 4.01:1 in Tyto Light, under AA.
  it.each(VIM_BADGE_MODES)('paints the %s badge with that mode’s pair', (mode) => {
    const rule = ruleOf(
      mode === 'normal' ? '.status-bar__vim' : `.status-bar__vim[data-mode='${mode}']`,
    );
    expect(rule.get('background')).toBe(`var(--tyto-status-bar-vim-${mode})`);
    expect(rule.get('color')).toBe(`var(--tyto-status-bar-vim-${mode}-text)`);
  });
});
