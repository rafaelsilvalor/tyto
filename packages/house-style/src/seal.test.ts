import { measureNothing } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { SEAL_HEIGHT, sealOf } from './seal.js';

import type { AssetRef, TemplateContext } from '@tyto/core';

/**
 * When a slide carries the seal (TYTO-201): the last slide of a grid, when the brief has a
 * `selo`. The drawing is the kit's `sealed`, tested there; each template's test checks that
 * its layout makes room.
 */

const SELO: AssetRef = { id: 'selo', source: 'file', path: 'selo.png', hash: 'abc' };

function contextOf(options: {
  readonly format: string;
  readonly index: number;
  readonly count: number;
  readonly selo?: AssetRef;
}): TemplateContext {
  return {
    format: options.format,
    size: { w: 1080, h: 1350 },
    idPrefix: 'x',
    artwork: { id: 'x', index: options.index, count: options.count },
    slots:
      options.selo === undefined
        ? {}
        : {
            selo: { name: 'selo', value: { kind: 'image', asset: options.selo }, adjustments: [] },
          },
    adjustments: {},
    measure: measureNothing,
  } as TemplateContext;
}

describe('sealOf', () => {
  it('seals the last slide of a grid carousel', () => {
    expect(sealOf(contextOf({ format: 'grid', index: 2, count: 3, selo: SELO }))).toEqual({
      asset: SELO,
      height: SEAL_HEIGHT,
    });
  });

  it('seals a one-slide grid, its own last', () => {
    expect(sealOf(contextOf({ format: 'grid', index: 0, count: 1, selo: SELO }))).toBeDefined();
  });

  it('leaves every earlier slide alone', () => {
    for (const index of [0, 1]) {
      expect(sealOf(contextOf({ format: 'grid', index, count: 3, selo: SELO }))).toBeUndefined();
    }
  });

  it('never seals a story, not even the last', () => {
    expect(sealOf(contextOf({ format: 'story', index: 0, count: 1, selo: SELO }))).toBeUndefined();
  });

  it('seals nothing when the brief has no selo', () => {
    expect(sealOf(contextOf({ format: 'grid', index: 0, count: 1 }))).toBeUndefined();
  });
});
