import { image, rect, solid, vector } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { at as placeAt } from './blocks.js';
import { imageHeight } from './image.js';
import { parameterValues } from './parameters.js';
import {
  BARE_PICTURE_PARAMETERS,
  FRAMED_PICTURE_PARAMETERS,
  barePicture,
  frameOutlinePath,
  framedPicture,
} from './picture.js';

import type { AssetRef } from '@tyto/core';
import type { GroupDraft, ImageDraft, NodeDraft, RectDraft } from '@tyto/core/template';

/*
 * The oracle: questao-estrategica's frame on its origin/main (38ae3a5, src/template.ts :1114,
 * :1216, :1265, :1283, :1308), its code copied verbatim and most comments left out. Only what
 * it reads from the template around it is stood in for: `Picture`, `Ink` and `Look`, with
 * neutral colours. The kit's `at` is imported as `placeAt`, since the oracle names its own
 * parameter `at`.
 */

interface Picture {
  readonly asset: AssetRef;
  readonly written: number;
  readonly bare: boolean;
}
type Ink = (name: string) => string;
interface Look {
  readonly frameInk: string;
  readonly frameFill: string;
}

const FRAME = {
  w: 835,
  /** The border on the top, the right and the foot. */
  border: 4,
  /** The bar down the left side, border included. */
  side: 29,
  /** The radius of the white area's two left corners, where it meets the bar. */
  radius: 32,
} as const;

const FRAME_SHAPES = { widest: 3, tallest: 1 } as const;

function framedImage(
  picture: Picture,
  at: { readonly x: number; readonly y: number },
  ink: Ink,
  look: Look,
): { readonly nodes: NodeDraft[]; readonly foot: number } {
  const width = FRAME.w - FRAME.side - FRAME.border;
  const natural = imageHeight(picture.asset, width, width / picture.written);
  const clamped = Math.min(
    width / FRAME_SHAPES.tallest,
    Math.max(width / FRAME_SHAPES.widest, natural),
  );
  const size = { w: width, h: Math.round(clamped) };
  const fit = clamped === natural ? 'cover' : 'contain';
  const height = size.h + 2 * FRAME.border;
  const inside = { x: at.x + FRAME.side, y: at.y + FRAME.border };
  return {
    nodes: [
      rect({
        name: 'moldura',
        size: { w: FRAME.w, h: height },
        fill: solid(ink(look.frameInk)),
        effects: [SHADOW],
        transform: { x: at.x, y: at.y },
      }),
      rect({ name: 'fundo-imagem', size, fill: solid(ink(look.frameFill)), transform: inside }),
      image({ name: 'imagem', asset: picture.asset, size, fit, transform: inside }),
      vector({
        name: 'contorno',
        geometry: { kind: 'path', d: frameOutline({ w: FRAME.w, h: height }), fillRule: 'evenodd' },
        size: { w: FRAME.w, h: height },
        fill: solid(ink(look.frameInk)),
        transform: { x: at.x, y: at.y },
      }),
    ],
    foot: at.y + height,
  };
}

function frameOutline(size: { readonly w: number; readonly h: number }): string {
  const r = FRAME.radius;
  const left = FRAME.side;
  const right = size.w - FRAME.border;
  const top = FRAME.border;
  const foot = size.h - FRAME.border;
  return [
    `M0 0H${size.w}V${size.h}H0Z`,
    `M${left + r} ${top}H${right}V${foot}H${left + r}`,
    `A${r} ${r} 0 0 1 ${left} ${foot - r}V${top + r}A${r} ${r} 0 0 1 ${left + r} ${top}Z`,
  ].join('');
}

function bareImage(
  picture: Picture,
  at: { readonly x: number; readonly y: number },
  width: number,
): { readonly nodes: NodeDraft[]; readonly foot: number } {
  const natural = imageHeight(picture.asset, width, width / picture.written);
  const clamped = Math.min(
    width / FRAME_SHAPES.tallest,
    Math.max(width / FRAME_SHAPES.widest, natural),
  );
  const size = { w: width, h: Math.round(clamped) };
  const fit = clamped === natural ? 'cover' : 'contain';
  return {
    nodes: [image({ name: 'imagem', asset: picture.asset, size, fit, transform: at })],
    foot: at.y + size.h,
  };
}

const SHADOW = {
  kind: 'shadow',
  x: 17,
  y: 47,
  blur: 12,
  spread: -20,
  color: { r: 0, g: 0, b: 0, a: 0.16 },
} as const;

/* ------------------------------------------------------------------------------ cases -- */

const ink: Ink = (name) => name;
const LOOK: Look = { frameInk: '#1a2b3c', frameFill: '#ffffff' };
const PAINTS = { border: solid('#1a2b3c'), paper: solid('#ffffff'), shadow: SHADOW.color };
const NAMES = { frame: 'moldura', paper: 'fundo-imagem', image: 'imagem', outline: 'contorno' };
const UNBOUNDED = { width: FRAME.w, height: Infinity };

function asset(size?: { w: number; h: number }): AssetRef {
  return {
    id: 'foto',
    source: 'file',
    path: './foto.png',
    hash: 'sha256-0',
    ...(size === undefined ? {} : { size }),
  };
}

/** Each kind of picture the frame meets: its file's size, and the shape the slide writes. */
const PICTURES: readonly [string, Picture][] = [
  [
    'a picture the frame takes the shape of',
    { asset: asset({ w: 1600, h: 900 }), written: 2, bare: false },
  ],
  ['a band wider than 3:1', { asset: asset({ w: 4000, h: 1000 }), written: 2, bare: false }],
  ['a picture taller than square', { asset: asset({ w: 500, h: 900 }), written: 2, bare: false }],
  ['an unmeasured picture, 2:1 written', { asset: asset(), written: 2, bare: false }],
  ['an unmeasured picture, 3:1 written', { asset: asset(), written: 3, bare: false }],
  ['an unmeasured picture, 16:9 written', { asset: asset(), written: 16 / 9, bare: false }],
];

/** A block's nodes where `at` puts them, its group's offset added to each child. */
function placed(draft: NodeDraft): NodeDraft[] {
  if (draft.kind !== 'group') return [draft];
  const { x, y } = draft.transform;
  return (draft as GroupDraft).children.map((child) => ({
    ...child,
    transform: { ...child.transform, x: child.transform.x + x, y: child.transform.y + y },
  }));
}

describe('the framed picture', () => {
  it.each(PICTURES)('draws questao-estrategica’s frame exactly for %s', (_, picture) => {
    const kit = framedPicture(
      picture.asset,
      UNBOUNDED,
      PAINTS,
      { fallback: picture.written },
      {
        names: NAMES,
      },
    );
    const oracle = framedImage(picture, { x: 0, y: 0 }, ink, LOOK);
    expect(placed(kit.draft)).toEqual(oracle.nodes);
    expect(kit.height).toBe(oracle.foot);
    expect(kit.width).toBe(FRAME.w);
  });

  it('is the same nodes where the template places it, on whole pixels', () => {
    const [, picture] = PICTURES[0]!;
    const kit = framedPicture(picture.asset, UNBOUNDED, PAINTS, {}, { names: NAMES });
    expect(placed(placeAt(90, 412, kit))).toEqual(
      framedImage(picture, { x: 90, y: 412 }, ink, LOOK).nodes,
    );
  });

  it('draws questao-estrategica’s outline path exactly, at every height', () => {
    for (const h of [275, 459, 810]) {
      expect(frameOutlinePath({ w: FRAME.w, h }, FRAME)).toBe(frameOutline({ w: FRAME.w, h }));
    }
  });

  it('takes questao-estrategica’s numbers as its defaults', () => {
    expect(parameterValues(FRAMED_PICTURE_PARAMETERS)).toEqual({
      widest: FRAME_SHAPES.widest,
      tallest: FRAME_SHAPES.tallest,
      fallback: 2,
      fit: 'auto',
      border: FRAME.border,
      side: FRAME.side,
      radius: FRAME.radius,
      shadowX: SHADOW.x,
      shadowY: SHADOW.y,
      shadowBlur: SHADOW.blur,
      shadowSpread: SHADOW.spread,
    });
  });

  it('casts no shadow when the caller gives it no colour, and names its nodes in English', () => {
    const plain = { border: PAINTS.border, paper: PAINTS.paper };
    const nodes = placed(framedPicture(asset({ w: 1600, h: 900 }), UNBOUNDED, plain).draft);
    expect(nodes.map((node) => node.name)).toEqual(['frame', 'paper', 'image', 'outline']);
    expect(nodes[0]!.effects).toEqual([]);
  });

  it('holds the frame to a finite area’s height, fitting the picture whole', () => {
    const photo = asset({ w: 1600, h: 900 });
    const kit = framedPicture(photo, { width: FRAME.w, height: 300 }, PAINTS);
    const [frame, , picture] = placed(kit.draft) as [RectDraft, RectDraft, ImageDraft];
    expect(kit.height).toBe(300);
    expect(frame.size).toEqual({ w: FRAME.w, h: 300 });
    expect(picture.size).toEqual({ w: 802, h: 292 });
    expect(picture.fit).toBe('contain');
  });

  it('lets the widest shape win over an area too short for it', () => {
    const kit = framedPicture(asset({ w: 1600, h: 900 }), { width: FRAME.w, height: 200 }, PAINTS);
    // 802 / 3 = 267.33, rounded: the frame overflows the area rather than take a 4:1 shape.
    expect(kit.height).toBe(267 + 2 * FRAME.border);
  });

  it('fits as told when the caller sets `fit`', () => {
    const kit = framedPicture(asset({ w: 1600, h: 900 }), UNBOUNDED, PAINTS, { fit: 'contain' });
    expect((placed(kit.draft)[2] as ImageDraft).fit).toBe('contain');
  });
});

describe('the bare picture', () => {
  it.each(PICTURES)(
    'draws questao-estrategica’s `sem-quadro` picture exactly for %s',
    (_, picture) => {
      const kit = barePicture(
        picture.asset,
        { width: 810, height: Infinity },
        {
          fallback: picture.written,
        },
        { name: 'imagem' },
      );
      const oracle = bareImage(picture, { x: 0, y: 0 }, 810);
      expect([kit.draft]).toEqual(oracle.nodes);
      expect(kit.height).toBe(oracle.foot);
      expect(placed(placeAt(135, 640, kit))).toEqual(
        bareImage(picture, { x: 135, y: 640 }, 810).nodes,
      );
    },
  );

  it('holds the picture to a finite area’s height', () => {
    const kit = barePicture(asset({ w: 1600, h: 900 }), { width: 810, height: 400 });
    expect(kit.height).toBe(400);
    expect((kit.draft as ImageDraft).fit).toBe('contain');
    expect(kit.draft.name).toBe('image');
  });

  it('takes the same shape limits as the frame', () => {
    expect(parameterValues(BARE_PICTURE_PARAMETERS)).toEqual({
      widest: 3,
      tallest: 1,
      fallback: 2,
      fit: 'auto',
    });
  });
});
