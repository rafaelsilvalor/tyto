import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { themeTokens } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

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
        /^(?:border-radius|font-size|gap|row-gap|column-gap|padding|margin|border)(?:-[a-z-]+)?$/.test(
          property!,
        ) &&
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

describe.each(['light', 'dark'] as const)('the %s theme', (name) => {
  const { light, dark } = themes();
  const value = (token: string): string =>
    (name === 'dark' ? dark.get(token) : undefined) ?? light.get(token) ?? '';

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
  it.each([
    ['--tyto-text', '--tyto-surface', 7],
    ['--tyto-text', '--tyto-surface-raised', 7],
    ['--tyto-text-muted', '--tyto-surface', 4.5],
    ['--tyto-text-muted', '--tyto-surface-raised', 4.5],
    ['--tyto-error', '--tyto-surface', 4.5],
    ['--tyto-syntax-comment', '--tyto-surface', 3],
    ['--tyto-text', '--tyto-selection', 4.5],
  ])('reads %s on %s at %s:1 or better', (text, ground, floor) => {
    expect(contrast(value(text), value(ground))).toBeGreaterThanOrEqual(floor);
  });
});
