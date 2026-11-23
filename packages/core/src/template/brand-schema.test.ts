import { describe, expect, it } from 'vitest';

import { MARK_LAYER_LIMIT, MARK_PATH_LIMIT, brandKitSchema } from './brand-schema.js';

/**
 * The kit a plugin may register (ADR 0063, ADR 0066), checked where it arrives. The isolated
 * boundary runs the same schema; these are the rules on their own, one refusal each.
 */

// Invented: a square in a frame, in two tones.
const BOX = { w: 10, h: 10 };
const layer = (tone: string, d = 'M0 0H10V10H0Z') => ({ tone, d, fillRule: 'nonzero' });
const TONED = { box: BOX, layers: [layer('secondary'), layer('primary', 'M3 3H7V7H3Z')] };

describe('brandKitSchema', () => {
  it.each([
    [
      'a one-shape logo, as ADR 0063 wrote it',
      { logo: { box: BOX, d: 'M0 0Z', fillRule: 'evenodd' } },
    ],
    ['a toned logo', { logo: TONED }],
    ['a toned wordmark beside a signature', { wordmark: TONED, signature: 'invented' }],
    ['a one-shape wordmark', { wordmark: { box: BOX, d: 'M0 0Z', fillRule: 'nonzero' } }],
    [
      'layers whose paths together are exactly the limit',
      {
        logo: {
          box: BOX,
          layers: [
            layer('primary', 'M'.padEnd(MARK_PATH_LIMIT / 2, ' ')),
            layer('secondary', 'M'.padEnd(MARK_PATH_LIMIT / 2, ' ')),
          ],
        },
      },
    ],
  ])('accepts %s', (_, kit) => {
    expect(brandKitSchema.safeParse(kit).success).toBe(true);
  });

  it.each([
    [
      'a layer with a colour',
      { logo: { box: BOX, layers: [{ ...layer('primary'), fill: '#f00' }] } },
    ],
    ['a tone outside the list', { logo: { box: BOX, layers: [layer('accent')] } }],
    ['a toned mark with no layers', { logo: { box: BOX, layers: [] } }],
    [
      'more layers than the limit',
      {
        logo: {
          box: BOX,
          layers: Array.from({ length: MARK_LAYER_LIMIT + 1 }, () => layer('primary')),
        },
      },
    ],
    [
      'layers whose paths together pass the limit, each under it',
      {
        wordmark: {
          box: BOX,
          layers: [
            layer('primary', 'M'.padEnd(MARK_PATH_LIMIT / 2 + 1, ' ')),
            layer('secondary', 'M'.padEnd(MARK_PATH_LIMIT / 2, ' ')),
          ],
        },
      },
    ],
    ['a mark with both a path and layers', { logo: { ...TONED, d: 'M0 0Z', fillRule: 'nonzero' } }],
    [
      'a wordmark with a colour',
      { wordmark: { box: BOX, d: 'M0 0Z', fillRule: 'nonzero', fill: '#000' } },
    ],
    ['an accent that is not hex', { colors: { accent: 'purple' } }],
    ['a colour nobody declared', { colors: { accent: '#5900a6', ink: '#000000' } }],
  ])('refuses %s', (_, kit) => {
    expect(brandKitSchema.safeParse(kit).success).toBe(false);
  });

  describe('a pattern (ADR 0228)', () => {
    const TILE = { w: 10, h: 10 };
    const LINE = { tone: 'primary', d: 'M0 0L10 10', stroke: 1 };
    const DOT = { tone: 'secondary', d: 'M4 4H6V6H4Z', fillRule: 'nonzero' };

    it.each([
      ['a stroked line and a filled dot', { tile: TILE, layers: [LINE, DOT] }],
      ['a stroke as wide as the tile', { tile: TILE, layers: [{ ...LINE, stroke: 10 }] }],
    ])('accepts %s', (_, pattern) => {
      expect(brandKitSchema.safeParse({ pattern }).success).toBe(true);
    });

    it.each([
      ['a layer with a colour', { tile: TILE, layers: [{ ...DOT, fill: '#f00' }] }],
      [
        'a layer both stroked and filled',
        { tile: TILE, layers: [{ ...LINE, fillRule: 'nonzero' }] },
      ],
      ['a stroke wider than the tile', { tile: TILE, layers: [{ ...LINE, stroke: 11 }] }],
      ['a stroke of no width', { tile: TILE, layers: [{ ...LINE, stroke: 0 }] }],
      ['a tone outside the list', { tile: TILE, layers: [{ ...DOT, tone: 'accent' }] }],
      ['no layers', { tile: TILE, layers: [] }],
      [
        'more layers than the limit',
        { tile: TILE, layers: Array.from({ length: MARK_LAYER_LIMIT + 1 }, () => DOT) },
      ],
      [
        'layers whose paths together pass the limit',
        {
          tile: TILE,
          layers: [
            { ...DOT, d: 'M'.padEnd(MARK_PATH_LIMIT / 2 + 1, ' ') },
            { ...DOT, d: 'M'.padEnd(MARK_PATH_LIMIT / 2, ' ') },
          ],
        },
      ],
      ['an opacity, which the template decides', { tile: TILE, layers: [DOT], opacity: 0.1 }],
      ['a tile of no width', { tile: { w: 0, h: 10 }, layers: [DOT] }],
    ])('refuses %s', (_, pattern) => {
      expect(brandKitSchema.safeParse({ pattern }).success).toBe(false);
    });
  });

  it('takes the brand’s accent, and colours with nothing in them (ADR 0155)', () => {
    expect(brandKitSchema.safeParse({ colors: { accent: '#5900a6' } }).success).toBe(true);
    expect(brandKitSchema.safeParse({ colors: {} }).success).toBe(true);
  });
});
