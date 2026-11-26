import { rect, solid, vector } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { at } from './blocks.js';
import {
  ARROW_ICON,
  BALLOON_ICON,
  BOOKMARK_ICON,
  HEART_ICON,
  ICON_IN_DISC_PARAMETERS,
  type Icon,
  PAPER_PLANE_ICON,
  icon,
  iconInDisc,
} from './icons.js';
import { parameterValues } from './parameters.js';

import type { GroupDraft, NodeDraft, VectorDraft } from '@tyto/core/template';

/*
 * The oracle: informativo's `heart` on its origin/main (193cee7, src/template.ts :953), code
 * copied verbatim; `BACK.heart` is { x: 444, d: 192 } there, and `ink` stands in for its colours.
 */

const BACK = { heart: { x: 444, d: 192 } } as const;
type Ink = (name: string) => string;

function heart(ink: Ink, y: number): readonly NodeDraft[] {
  const { x, d } = BACK.heart;
  const shape =
    'M96 150C96 150 42 112 42 78C42 58 57 46 73 46C84 46 92 52 96 60C100 52 108 46 119 46' +
    'C135 46 150 58 150 78C150 112 96 150 96 150Z';
  return [
    rect({
      name: 'coracao-fundo',
      size: { w: d, h: d },
      radius: d / 2,
      fill: solid(ink('accent')),
      transform: { x, y },
    }),
    vector({
      name: 'coracao',
      geometry: { kind: 'path', d: shape, fillRule: 'nonzero' },
      size: { w: d, h: d },
      fill: solid(ink('card')),
      transform: { x, y },
    }),
  ];
}

const INKS: Record<string, string> = { accent: '#1a2b3c', card: '#ffffff' };
const ink: Ink = (name) => INKS[name]!;

/** informativo's heart as icon data: its path, in the disc's own 192 box. */
const DISC_HEART: Icon = {
  box: { w: 192, h: 192 },
  d:
    'M96 150C96 150 42 112 42 78C42 58 57 46 73 46C84 46 92 52 96 60C100 52 108 46 119 46' +
    'C135 46 150 58 150 78C150 112 96 150 96 150Z',
  paint: { kind: 'fill' },
};

/** A group's children, each moved by the group's own offset: where they land on the slide. */
function placedChildren(draft: NodeDraft): readonly NodeDraft[] {
  const { x, y } = draft.transform;
  return (draft as GroupDraft).children.map((child) => ({
    ...child,
    transform: { ...child.transform, x: child.transform.x + x, y: child.transform.y + y },
  }));
}

describe('the icon in a disc', () => {
  it('draws informativo’s heart exactly, its icon the disc’s size', () => {
    const y = 731;
    const kit = iconInDisc(
      DISC_HEART,
      192,
      { disc: ink('accent'), icon: ink('card') },
      { iconRatio: 1 },
      { discName: 'coracao-fundo', iconName: 'coracao' },
    );
    expect(placedChildren(at(BACK.heart.x, y, kit))).toEqual(heart(ink, y));
  });

  it('centres a smaller icon in the disc', () => {
    const kit = iconInDisc(HEART_ICON, 80, { disc: '#000000', icon: '#ffffff' });
    const [, glyph] = placedChildren(kit.draft);
    // A 24-unit square icon at half of 80: 40 px, 20 px in from each side.
    expect(glyph!.transform).toMatchObject({ x: 20, y: 20, scaleX: 40 / 24, scaleY: 40 / 24 });
    expect([kit.width, kit.height]).toEqual([80, 80]);
  });

  it('takes half the diameter by default', () => {
    expect(parameterValues(ICON_IN_DISC_PARAMETERS)).toEqual({ iconRatio: 0.5 });
  });
});

describe('the fill rule', () => {
  /** A ring: a circle with a smaller one inside, which only even-odd leaves empty. */
  const RING: Icon = {
    box: { w: 24, h: 24 },
    d: 'M2 12A10 10 0 1 1 22 12A10 10 0 1 1 2 12ZM7 12A5 5 0 1 1 17 12A5 5 0 1 1 7 12Z',
    paint: { kind: 'fill' },
    fillRule: 'evenodd',
  };

  it('fills an icon that says even-odd with even-odd', () => {
    const drawn = icon(RING, 24, '#000000', 'ring').draft as VectorDraft;
    expect(drawn.geometry).toEqual({ kind: 'path', d: RING.d, fillRule: 'evenodd' });
  });

  it('fills every icon that says nothing with nonzero, as before', () => {
    for (const shape of [HEART_ICON, BALLOON_ICON, PAPER_PLANE_ICON, ARROW_ICON, BOOKMARK_ICON]) {
      const drawn = icon(shape, 24, '#000000', 'icon').draft as VectorDraft;
      expect(drawn.geometry).toMatchObject({ fillRule: 'nonzero' });
    }
  });

  it('outlines the bookmark like its siblings, on the 24-unit box', () => {
    expect(BOOKMARK_ICON.box).toEqual(HEART_ICON.box);
    expect(BOOKMARK_ICON.paint).toEqual(HEART_ICON.paint);
  });
});
