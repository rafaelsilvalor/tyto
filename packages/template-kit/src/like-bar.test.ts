import { rect, solid, vector } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { type Block, at, block } from './blocks.js';
import { type Button, type ButtonStyle, buttonRow } from './button-row.js';
import { type Icon, icon as kitIcon } from './icons.js';

import type { GroupDraft, NodeDraft } from '@tyto/core/template';

/*
 * A like bar is a `buttonRow` (TYTO-888): one button is the pill, and its words are a row of
 * icon-only buttons (TYTO-884), each a block as wide as the step to the next icon holding its
 * icon at the reference's offset — as informativo draws its back cover's icons. No layout code
 * of its own; this file is the example a template copies, checked against the bar it replaces.
 *
 * The oracle: questao-estrategica's `likeBar` and its four paths on its origin/main (38ae3a5,
 * src/template.ts :1565–:1600), code copied verbatim; `ink` stands in for its colours. The
 * kit's `icon` is imported as `kitIcon`, since the oracle names its own helper `icon`.
 */

type Ink = (name: string) => string;

function likeBar(ink: Ink): NodeDraft[] {
  const icon = (name: string, x: number, d: string, filled: boolean, w: number): NodeDraft =>
    vector({
      name,
      geometry: { kind: 'path', d, fillRule: 'nonzero' },
      size: { w, h: 35 },
      ...(filled
        ? { fill: solid(ink('bar-ink')) }
        : {
            // An outline: without a fill the exporter paints the inside black.
            fill: solid(ink('bar-fill')),
            stroke: { paint: solid(ink('bar-ink')), width: 3, align: 'center' },
          }),
      transform: { x, y: 919 },
    });
  return [
    rect({
      name: 'barra',
      size: { w: 546, h: 95 },
      radius: 47.5,
      fill: solid(ink('bar-fill')),
      transform: { x: 269, y: 886 },
    }),
    icon('curtir', 342, HEART, true, 40),
    icon('comentar', 469, BUBBLE, false, 39),
    icon('enviar', 596, PLANE, false, 35),
    icon('salvar', 718, BOOKMARK, false, 24),
  ];
}

const HEART =
  'M20 34C20 34 1 22.5 1 11C1 5 5.5 1 11 1C15 1 18.5 3.5 20 7C21.5 3.5 25 1 29 1C34.5 1 39 5 39 11C39 22.5 20 34 20 34Z';
const BUBBLE =
  'M19.5 2C29.5 2 37 8.5 37 16.5C37 24.5 29.5 31 19.5 31C17 31 14.5 30.6 12.3 29.8L5 33L7 26.5C3.9 23.9 2 20.4 2 16.5C2 8.5 9.5 2 19.5 2Z';
const PLANE = 'M33 2L2 14L15 19L20 33L33 2Z M15 19L33 2';
const BOOKMARK = 'M2 2H22V33L12 24L2 33Z';

const INKS: Record<string, string> = { 'bar-fill': '#eeeeee', 'bar-ink': '#1a2b3c' };
const ink: Ink = (name) => INKS[name]!;

/* ------------------------------------------------------------------ the example -- */

/** The template's icons, as data: its own paths, at 1:1 in a box 35 tall. */
const ICONS: readonly { name: string; shape: Icon; step: number }[] = [
  {
    name: 'curtir',
    shape: { box: { w: 40, h: 35 }, d: HEART, paint: { kind: 'fill' } },
    step: 127,
  },
  {
    name: 'comentar',
    shape: { box: { w: 39, h: 35 }, d: BUBBLE, paint: { kind: 'stroke', width: 3 } },
    step: 127,
  },
  {
    name: 'enviar',
    shape: { box: { w: 35, h: 35 }, d: PLANE, paint: { kind: 'stroke', width: 3 } },
    step: 122,
  },
  {
    name: 'salvar',
    shape: { box: { w: 24, h: 35 }, d: BOOKMARK, paint: { kind: 'stroke', width: 3 } },
    step: 24,
  },
];

/** The reference's numbers: the pill, its side padding, the icons' row and how far down in it. */
const BAR = { x: 269, y: 886, height: 95, radius: 47.5, side: 73, row: 41, down: 6 } as const;

function kitLikeBar(): Block {
  const iconOnly: ButtonStyle = {
    height: BAR.row,
    radius: 0,
    padding: { left: 0, right: 0 },
    gap: 0,
  };
  const icons: Button[] = ICONS.map(({ name, shape, step }) => ({
    name: `${name}-botao`,
    style: iconOnly,
    leading: block(step, BAR.row, at(0, BAR.down, kitIcon(shape, 35, ink('bar-ink'), name))),
  }));
  const pill: Button = {
    name: 'barra-botao',
    style: {
      height: BAR.height,
      radius: BAR.radius,
      fill: ink('bar-fill'),
      padding: { left: BAR.side, right: BAR.side },
      gap: 0,
    },
    words: buttonRow(icons, { gap: 0, name: 'icones' }),
  };
  return buttonRow([pill], { gap: 0, name: 'barra-curtir' });
}

/** Every drawn node under `node`, each moved by the groups above it: where it lands. */
function leaves(node: NodeDraft, dx = 0, dy = 0): NodeDraft[] {
  const x = node.transform.x + dx;
  const y = node.transform.y + dy;
  if (node.kind === 'group')
    return (node as GroupDraft).children.flatMap((child) => leaves(child, x, y));
  return [{ ...node, transform: { ...node.transform, x, y } }];
}

describe('the like bar, as a buttonRow', () => {
  const drawn = leaves(at(BAR.x, BAR.y, kitLikeBar()));
  const oracle = likeBar(ink);

  it('draws the pill and the four icons where questao-estrategica does', () => {
    expect(drawn.map((node) => [node.kind, node.transform.x, node.transform.y])).toEqual(
      oracle.map((node) => [node.kind, node.transform.x, node.transform.y]),
    );
  });

  it('differs only by the pill’s name and the outlines’ inside, transparent over the pill', () => {
    // The button names its pill `pill`; an outlined kit icon states an empty inside instead of
    // filling it with the pill's own colour, which the pill under it already shows.
    const [pill, ...glyphs] = drawn;
    const [oraclePill, ...oracleGlyphs] = oracle;
    expect({ ...pill, name: 'barra' }).toEqual(oraclePill);
    for (const [index, glyph] of glyphs.entries()) {
      const expected = oracleGlyphs[index]!;
      const outlined = ICONS[index]!.shape.paint.kind === 'stroke';
      expect(outlined ? { ...glyph, fill: (expected as { fill?: unknown }).fill } : glyph).toEqual(
        expected,
      );
      if (outlined)
        expect((glyph as { fill?: unknown }).fill).toEqual(solid({ r: 0, g: 0, b: 0, a: 0 }));
    }
  });

  it('is as wide as the pill, its icons padded 73 px on either side', () => {
    const bar = kitLikeBar();
    expect([bar.width, bar.height]).toEqual([546, 95]);
  });
});
