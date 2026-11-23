import { frameSchema, noBrandKit } from '@tyto/core';
import { frame, rect, solid } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { drawPattern } from './kit.js';

import type { BrandKit, BrandPattern } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';

/**
 * A kit's background pattern laid over an area (ADR 0228): tiles edge to edge, each tone in the
 * ink the template picks, one opacity for the whole, cut by the template's mask.
 */

// Invented: a 10 × 20 tile, a diagonal stroked and a dot filled.
const PATTERN: BrandPattern = {
  tile: { w: 10, h: 20 },
  layers: [
    { tone: 'primary', d: 'M0 0L10 20', stroke: 1 },
    { tone: 'secondary', d: 'M4 9H6V11H4Z', fillRule: 'evenodd' },
  ],
};
const KIT: BrandKit = { pattern: PATTERN };
const INKS = { primary: '#111111', secondary: '#222222' };

const childrenOf = (draft: NodeDraft): readonly NodeDraft[] =>
  draft.kind === 'group' ? draft.children : [];

describe('drawPattern', () => {
  it('draws nothing for a kit without a pattern, so a render without one keeps its bytes', () => {
    const drawn = drawPattern(noBrandKit, {
      size: { w: 100, h: 100 },
      tileWidth: 20,
      inks: INKS,
      opacity: 0.1,
    });

    expect(drawn).toBeUndefined();
  });

  it('covers the area with whole tiles from its top-left corner', () => {
    // 45 wide at 20 per tile is 3 columns; tiles are 40 high, so 90 is 3 rows.
    const drawn = drawPattern(KIT, {
      size: { w: 45, h: 90 },
      tileWidth: 20,
      inks: INKS,
      opacity: 1,
    });

    const tiles = childrenOf(drawn!.draft);
    expect(tiles).toHaveLength(9);
    expect(tiles.map((tile) => [tile.transform.x, tile.transform.y])).toEqual([
      [0, 0],
      [20, 0],
      [40, 0],
      [0, 40],
      [20, 40],
      [40, 40],
      [0, 80],
      [20, 80],
      [40, 80],
    ]);
    expect([drawn!.width, drawn!.height]).toEqual([45, 90]);
  });

  it('strokes a stroked layer and fills a filled one, each tone in its ink, scaled with its tile', () => {
    const drawn = drawPattern(KIT, {
      size: { w: 20, h: 40 },
      tileWidth: 20,
      inks: INKS,
      opacity: 1,
    });

    const [line, dot] = childrenOf(childrenOf(drawn!.draft)[0]!);
    expect(line).toMatchObject({
      kind: 'vector',
      stroke: { paint: solid('#111111'), width: 1 },
      transform: { scaleX: 2, scaleY: 2 },
    });
    expect(line).not.toHaveProperty('fill');
    expect(dot).toMatchObject({
      kind: 'vector',
      fill: solid('#222222'),
      geometry: { kind: 'path', d: 'M4 9H6V11H4Z', fillRule: 'evenodd' },
    });
    expect(dot).not.toHaveProperty('stroke');
  });

  it('puts the opacity and the mask on the whole pattern, once', () => {
    const mask = { nodeId: 'panel', mode: 'alpha' as const };
    const drawn = drawPattern(KIT, {
      size: { w: 20, h: 40 },
      tileWidth: 20,
      inks: INKS,
      opacity: 0.08,
      mask,
    });

    expect(drawn!.draft).toMatchObject({ kind: 'group', opacity: 0.08, mask });
    for (const tile of childrenOf(drawn!.draft)) expect(tile.opacity).toBe(1);
  });

  it('makes a frame the scene schema accepts, masked by a node of that frame', () => {
    const drawn = drawPattern(KIT, {
      size: { w: 30, h: 50 },
      tileWidth: 10,
      inks: INKS,
      opacity: 0.08,
      mask: { nodeId: 'panel', mode: 'alpha' },
    });

    const built = frame({
      format: 'test',
      size: { w: 30, h: 50 },
      children: [
        rect({ id: 'panel', size: { w: 30, h: 50 }, fill: solid('#ffffff') }),
        drawn!.draft,
      ],
    });

    expect(frameSchema.safeParse(built).success).toBe(true);
  });
});
