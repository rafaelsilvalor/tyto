import { describe, expect, it } from 'vitest';

import nestedTransforms from './__fixtures__/valid-nested-transforms.json';
import validPromo from './__fixtures__/valid-promo.json';
import { applyMatrix } from './matrix.js';
import { parseScene } from './scene.js';
import { type SceneVisitor, type VisitContext, walk, walkFrame } from './visitor.js';
import type { Size } from './primitives.js';
import type { Scene } from './scene.js';

function sceneOf(input: unknown): Scene {
  const result = parseScene(input);
  if (!result.ok)
    throw new Error(`fixture should parse: ${result.error.map((d) => d.code).join()}`);
  return result.value;
}

const promo = sceneOf(validPromo);
const nested = sceneOf(nestedTransforms);

/**
 * The first of the two visitors the card asks for: it proves the fold. Every leaf is one
 * node and a group is itself plus whatever its children reported, so nothing here knows
 * how to recurse — `walk()` already did.
 */
const countingVisitor: SceneVisitor<number> = {
  group: (_node, _context, children) => children.reduce((total, count) => total + count, 1),
  rect: () => 1,
  text: () => 1,
  image: () => 1,
  vector: () => 1,
};

/**
 * The second one: an axis-aligned box in frame coordinates. It exists to exercise the
 * part of the context a counting visitor never touches — the accumulated matrix and the
 * inherited visibility — and it is the shape `export-svg` will need for a `viewBox`.
 *
 * Text is measured by its declared box, so a text that left a dimension to its content
 * contributes zero on that axis. Laying text out is E4.5's job, not the walk's.
 */
interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boxBounds(size: Size, context: VisitContext): Bounds | undefined {
  // A hidden node occupies nothing, and `walk` visits it anyway so that this visitor —
  // and not the walk — gets to make that call.
  if (!context.visible) return undefined;

  const corners = [
    { x: 0, y: 0 },
    { x: size.w, y: 0 },
    { x: size.w, y: size.h },
    { x: 0, y: size.h },
  ].map((corner) => applyMatrix(context.transform, corner));

  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
}

function union(parts: readonly (Bounds | undefined)[]): Bounds | undefined {
  const present = parts.filter((part): part is Bounds => part !== undefined);
  if (present.length === 0) return undefined;

  return {
    minX: Math.min(...present.map((part) => part.minX)),
    minY: Math.min(...present.map((part) => part.minY)),
    maxX: Math.max(...present.map((part) => part.maxX)),
    maxY: Math.max(...present.map((part) => part.maxY)),
  };
}

const boundsVisitor: SceneVisitor<Bounds | undefined> = {
  group: (_node, _context, children) => union(children),
  rect: (node, context) => boxBounds(node.size, context),
  image: (node, context) => boxBounds(node.size, context),
  vector: (node, context) => boxBounds(node.size, context),
  text: (node, context) => boxBounds({ w: node.box.w ?? 0, h: node.box.h ?? 0 }, context),
};

function expectBounds(actual: Bounds | undefined, expected: Bounds): void {
  expect(actual).toBeDefined();
  for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(actual?.[key], key).toBeCloseTo(expected[key], 6);
  }
}

/** What a visitor saw, flattened, for the assertions about the context itself. */
interface Seen {
  readonly id: string;
  readonly format: string;
  readonly opacity: number;
  readonly visible: boolean;
  readonly ancestors: readonly string[];
}

function seenAt(id: string, context: VisitContext): Seen {
  return {
    id,
    format: context.format,
    opacity: context.opacity,
    visible: context.visible,
    ancestors: context.ancestors.map((ancestor) => ancestor.id),
  };
}

const recordingVisitor: SceneVisitor<readonly Seen[]> = {
  group: (node, context, children) => [seenAt(node.id, context), ...children.flat()],
  rect: (node, context) => [seenAt(node.id, context)],
  text: (node, context) => [seenAt(node.id, context)],
  image: (node, context) => [seenAt(node.id, context)],
  vector: (node, context) => [seenAt(node.id, context)],
};

function seenIn(scene: Scene): readonly Seen[] {
  return walk(scene, recordingVisitor).flatMap((visit) => visit.children.flat());
}

describe('the counting visitor', () => {
  it('folds each frame into the number of nodes it holds', () => {
    const visits = walk(promo, countingVisitor);
    const totals = visits.map((visit) => visit.children.reduce((sum, count) => sum + count, 0));

    // feed: image + group + its text + rect + vector; story: one rect.
    expect(totals).toEqual([5, 1]);
  });

  it('gives a group the results of its own children and nothing else', () => {
    const [feed] = walk(promo, countingVisitor);

    // hero-image, the `copy` group counting itself and its one text, badge, badge-mask.
    expect(feed?.children).toEqual([1, 2, 1, 1]);
  });

  it('reports the frame and artwork each result belongs to', () => {
    const visits = walk(promo, countingVisitor);

    expect(visits.map((visit) => visit.artwork.id)).toEqual(['slide-1', 'slide-1']);
    expect(visits.map((visit) => visit.frame.format)).toEqual(['feed', 'story']);
  });

  it('walks one frame on its own for an exporter that already picked it', () => {
    const artwork = promo.artworks[0];
    const story = artwork?.frames[1];
    if (!artwork || !story) throw new Error('fixture should have two frames');

    expect(walkFrame(promo, artwork, story, countingVisitor)).toEqual([1]);
  });
});

describe('the bounding-box visitor', () => {
  it('accumulates the transforms of every ancestor', () => {
    // The group translates by (100, 50) and the rect by another (10, 20), so the 60×40
    // box lands at (110, 70) — a visitor reading only its own transform would say (10, 20).
    expectBounds(collectBounds(nested).get('inner'), {
      minX: 110,
      minY: 70,
      maxX: 170,
      maxY: 110,
    });
  });

  it('measures a rotated node by its rotated corners, not by its declared size', () => {
    // A 100×20 rect turned a quarter turn about its centre is 20 wide and 100 tall.
    expectBounds(collectBounds(nested).get('spun'), {
      minX: 340,
      minY: 110,
      maxX: 360,
      maxY: 210,
    });
  });

  it('folds a group into the union of its children', () => {
    const [feed] = walk(nested, boundsVisitor);

    expectBounds(feed?.children[0], { minX: 110, minY: 70, maxX: 360, maxY: 210 });
  });

  it('lets the visitor drop a hidden node, because the walk will not', () => {
    const all = collectBounds(nested);

    expect(all.get('hidden-one')).toBeUndefined();
    // Had the walk skipped it, the visitor would never have been asked in the first place.
    expect(seenIn(nested).map((seen) => seen.id)).toContain('hidden-one');
  });
});

/** Per-node bounds, keyed by id — the bounds visitor rerun so every node is addressable. */
function collectBounds(scene: Scene): Map<string, Bounds | undefined> {
  const found = new Map<string, Bounds | undefined>();
  const recorder: SceneVisitor<Bounds | undefined> = {
    group: (node, context, children) =>
      remember(node.id, boundsVisitor.group(node, context, children)),
    rect: (node, context) => remember(node.id, boundsVisitor.rect(node, context)),
    text: (node, context) => remember(node.id, boundsVisitor.text(node, context)),
    image: (node, context) => remember(node.id, boundsVisitor.image(node, context)),
    vector: (node, context) => remember(node.id, boundsVisitor.vector(node, context)),
  };
  function remember(id: string, bounds: Bounds | undefined): Bounds | undefined {
    found.set(id, bounds);
    return bounds;
  }
  walk(scene, recorder);
  return found;
}

describe('the context a walk hands down', () => {
  it('multiplies opacity along the ancestor chain', () => {
    const byId = new Map(seenIn(nested).map((seen) => [seen.id, seen]));

    expect(byId.get('outer')?.opacity).toBe(0.5);
    expect(byId.get('inner')?.opacity).toBe(0.25);
  });

  it('names every ancestor, outermost first, without the node itself', () => {
    const byId = new Map(seenIn(promo).map((seen) => [seen.id, seen]));

    expect(byId.get('copy')?.ancestors).toEqual([]);
    expect(byId.get('headline')?.ancestors).toEqual(['copy']);
  });

  it('carries the format, so a visitor does not have to reach for the frame', () => {
    expect(seenIn(promo).map((seen) => seen.format)).toEqual([
      'feed',
      'feed',
      'feed',
      'feed',
      'feed',
      'story',
    ]);
  });

  it('turns visibility off for the descendants of a hidden node and not only for it', () => {
    const scene = sceneOf({
      version: 1,
      artworks: [
        {
          id: 'a',
          frames: [
            {
              format: 'feed',
              size: { w: 10, h: 10 },
              children: [
                {
                  kind: 'group',
                  id: 'hidden-group',
                  visible: false,
                  children: [
                    { kind: 'rect', id: 'child', size: { w: 1, h: 1 }, radius: [0, 0, 0, 0] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const byId = new Map(seenIn(scene).map((seen) => [seen.id, seen]));
    expect(byId.get('hidden-group')?.visible).toBe(false);
    expect(byId.get('child')?.visible).toBe(false);
  });
});
