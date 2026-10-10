import { sourceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { createPluginHost } from './host.js';
import { checkThemeContribution, isThemeColor, isThemePath, resolveThemeColors } from './theme.js';

/** Invented colours; the vocabulary is whatever the base names. */
const BASE = { surface: '#ffffff', text: '#000000', 'syntax-keyword': '#aa00aa' } as const;

describe('a theme colour (ADR 0077)', () => {
  it.each([
    '#fff',
    '#ffff',
    '#fafafa',
    '#fafafa80',
    'rgb(0 0 0 / 12%)',
    'rgba(0, 0, 0, 0.5)',
    'hsl(210 50% 40%)',
    'color-mix(in srgb, #3e4451 70%, #74ade8)',
    'color-mix(in oklch, rgb(0 0 0 / 40%), transparent)',
  ])('accepts %s', (value) => {
    expect(isThemeColor(value)).toBe(true);
  });

  it.each([
    // The injection the regex exists to refuse: closing the declaration, then the rule.
    '#fff; } body { display: none',
    '#fff;',
    'red}',
    'rgb(0 0 0); --tyto-text: #000',
    'color-mix(in srgb, url(//example.com/x) 50%, #fff)',
    'url(https://example.com/x.png)',
    'var(--tyto-text)',
    'expression(alert(1))',
    'red',
    '#ggg',
    '',
    `#${'f'.repeat(300)}`,
  ])('refuses %s', (value) => {
    expect(isThemeColor(value)).toBe(false);
  });
});

describe('a theme path', () => {
  it.each(['dusk.json', 'themes/dusk.json', 'a b/c.json'])('accepts %s', (path) => {
    expect(isThemePath(path)).toBe(true);
  });

  it.each([
    '',
    '../x.json',
    'themes/../../x.json',
    './x.json',
    '/abs.json',
    'C:/x.json',
    'a\\b.json',
    'a//b.json',
  ])('refuses %s', (path) => {
    expect(isThemePath(path)).toBe(false);
  });

  it('is refused at registration, which the loader reports as the plugin failing', () => {
    expect(() =>
      checkThemeContribution('dusk', {
        id: 'dusk',
        label: 'Dusk',
        kind: 'dark',
        path: '../x.json',
      }),
    ).toThrow(/not a relative path inside its folder/);

    const host = createPluginHost();
    const activated = host.tryActivate({
      id: 'dusk',
      manifest: {
        name: 'dusk',
        version: '0.1.0',
        engine: '>=0.1',
        contributes: ['theme'],
        permissions: [],
      },
      activate: (plugin) =>
        plugin.registerTheme({ id: 'dusk', label: 'Dusk', kind: 'dark', path: '../dusk.json' }),
    });
    expect(activated.ok ? [] : activated.error.map((item) => item.code)).toEqual([
      'E_PLUGIN_ACTIVATE',
    ]);
    expect(host.registry.themes()).toEqual([]);
  });
});

describe('the colours a theme applies', () => {
  it('takes every valid colour the theme sets and the base for the rest', () => {
    const resolved = resolveThemeColors('dusk', [{ token: 'surface', value: '#101010' }], BASE);
    expect(resolved.colors).toEqual({ ...BASE, surface: '#101010' });
    expect(resolved.diagnostics).toEqual([]);
  });

  it('names an unknown token at its range and applies nothing for it', () => {
    const resolved = resolveThemeColors(
      'dusk',
      [{ token: 'editor.background', value: '#101010', tokenRange: sourceRange(4, 23) }],
      BASE,
    );
    expect(resolved.colors).toEqual(BASE);
    expect(resolved.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_THEME_TOKEN_UNKNOWN', sourceRange(4, 23)],
    ]);
  });

  it('keeps the base colour for a value that is not one, and says so at the value', () => {
    const resolved = resolveThemeColors(
      'dusk',
      [
        { token: 'text', value: '#000; } * { color: red', valueRange: sourceRange(10, 32) },
        { token: 'surface', value: 12 },
      ],
      BASE,
    );
    expect(resolved.colors).toEqual(BASE);
    expect(resolved.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_THEME_COLOR_INVALID', sourceRange(10, 32)],
      ['W_THEME_COLOR_INVALID', undefined],
    ]);
  });

  it('does not treat a name the object inherits as a token', () => {
    const resolved = resolveThemeColors('dusk', [{ token: 'constructor', value: '#000' }], BASE);
    expect(resolved.colors).toEqual(BASE);
    expect(resolved.diagnostics.map((item) => item.code)).toEqual(['W_THEME_TOKEN_UNKNOWN']);
  });
});
