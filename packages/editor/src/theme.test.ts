import { describe, expect, it } from 'vitest';

import { palette, panelStyles, panels, themeTokens } from './theme.js';

/**
 * What can be said about the theme without a browser.
 *
 * jsdom resolves no `var()`, so whether a colour shows is a question for the window, and
 * whether each name the editor reads is one the host defines is the desktop's
 * `e2e/renderer-tokens.test.ts`. The translucent active line of TYTO-246 moved there with its
 * colours. What is left here is the shape of the contract: every field is one custom property,
 * and the list a host is given is every property the editor reads.
 */

// Read through the bundler, not `node:fs`: this package is DOM-only (ADR 0010).
const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true });
const themeSource = sources['./theme.ts'] as string;

/** The source without its comments, which name pull requests as `#287` and quote CodeMirror. */
const themeCode = themeSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the palette (TYTO-96)', () => {
  it('reads every colour from a --tyto- custom property and writes none of its own', () => {
    for (const value of Object.values(palette)) {
      expect(value).toMatch(/^var\(--tyto-[a-z0-9-]+\)$/);
    }
  });

  it('hands the host every property it reads, the mono face included', () => {
    // Read off the source rather than off the objects, so a `token()` written straight into a
    // rule — outside `palette` and `panels` — is caught too (TYTO-258).
    const written = [
      ...[...themeSource.matchAll(/\btoken\('([a-z0-9-]+)'\)/g)].map(
        ([, role]) => `--tyto-${role}`,
      ),
      ...[...themeSource.matchAll(/var\((--tyto-[a-z0-9-]+)\)/g)].map(([, name]) => name!),
    ];
    expect(written.length).toBeGreaterThan(40);
    expect(written.filter((name) => !themeTokens.includes(name))).toEqual([]);
    expect(themeTokens).toContain('--tyto-font-mono');
  });

  it('reads no custom property anywhere else in the package', () => {
    // A `var(--tyto-…)` written outside `theme.ts` would not be in `themeTokens`, and the
    // desktop could not hold its token file to it.
    const readers = Object.entries(sources)
      .filter(([name]) => !name.endsWith('.test.ts') && !name.endsWith('.d.ts'))
      .filter(([, text]) => text.includes('--tyto-'))
      .map(([name]) => name);
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(readers).toEqual(['./theme.ts']);
  });
});

describe("CodeMirror's own panels, tooltips and diagnostics (TYTO-258)", () => {
  it('reads every value of theirs from a --tyto- custom property', () => {
    for (const value of Object.values(panels)) {
      expect(value).toMatch(/^var\(--tyto-[a-z0-9-]+\)$/);
    }
  });

  it('writes no colour, font stack or px size of its own anywhere in the theme', () => {
    const findings = themeCode.split('\n').flatMap((line, index) => {
      const where = `theme.ts:${index + 1}: ${line.trim()}`;
      const found: string[] = [];
      if (/#[0-9a-f]{3,8}\b/i.test(line)) found.push(`hex colour  ${where}`);
      if (/\b(?:rgba?|hsla?|color-mix)\(/.test(line)) found.push(`colour function  ${where}`);
      if (/'(?:white|black|red|orange|silver|gr[ae]y|blue|green|yellow|Highlight)'/.test(line)) {
        found.push(`named colour  ${where}`);
      }
      if (/\b\d+(?:\.\d+)?px\b/.test(line)) found.push(`px literal  ${where}`);
      if (/monospace|system-ui|ui-monospace/.test(line)) found.push(`font stack  ${where}`);
      return found;
    });
    expect(themeCode.length).toBeGreaterThan(2000);
    expect(findings).toEqual([]);
  });

  it("repeats CodeMirror's own selector for every part it paints", () => {
    // Each of these is the selector CodeMirror's base theme writes, so the two tie and this
    // theme wins by being mounted later. A shorter one loses in silence (ADR 0081).
    const mirrored = [
      '.cm-panels',
      '.cm-panels-top',
      '.cm-panels-bottom',
      '.cm-textfield',
      '.cm-button',
      '.cm-button:active',
      '.cm-panel.cm-search label',
      '.cm-panel.cm-search [name=close]',
      '.cm-searchMatch',
      '.cm-searchMatch-selected',
      '.cm-selectionMatch',
      '.cm-vim-panel',
      '.cm-vim-panel input',
      '.cm-tooltip',
      '.cm-tooltip-section:not(:first-child)',
      '.cm-tooltip.cm-tooltip-autocomplete > ul',
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li',
      '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section',
      '.cm-tooltip-autocomplete ul li[aria-selected]',
      '.cm-tooltip-autocomplete-disabled ul li[aria-selected]',
      '.cm-completionMatchedText',
      '.cm-completionDetail',
      '.cm-completionIcon',
      '.cm-diagnostic-error',
      '.cm-diagnostic-warning',
      '.cm-diagnostic-info',
      '.cm-diagnostic-hint',
      '.cm-diagnosticAction',
      '.cm-diagnosticSource',
      '.cm-lintRange-error',
      '.cm-lintRange-warning',
      '.cm-lintRange-info',
      '.cm-lintRange-hint',
      '.cm-lintRange-active',
      '.cm-lintPoint:after',
      '.cm-lintPoint-warning:after',
      '.cm-lintPoint-info:after',
      '.cm-lintPoint-hint:after',
    ];
    expect(mirrored.filter((selector) => !(selector in panelStyles))).toEqual([]);
  });

  it('takes the gradient off a button and the drawn underline off a diagnostic', () => {
    // A colour under CodeMirror's background image never shows; these two are images.
    expect(panelStyles['.cm-button'].backgroundImage).toBe('none');
    expect(panelStyles['.cm-button:active'].backgroundImage).toBe('none');
    for (const severity of ['error', 'warning', 'info', 'hint'] as const) {
      expect(panelStyles[`.cm-lintRange-${severity}`].backgroundImage).toBe('none');
    }
  });
});
