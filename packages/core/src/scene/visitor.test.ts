import { describe, expect, it } from 'vitest';

import nestedTransforms from './__fixtures__/valid-nested-transforms.json';
import validPromo from './__fixtures__/valid-promo.json';
import { parseScene } from './scene.js';
import { type SceneVisitor, type VisitContext, walk, walkFrame } from './visitor.js';
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
 * The smallest visitor there is, and it proves the fold. Every leaf is one node and a
 * group is itself plus whatever its children reported, so nothing here knows how to
 * recurse — `walk()` already did. The other visitor this contract has to hold up for
 * ships in `bounds.ts` and is tested there.
 */
const countingVisitor: SceneVisitor<number> = {
  group: (_node, _context, children) => children.reduce((total, count) => total + count, 1),
  rect: () => 1,
  text: () => 1,
  image: () => 1,
  vector: () => 1,
};

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
