import { describe, expect, it } from 'vitest';

import { frame, group, image, rect, text, vector } from './nodes.js';
import { color, font, linearGradient, run, solid, stop } from './values.js';
import { identityTransform } from '../scene/primitives.js';
import { parseScene } from '../scene/scene.js';
import type { AssetRef } from '../scene/primitives.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { Frame } from '../scene/scene.js';

const inter = font('Inter');
const hero: AssetRef = { id: 'hero', source: 'file', path: 'hero.jpg', hash: 'sha256-1f0a' };

/** A frame with one of every node kind, which is what the schema has to accept. */
function everyKind(idPrefix?: string): Frame {
  return frame({
    format: 'feed',
    size: { w: 1080, h: 1080 },
    background: solid('#0c0e14'),
    ...(idPrefix !== undefined ? { idPrefix } : {}),
    children: [
      image({ asset: hero, size: { w: 1080, h: 620 }, fit: 'cover' }),
      group({
        id: 'copy',
        transform: { y: 660 },
        children: [
          text({
            box: { w: 920 },
            lineHeight: 1.1,
            overflow: 'shrink',
            runs: [run('Turma nova', { font: inter, size: 96, weight: 700, color: '#ffffff' })],
          }),
        ],
      }),
      rect({
        id: 'badge',
        size: { w: 240, h: 240 },
        radius: 24,
        fill: linearGradient(45, [stop(0, '#ff5900'), stop(1, '#ffbd00')]),
        stroke: { paint: solid('#000000'), width: 2, align: 'center' },
        effects: [{ kind: 'shadow', x: 0, y: 8, blur: 24, spread: 0, color: color('#00000059') }],
      }),
      vector({
        visible: false,
        geometry: { kind: 'path', d: 'M0 0 H240 V240 H0 Z', fillRule: 'nonzero' },
        size: { w: 240, h: 240 },
        fill: solid('#ffffff'),
      }),
    ],
  });
}

function sceneOf(frames: readonly Frame[], artworkId = 'slide-1'): unknown {
  return {
    version: 1,
    fonts: [inter],
    assets: [hero],
    artworks: [{ id: artworkId, frames }],
  };
}

const codes = (items: readonly Diagnostic[]): string[] => items.map((item) => item.code);

describe('what the builders produce', () => {
  it('passes the E2.1 schema and its invariants, which is the whole point', () => {
    const result = parseScene(sceneOf([everyKind()]));

    if (!result.ok) throw new Error(`expected ok, got: ${codes(result.error).join(', ')}`);
    expect(result.warnings).toEqual([]);
  });

  it('survives the round trip unchanged: the builders already fill every default', () => {
    // If the schema had to supply a default, the builder left a field out.
    const built = sceneOf([everyKind()]);
    const result = parseScene(built);

    expect(result.ok && result.value).toEqual(built);
  });

  it('fills the transform, opacity, blend, visibility, clip and effects of a bare node', () => {
    const bare = frame({
      format: 'feed',
      size: { w: 10, h: 10 },
      children: [rect({ size: { w: 1, h: 1 } })],
    }).children[0];

    expect(bare).toMatchObject({
      transform: identityTransform,
      opacity: 1,
      blend: 'normal',
      visible: true,
      clip: false,
      effects: [],
    });
  });

  it('keeps the parts of a transform a template did state and fills the rest', () => {
    const moved = frame({
      format: 'feed',
      size: { w: 10, h: 10 },
      children: [rect({ size: { w: 1, h: 1 }, transform: { x: 64, rotation: 15 } })],
    }).children[0];

    expect(moved?.transform).toEqual({ ...identityTransform, x: 64, rotation: 15 });
  });

  it('takes one radius for all four corners, because that is what a template writes', () => {
    const [square, mixed] = frame({
      format: 'feed',
      size: { w: 10, h: 10 },
      children: [
        rect({ size: { w: 1, h: 1 }, radius: 24 }),
        rect({ size: { w: 1, h: 1 }, radius: [8, 0, 0, 8] }),
      ],
    }).children;

    expect(square).toMatchObject({ radius: [24, 24, 24, 24] });
    expect(mixed).toMatchObject({ radius: [8, 0, 0, 8] });
  });

  it('omits an absent optional rather than setting it to undefined', () => {
    // A strictObject rejects `{ fill: undefined }` where it accepts no `fill` at all, so
    // a builder that assigned undefined would fail the schema on every plain rect.
    const plain = frame({
      format: 'feed',
      size: { w: 10, h: 10 },
      children: [rect({ size: { w: 1, h: 1 } })],
    }).children[0];

    expect(plain && 'fill' in plain).toBe(false);
    expect(plain && 'name' in plain).toBe(false);
    expect(plain && 'mask' in plain).toBe(false);
  });

  it('leaves a text box empty when the template gave no dimension', () => {
    const grown = frame({
      format: 'feed',
      size: { w: 10, h: 10 },
      children: [text({ runs: [run('x', { font: inter, size: 12, color: '#000' })] })],
    }).children[0];

    expect(grown).toMatchObject({ box: {}, align: 'left', valign: 'top', overflow: 'clip' });
  });
});

describe('the ids frame() generates', () => {
  it('reads as a path, so an invariant that blames one can be searched for', () => {
    const built = everyKind();

    expect(built.children.map((node) => node.id)).toEqual(['feed.0', 'copy', 'badge', 'feed.3']);
  });

  it('hangs a child off its parent id, not off the parent position', () => {
    const copy = everyKind().children[1];
    if (copy?.kind !== 'group') throw new Error('the second child should be the copy group');

    // `copy.0`, not `feed.1.0`: renaming or reordering a sibling above does not rewrite it.
    expect(copy.children.map((node) => node.id)).toEqual(['copy.0']);
  });

  it('uses the position when the parent id was generated too', () => {
    const built = frame({
      format: 'story',
      size: { w: 10, h: 10 },
      children: [group({ children: [rect({ size: { w: 1, h: 1 } })] })],
    });
    const outer = built.children[0];
    if (outer?.kind !== 'group') throw new Error('the only child should be a group');

    expect(outer.id).toBe('story.0');
    expect(outer.children[0]?.id).toBe('story.0.0');
  });

  it('leaves an explicit id alone', () => {
    const built = frame({
      format: 'feed',
      size: { w: 10, h: 10 },
      children: [rect({ id: 'chosen', size: { w: 1, h: 1 } })],
    });

    expect(built.children[0]?.id).toBe('chosen');
  });

  it('is stable across calls, because it is derived and not counted', () => {
    expect(everyKind().children.map((node) => node.id)).toEqual(
      everyKind().children.map((node) => node.id),
    );
  });
});

describe('the limit of a frame-local id', () => {
  it('collides across artworks of the same format, and parseScene says so', () => {
    // Two artworks, each with a `feed` frame, each generating `feed.0`. A frame cannot
    // know this; the documented fix is for the assembler to pass idPrefix.
    const twoArtworks = {
      version: 1,
      fonts: [inter],
      assets: [hero],
      artworks: [
        { id: 'slide-1', frames: [everyKind()] },
        { id: 'slide-2', frames: [everyKind()] },
      ],
    };

    const result = parseScene(twoArtworks);
    expect(result.ok).toBe(false);
    expect(!result.ok && new Set(codes(result.error))).toEqual(new Set(['E_SCENE_DUPLICATE_ID']));
  });

  it('is fixed by idPrefix, which is what E4.2 will pass', () => {
    const namespaced = {
      version: 1,
      fonts: [inter],
      assets: [hero],
      artworks: [
        { id: 'slide-1', frames: [everyKind('slide-1.feed')] },
        { id: 'slide-2', frames: [everyKind('slide-2.feed')] },
      ],
    };

    // The explicit ids inside `everyKind` still collide, so this asserts only that the
    // generated ones stopped: `badge` and `copy` are the template author's problem.
    const result = parseScene(namespaced);
    const duplicated = result.ok
      ? []
      : result.error.map((item) => item.message).filter((message) => message.includes('feed.0'));

    expect(duplicated).toEqual([]);
  });
});
