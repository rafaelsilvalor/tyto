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
  ])('refuses %s', (_, kit) => {
    expect(brandKitSchema.safeParse(kit).success).toBe(false);
  });
});
