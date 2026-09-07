import { describe, expect, it } from 'vitest';

import nestedTransforms from './__fixtures__/valid-nested-transforms.json';
import validPromo from './__fixtures__/valid-promo.json';
import { type Bounds, boundsVisitor, frameBounds, sceneBounds, unionBounds } from './bounds.js';
import { parseScene } from './scene.js';
import { type SceneVisitor, walk } from './visitor.js';
import type { Scene } from './scene.js';

function sceneOf(input: unknown): Scene {
  const result = parseScene(input);
  if (!result.ok)
    throw new Error(`fixture should parse: ${result.error.map((item) => item.code).join()}`);
  return result.value;
}

const promo = sceneOf(validPromo);
const nested = sceneOf(nestedTransforms);

/**
 * A rotation goes through `Math.cos`, so the corners land on 359.999…9 rather than on 360.
 * The IR does not round that away — an exporter formats numbers — so the assertions
 * compare component by component to six decimals.
 */
function expectBounds(actual: Bounds | undefined, expected: Omit<Bounds, 'exact'>): void {
  expect(actual).toBeDefined();
  for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(actual?.[key], key).toBeCloseTo(expected[key], 6);
  }
}

/** Bounds per node id: the shipped visitor wrapped, which is what exporting it is for. */
function boundsById(scene: Scene): Map<string, Bounds | undefined> {
  const found = new Map<string, Bounds | undefined>();
  const remember = (id: string, bounds: Bounds | undefined): Bounds | undefined => {
    found.set(id, bounds);
    return bounds;
  };
  const recorder: SceneVisitor<Bounds | undefined> = {
    group: (node, context, children) =>
      remember(node.id, boundsVisitor.group(node, context, children)),
    rect: (node, context) => remember(node.id, boundsVisitor.rect(node, context)),
    text: (node, context) => remember(node.id, boundsVisitor.text(node, context)),
    image: (node, context) => remember(node.id, boundsVisitor.image(node, context)),
    vector: (node, context) => remember(node.id, boundsVisitor.vector(node, context)),
  };
  walk(scene, recorder);
  return found;
}

describe('a node box under the accumulated transform', () => {
  it('includes every ancestor transform, not only its own', () => {
    // The group translates by (100, 50) and the rect by another (10, 20), so the 60×40
    // box lands at (110, 70) — reading only the node's own transform would say (10, 20).
    expectBounds(boundsById(nested).get('inner'), { minX: 110, minY: 70, maxX: 170, maxY: 110 });
  });

  it('maps all four corners, so a rotated node is measured rotated', () => {
    // A 100×20 rect turned a quarter turn about its centre is 20 wide and 100 tall.
    expectBounds(boundsById(nested).get('spun'), { minX: 340, minY: 110, maxX: 360, maxY: 210 });
  });

  it('treats a hidden node as occupying nothing, and its ancestors as still there', () => {
    const byId = boundsById(nested);

    expect(byId.get('hidden-one')).toBeUndefined();
    // The group holding it is not empty; it just does not stretch down to y 360.
    expectBounds(byId.get('outer'), { minX: 110, minY: 70, maxX: 360, maxY: 210 });
  });

  it('gives a group the union of its children and no box of its own', () => {
    const [feed] = walk(nested, boundsVisitor);

    expectBounds(feed?.children[0], { minX: 110, minY: 70, maxX: 360, maxY: 210 });
  });
});

describe('unionBounds', () => {
  const box = (minX: number, maxX: number, exact = true): Bounds => ({
    minX,
    minY: 0,
    maxX,
    maxY: 10,
    exact,
  });

  it('is undefined when there is nothing to bound', () => {
    expect(unionBounds([])).toBeUndefined();
    expect(unionBounds([undefined, undefined])).toBeUndefined();
  });

  it('ignores the absent parts rather than treating them as the origin', () => {
    expectBounds(unionBounds([undefined, box(5, 8), undefined]), {
      minX: 5,
      minY: 0,
      maxX: 8,
      maxY: 10,
    });
  });

  it('is exact only when every part is', () => {
    expect(unionBounds([box(0, 1), box(2, 3)])?.exact).toBe(true);
    expect(unionBounds([box(0, 1), box(2, 3, false)])?.exact).toBe(false);
  });
});

describe('what `exact` admits to', () => {
  it('is false for a text that left a dimension to its content', () => {
    // `headline` declares box.w 920 and no height at all.
    expect(boundsById(promo).get('headline')?.exact).toBe(false);
  });

  it('travels up: one unmeasured text makes the whole frame inexact', () => {
    const [feed] = sceneBounds(promo);

    expect(feed?.bounds?.exact).toBe(false);
  });

  it('is true for a frame whose nodes all declare their own box', () => {
    const [feed] = sceneBounds(nested);

    expect(feed?.bounds?.exact).toBe(true);
  });

  it('is false for a text that declares a full box but may outgrow it', () => {
    const growing = sceneOf({
      version: 1,
      fonts: [{ family: 'Inter', source: 'bundled' }],
      artworks: [
        {
          id: 'a',
          frames: [
            {
              format: 'feed',
              size: { w: 100, h: 100 },
              children: [
                {
                  kind: 'text',
                  id: 'caption',
                  box: { w: 80, h: 40 },
                  align: 'left',
                  valign: 'top',
                  lineHeight: 1.2,
                  overflow: 'grow',
                  runs: [
                    {
                      kind: 'text',
                      text: 'x',
                      font: { family: 'Inter', source: 'bundled' },
                      size: 12,
                      weight: 400,
                      style: 'normal',
                      color: { kind: 'solid', color: { r: 0, g: 0, b: 0 } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const caption = boundsById(growing).get('caption');
    expectBounds(caption, { minX: 0, minY: 0, maxX: 80, maxY: 40 });
    expect(caption?.exact).toBe(false);
  });
});

describe('frameBounds and sceneBounds', () => {
  it('bound one frame for an exporter that already picked it', () => {
    const artwork = nested.artworks[0];
    const frame = artwork?.frames[0];
    if (!artwork || !frame) throw new Error('fixture should have one frame');

    expectBounds(frameBounds(nested, artwork, frame), {
      minX: 110,
      minY: 70,
      maxX: 360,
      maxY: 210,
    });
  });

  it('bound every frame in document order, keeping the artwork and frame with each', () => {
    const all = sceneBounds(promo);

    expect(all.map((entry) => entry.frame.format)).toEqual(['feed', 'story']);
    expect(all.map((entry) => entry.artwork.id)).toEqual(['slide-1', 'slide-1']);
    // The story frame is one 1080×1920 rect at the origin.
    expectBounds(all[1]?.bounds, { minX: 0, minY: 0, maxX: 1080, maxY: 1920 });
  });

  it('report undefined for a frame that draws nothing', () => {
    const empty = sceneOf({
      version: 1,
      artworks: [{ id: 'a', frames: [{ format: 'feed', size: { w: 10, h: 10 }, children: [] }] }],
    });

    expect(sceneBounds(empty)[0]?.bounds).toBeUndefined();
  });
});
