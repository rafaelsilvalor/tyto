import type { GroupDraft, NodeDraft } from '@tyto/core/template';
import { rect } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import {
  AREA_PARAMETERS,
  type Area,
  type AreaParameters,
  type Block,
  type FloatAnchor,
  type Leaf,
  area,
  areaIn,
  block,
  parameterValues,
  sized,
} from './index.js';

/**
 * What these tests hold (TYTO-912, ADR 0232): where each child of an area lands and how large
 * the area says it is, for each size mode, nesting, floating, collapsing, ordering and overflow.
 * Nothing renders: an area is arithmetic over drafts, as `blocks.test.ts` says of a stack.
 */

function box(width: number, height: number, name?: string): Block {
  return sized(rect({ size: { w: width, h: height }, ...(name === undefined ? {} : { name }) }));
}

/** A leaf that answers a rectangle exactly as large as the room it is given, or its own size. */
function filler(name: string, natural: { width: number; height: number }): Leaf {
  return (room: Area) =>
    box(
      Number.isFinite(room.width) ? room.width : natural.width,
      Number.isFinite(room.height) ? room.height : natural.height,
      name,
    );
}

/** The rooms a leaf was offered, in the order it was built. */
function recording(rooms: Area[], made: Block): Leaf {
  return (room) => {
    rooms.push(room);
    return made;
  };
}

function childrenOf(draft: NodeDraft): readonly NodeDraft[] {
  expect(draft.kind).toBe('group');
  return (draft as GroupDraft).children;
}

function placed(draft: NodeDraft): readonly { x: number; y: number; w?: number; h?: number }[] {
  return childrenOf(draft).map((child) => ({
    x: child.transform.x,
    y: child.transform.y,
    ...(child.kind === 'rect' ? { w: child.size.w, h: child.size.h } : {}),
  }));
}

function namesOf(draft: NodeDraft): readonly (string | undefined)[] {
  return childrenOf(draft).map((child) => child.name);
}

const ROOM: Area = { width: 400, height: 600 };

describe('size modes', () => {
  it('hug: the area is as large as its content and its padding', () => {
    const laid = areaIn(
      ROOM,
      area({ gap: 10, padding: [5, 6, 7, 8], children: [box(40, 20), box(60, 30)] }),
    );
    expect([laid.width, laid.height]).toEqual([60 + 6 + 8, 20 + 10 + 30 + 5 + 7]);
    expect(placed(laid.draft).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 8, y: 5 },
      { x: 8, y: 5 + 20 + 10 },
    ]);
  });

  it('fixed: a number is the room a child gets along the flow and the area’s own size', () => {
    const rooms: Area[] = [];
    const laid = areaIn(
      ROOM,
      area({
        width: 300,
        height: 200,
        children: [{ item: recording(rooms, box(10, 10)), height: 80 }, box(10, 10)],
      }),
    );
    expect(rooms).toEqual([{ width: 300, height: 80 }]);
    expect([laid.width, laid.height]).toEqual([300, 200]);
    expect(placed(laid.draft)[1]!.y).toBe(80);
  });

  it('fill: the room left is split among the fill children by weight', () => {
    const laid = areaIn(
      ROOM,
      area({
        height: 'fill',
        gap: 20,
        children: [
          box(50, 100),
          { item: filler('one', { width: 50, height: 0 }), height: 'fill' },
          { item: filler('three', { width: 50, height: 0 }), height: { fill: 3 } },
        ],
      }),
    );
    // 600 less 100 and two gaps of 20 leaves 460: a quarter and three quarters.
    expect(placed(laid.draft).map(({ y, h }) => ({ y, h }))).toEqual([
      { y: 0, h: 100 },
      { y: 120, h: 115 },
      { y: 255, h: 345 },
    ]);
    expect(laid.height).toBe(600);
    expect(laid.overflow).toBe(0);
  });

  it('min and max hold a fill child, and the others share what it did not take', () => {
    const laid = areaIn(
      ROOM,
      area({
        height: 'fill',
        children: [
          { item: filler('held', { width: 1, height: 0 }), height: 'fill', max: 100 },
          { item: filler('rest', { width: 1, height: 0 }), height: 'fill' },
          { item: filler('floor', { width: 1, height: 0 }), height: { fill: 0 }, min: 50 },
        ],
      }),
    );
    expect(placed(laid.draft).map(({ h }) => h)).toEqual([100, 450, 50]);
  });

  it('min and max hold a hug child, which is built again at the size it was held to', () => {
    const rooms: Area[] = [];
    const laid = areaIn(
      ROOM,
      area({ children: [{ item: recording(rooms, box(10, 30)), min: 70 }] }),
    );
    expect(rooms).toEqual([
      { width: 400, height: Infinity },
      { width: 400, height: 70 },
    ]);
    expect(laid.height).toBe(70);
  });

  it('a fill child with no definite room to share is measured by its content', () => {
    const laid = areaIn(
      ROOM,
      area({ children: [{ item: filler('hugs', { width: 30, height: 45 }), height: 'fill' }] }),
    );
    expect(laid.height).toBe(45);
    const unbounded = areaIn(
      { width: Infinity, height: Infinity },
      area({
        height: 'fill',
        children: [{ item: filler('hugs', { width: 30, height: 45 }), height: 'fill' }],
      }),
    );
    expect([unbounded.width, unbounded.height]).toEqual([30, 45]);
  });

  it('stretch gives a child with no size of its own the area’s whole cross room', () => {
    const rooms: Area[] = [];
    const badge = { item: box(4, 4, 'badge'), float: { anchor: 'right' as const } };
    const laid = areaIn(
      ROOM,
      area({
        width: 'fill',
        align: 'stretch',
        padding: 10,
        children: [
          recording(rooms, box(10, 10)),
          area({ name: 'stretched', children: [box(20, 20), badge] }),
          area({ name: 'hugging', width: 'hug', children: [box(20, 20), badge] }),
        ],
      }),
    );
    expect(rooms).toEqual([{ width: 380, height: Infinity }]);
    // A float held to the right edge says how wide each nested area came out.
    const [, stretched, hugging] = childrenOf(laid.draft);
    expect(placed(stretched!)[1]!.x).toBe(380 - 4);
    expect(placed(hugging!)[1]!.x).toBe(20 - 4);
  });

  it('a row reads the same modes along its width', () => {
    const laid = areaIn(
      ROOM,
      area({
        flow: 'row',
        width: 'fill',
        gap: 10,
        children: [box(100, 40), { item: (room) => box(room.width, 40, 'rest'), width: 'fill' }],
      }),
    );
    expect(placed(laid.draft).map(({ x, w }) => ({ x, w }))).toEqual([
      { x: 0, w: 100 },
      { x: 110, w: 290 },
    ]);
    expect([laid.width, laid.height]).toEqual([400, 40]);
  });
});

describe('justify and align', () => {
  const children = [box(100, 50), box(50, 50)];
  it.each([
    ['start', [0, 50]],
    ['center', [100, 150]],
    ['end', [200, 250]],
    ['space-between', [0, 250]],
  ] as const)('justify %s places the content along a definite flow', (justify, tops) => {
    const laid = areaIn({ width: 100, height: 300 }, area({ height: 'fill', justify, children }));
    expect(placed(laid.draft).map(({ y }) => y)).toEqual(tops);
  });

  it.each([
    ['start', [0, 0]],
    ['center', [0, 25]],
    ['end', [0, 50]],
  ] as const)('align %s places a narrower child across', (align, lefts) => {
    const laid = areaIn(ROOM, area({ align, children }));
    expect(placed(laid.draft).map(({ x }) => x)).toEqual(lefts);
  });
});

describe('nesting', () => {
  it('lays out three levels, each inside the room its parent gave it', () => {
    const laid = areaIn(
      { width: 300, height: 500 },
      area({
        name: 'page',
        height: 'fill',
        width: 'fill',
        padding: 20,
        gap: 10,
        children: [
          box(260, 60, 'head'),
          area({
            name: 'middle',
            height: 'fill',
            width: 'fill',
            flow: 'row',
            gap: 10,
            children: [
              area({
                name: 'left',
                width: { fill: 1 },
                height: 'fill',
                children: [
                  {
                    item: filler('picture', { width: 0, height: 0 }),
                    height: 'fill',
                    width: 'fill',
                  },
                ],
              }),
              area({ name: 'right', width: 100, children: [box(100, 30, 'note')] }),
            ],
          }),
          box(260, 40, 'foot'),
        ],
      }),
    );
    expect([laid.width, laid.height]).toEqual([300, 500]);
    expect(namesOf(laid.draft)).toEqual(['head', 'middle', 'foot']);
    const middle = childrenOf(laid.draft)[1]!;
    // 500 less padding 40, head 60, foot 40 and two gaps of 10: 340 for the middle.
    expect(middle.transform).toMatchObject({ x: 20, y: 90 });
    expect(namesOf(middle)).toEqual(['left', 'right']);
    const [left, right] = childrenOf(middle);
    expect(right!.transform.x).toBe(260 - 100);
    expect(placed(left!)).toEqual([{ x: 0, y: 0, w: 150, h: 340 }]);
    expect(childrenOf(laid.draft)[2]!.transform.y).toBe(20 + 60 + 10 + 340 + 10);
  });
});

describe('floating children', () => {
  const anchors: readonly [FloatAnchor, number, number][] = [
    ['top-left', 0, 0],
    ['top', 40, 0],
    ['top-right', 80, 0],
    ['left', 0, 70],
    ['center', 40, 70],
    ['right', 80, 70],
    ['bottom-left', 0, 140],
    ['bottom', 40, 140],
    ['bottom-right', 80, 140],
  ];
  it.each(anchors)('%s: held to that point of the box, moved by its offset', (anchor, x, y) => {
    const laid = areaIn(
      ROOM,
      area({
        width: 100,
        height: 160,
        children: [
          box(100, 50, 'flow'),
          { item: box(20, 20, 'badge'), float: { anchor, x: 3, y: -4 } },
        ],
      }),
    );
    expect(namesOf(laid.draft)).toEqual(['flow', 'badge']);
    expect(placed(laid.draft)[1]).toMatchObject({ x: x + 3, y: y - 4 });
  });

  it('takes no room in the flow and is drawn after it, in source order', () => {
    const laid = areaIn(
      ROOM,
      area({
        gap: 10,
        children: [
          { item: box(10, 10, 'first float'), float: { anchor: 'top-left' } },
          box(50, 30, 'a'),
          box(50, 30, 'b'),
          { item: box(10, 10, 'second float'), float: { anchor: 'bottom-right' } },
        ],
      }),
    );
    expect(laid.height).toBe(70);
    expect(namesOf(laid.draft)).toEqual(['a', 'b', 'first float', 'second float']);
  });
});

describe('collapse', () => {
  it('an absent child takes no room and no gap', () => {
    const laid = areaIn(
      ROOM,
      area({
        gap: 10,
        children: [
          box(10, 30, 'a'),
          undefined,
          { item: undefined },
          () => undefined,
          box(10, 30, 'b'),
        ],
      }),
    );
    expect(laid.height).toBe(70);
    expect(namesOf(laid.draft)).toEqual(['a', 'b']);
  });

  it('a nested area with no child in its flow takes no room and no gap', () => {
    const laid = areaIn(
      ROOM,
      area({
        gap: 10,
        children: [
          box(10, 30, 'a'),
          area({
            name: 'empty',
            padding: 20,
            children: [() => undefined, { item: box(5, 5), float: { anchor: 'center' } }],
          }),
          box(10, 30, 'b'),
        ],
      }),
    );
    expect(laid.height).toBe(70);
    expect(namesOf(laid.draft)).toEqual(['a', 'b']);
  });

  it('a fill child that turns out absent leaves its share to the others', () => {
    const laid = areaIn(
      { width: 100, height: 200 },
      area({
        height: 'fill',
        children: [
          { item: () => undefined, height: 'fill' },
          { item: filler('rest', { width: 10, height: 0 }), height: 'fill' },
        ],
      }),
    );
    expect(placed(laid.draft)).toEqual([{ x: 0, y: 0, w: 100, h: 200 }]);
  });

  it('collapse never keeps an empty area with its padding', () => {
    const nested = areaIn(
      ROOM,
      area({ children: [area({ name: 'kept', padding: 15, collapse: 'never', children: [] })] }),
    );
    expect([nested.width, nested.height]).toEqual([30, 30]);
    expect(areaIn(ROOM, area({ children: [] }))).toMatchObject({
      width: 0,
      height: 0,
      overflow: 0,
    });
  });
});

describe('order', () => {
  const children = [
    box(10, 10, 'title'),
    box(10, 10, 'logo'),
    box(10, 10, 'note'),
    box(10, 10, 'foot'),
  ];
  const named = children.map((item) => ({ item, name: (item.draft as { name?: string }).name! }));

  it('keeps the source order with no brief order', () => {
    const laid = areaIn(ROOM, area({ children: named }));
    expect(namesOf(laid.draft)).toEqual(['title', 'logo', 'note', 'foot']);
  });

  it('puts the children the brief names in its order, the others keeping their places', () => {
    const laid = areaIn(
      ROOM,
      area({ order: [{ name: 'note' }, { name: 'title' }], children: named }),
    );
    expect(namesOf(laid.draft)).toEqual(['note', 'logo', 'title', 'foot']);
    expect(placed(laid.draft).map(({ y }) => y)).toEqual([0, 10, 20, 30]);
  });

  it('reads a nested area by its own name', () => {
    const laid = areaIn(
      ROOM,
      area({
        order: [{ name: 'second' }, { name: 'first' }],
        children: [
          area({ name: 'first', children: [box(10, 10)] }),
          area({ name: 'second', children: [box(10, 20)] }),
        ],
      }),
    );
    expect(namesOf(laid.draft)).toEqual(['second', 'first']);
  });
});

describe('overflow', () => {
  it('a hug flow reports how far it runs past a bounded room', () => {
    const laid = areaIn(
      { width: 100, height: 50 },
      area({ gap: 10, children: [box(10, 30), box(10, 30)] }),
    );
    expect([laid.height, laid.overflow]).toEqual([70, 20]);
  });

  it('a fixed area reports how far its content runs past it, and shrinks nothing', () => {
    const laid = areaIn(ROOM, area({ height: 40, padding: [5, 0, 5, 0], children: [box(10, 60)] }));
    expect([laid.height, laid.overflow]).toEqual([40, 30]);
    expect(placed(laid.draft)[0]).toMatchObject({ h: 60 });
  });

  it('an unbounded room has no overflow', () => {
    const laid = areaIn({ width: Infinity, height: Infinity }, area({ children: [box(10, 900)] }));
    expect(laid.overflow).toBe(0);
  });
});

describe('measured from the capitals', () => {
  it('runs a gap from a block’s last baseline to the next one’s first capitals', () => {
    const text = (capTop: number, baseline: number, height: number): Block => ({
      ...block(10, height, rect({ size: { w: 10, h: height } })),
      anchor: { capTop, baseline },
    });
    const laid = areaIn(
      ROOM,
      area({ measureFrom: 'capitals', gap: 20, children: [text(5, 40, 50), text(8, 30, 40)] }),
    );
    expect(placed(laid.draft).map(({ y }) => y)).toEqual([0, 40 + 20 - 8]);
    expect(laid.anchor).toEqual({ capTop: 5, baseline: 52 + 30 });
  });
});

describe('AREA_PARAMETERS', () => {
  it('describes the area by its parameters, which the area turns its options into', () => {
    const described = area({
      width: { fill: 2 },
      height: 120,
      padding: [1, 2, 3, 4],
      children: [],
    });
    const expected: AreaParameters = {
      ...parameterValues(AREA_PARAMETERS, {}),
      widthMode: 'fill',
      widthWeight: 2,
      heightMode: 'fixed',
      height: 120,
      paddingTop: 1,
      paddingRight: 2,
      paddingBottom: 3,
      paddingLeft: 4,
    };
    expect(described.parameters).toEqual(expected);
  });

  it('defaults to a column that hugs, starts, collapses when empty and has no padding', () => {
    expect(parameterValues(AREA_PARAMETERS, {})).toMatchObject({
      flow: 'column',
      gap: 0,
      justify: 'start',
      align: 'start',
      widthMode: 'auto',
      heightMode: 'auto',
      collapse: 'when-empty',
      paddingTop: 0,
    });
  });
});
