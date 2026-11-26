import { rect, solid, vector } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { block, row } from './blocks.js';
import {
  ARROW_SHAPE_PARAMETERS,
  CAPSULE_PATH_PARAMETERS,
  arrowPath,
  arrowShape,
  capsulePath,
  circlePath,
  cornerBracket,
  cornerBracketPath,
  plus,
  roundedRectPath,
  rule,
  shape,
} from './shapes.js';
import { parameterValues } from './parameters.js';

import type { NodeDraft } from '@tyto/core/template';

/**
 * Shapes and the arrow (TYTO-886), checked against the code they replace.
 *
 * Each oracle below is a template repository's function as it is on origin/main (2026-11-26),
 * verbatim but for its name and its placement in the slide, which a block leaves to whoever
 * places it. A piece's path must be the oracle's, character for character; a piece's node must
 * be the oracle's node with the slide position taken off.
 */

const INK = solid('#123456');

/** The kit's tests run without Node's types; the one call they make to print a number. */
declare const process: { readonly stdout: { write(text: string): void } };

/* -------------------------------------------------- oracles: the next-slide arrow -- */

interface ArrowBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly shaft: number;
}

/** questao-estrategica, voce-conhece and news-da-semana (`arrow`, identical bodies). */
function questaoArrowPath(box: ArrowBox): string {
  const head = Math.round(box.h * 0.64);
  const top = (box.h - box.shaft) / 2;
  const neck = box.w - head;
  const d = `M0 ${top}H${neck}V0L${box.w} ${box.h / 2}L${neck} ${box.h}V${top + box.shaft}H0Z`;
  return d;
}

/** concursos-abertos (`arrow`): the head 0.62 of the height. */
function concursosArrowPath(box: ArrowBox): string {
  const head = Math.round(box.h * 0.62);
  const top = (box.h - box.shaft) / 2;
  const neck = box.w - head;
  const d = `M0 ${top}H${neck}V0L${box.w} ${box.h / 2}L${neck} ${box.h}` + `V${top + box.shaft}H0Z`;
  return d;
}

/** concursos-abertos-ec (`arrow` over its `ARROW` token). */
const EC_ARROW = { x: 798, y: 1269, w: 186, h: 26, shaft: { top: 9, h: 8 }, head: 15 } as const;
function ecArrowPath(): string {
  const { w, h, shaft, head } = EC_ARROW;
  const neck = w - head;
  return `M0 ${shaft.top}H${neck}V0L${w} ${h / 2}L${neck} ${h}V${shaft.top + shaft.h}H0Z`;
}

/** Every arrow box the templates draw (the slide coordinates do not enter the path). */
const BOXES_064: readonly [string, ArrowBox][] = [
  ['questao footer', { x: 877, y: 1259, w: 151, h: 28, shaft: 7.5 }],
  ['questao cover', { x: 912, y: 1164, w: 76, h: 26, shaft: 7 }],
  ['voce-conhece button', { x: 861, y: 1161, w: 64, h: 34, shaft: 11 }],
  ['voce-conhece body', { x: 857, y: 1256, w: 145, h: 34, shaft: 9 }],
  ['engenharia button', { x: 269, y: 998, w: 57, h: 37, shaft: 10 }],
  ['engenharia body', { x: 853, y: 1259, w: 148, h: 37, shaft: 10 }],
  ['news-da-semana', { x: 894, y: 1258, w: 106, h: 35, shaft: 9 }],
];
const BOXES_062: readonly [string, ArrowBox][] = [
  ['concursos-abertos cover', { x: 729, y: 846, w: 270, h: 34, shaft: 10 }],
  ['concursos-abertos footer', { x: 848, y: 1259, w: 151, h: 25, shaft: 7 }],
];

/** A path's vertices, read from absolute M/H/V/L commands. */
function vertices(d: string): [number, number][] {
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (const [, command, args] of d.matchAll(/([MLHV])([^MLHVZ]*)/gu)) {
    const values = args!
      .trim()
      .split(/[\s,]+/u)
      .map(Number);
    if (command === 'H') x = values[0]!;
    else if (command === 'V') y = values[0]!;
    else [x, y] = [values[0]!, values[1]!];
    points.push([x, y]);
  }
  return points;
}

/** The largest distance between each vertex of `a` and the nearest vertex of `b`. */
function worstVertex(a: [number, number][], b: [number, number][]): number {
  return Math.max(
    ...a.map(([ax, ay]) => Math.min(...b.map(([bx, by]) => Math.hypot(ax - bx, ay - by)))),
  );
}

describe('the arrow', () => {
  it.each(BOXES_064)('draws the %s arrow’s exact path at the 0.64 head', (_, box) => {
    expect(arrowPath(box, box.shaft, 0.64)).toBe(questaoArrowPath(box));
  });

  it.each(BOXES_062)('draws the %s arrow’s exact path at the 0.62 head', (_, box) => {
    expect(arrowPath(box, box.shaft, 0.62)).toBe(concursosArrowPath(box));
  });

  it('draws concursos-abertos-ec’s arrow, its 15 px head a 0.58 ratio rounded', () => {
    expect(arrowPath(EC_ARROW, EC_ARROW.shaft.h, 0.58)).toBe(ecArrowPath());
  });

  it('is a vector of its size in the caller’s paint, the 0.64 head and 9 px shaft by default', () => {
    const drawn = arrowShape({ w: 106, h: 35 }, INK, {}, { name: 'seta' });

    expect(drawn).toMatchObject({ width: 106, height: 35 });
    expect(drawn.draft).toEqual(
      vector({
        name: 'seta',
        geometry: {
          kind: 'path',
          d: questaoArrowPath({ x: 0, y: 0, w: 106, h: 35, shaft: 9 }),
          fillRule: 'nonzero',
        },
        size: { w: 106, h: 35 },
        fill: INK,
      }),
    );
    expect(parameterValues(ARROW_SHAPE_PARAMETERS)).toEqual({ shaft: 9, headRatio: 0.64 });
  });

  it('says how far the off-centre arrows are from the centred one, which is canonical', () => {
    // informativo's ARROW_ON, drawn tip first at the slide's coordinates; its box 644–780.2 by
    // 25.1–50.8, the shaft 34.2–41.6, the head 15.7 long.
    const informativo = vertices('M780.2 37.9L764.5 25.1V34.2H644V41.6H764.5V50.8Z');
    const centred = vertices(arrowPath({ w: 136.2, h: 25.7 }, 7.4, 15.7 / 25.7)).map(
      ([x, y]): [number, number] => [x + 644, y + 25.1],
    );
    // azul's ARROW mark (house-style tokens): its box 2360.92 by 377.81, shaft 108.75, head 230.92.
    const azul = vertices('M2130 377.81V243.63H0V134.88H2130V0L2360.92 189.26L2130 377.81Z');
    const azulCentred = vertices(arrowPath({ w: 2360.92, h: 377.81 }, 108.75, 230.92 / 377.81));
    const informativoWorst = worstVertex(informativo, centred);
    const azulWorst = worstVertex(azul, azulCentred);
    process.stdout.write(
      `ARROW informativo ARROW_ON max vertex difference ${informativoWorst.toFixed(4)} px; azul ARROW ${azulWorst.toFixed(4)} box units\n`,
    );

    // Both differ by the canonical arrow's whole-pixel head (15.7 → 16, 230.92 → 231) and by
    // their off-centre tip and shaft (0.05 px, 0.355 units): measured, not reproduced.
    expect(informativoWorst).toBeCloseTo(0.3041, 4);
    expect(azulWorst).toBeCloseTo(0.359, 3);
  });
});

/* ------------------------------------------------- oracles: shapes and geometry -- */

/** concursos-abertos (`roundedRect`, `circle`, `capsule`, `round`), verbatim. */
function oracleRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}
function oracleCircle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}Z`;
}
const round = (value: number) => Math.round(value * 100) / 100;
function oracleCapsule(cx: number, cy: number, length: number, r: number): string {
  const along = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
  const across = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const point = (a: number, b: number) =>
    `${round(cx + along.x * a + across.x * b)} ${round(cy + along.y * a + across.y * b)}`;
  return (
    `M${point(length, -r)}A${r} ${r} 0 0 1 ${point(length, r)}` +
    `L${point(-length, r)}A${r} ${r} 0 0 1 ${point(-length, -r)}Z`
  );
}

/** engenharia (`ornaments`, over `PLUS = { size: 26, bar: 6 }`), one "+". */
function oraclePlus(size: number, barWidth: number): string {
  const near = (size - barWidth) / 2;
  const far = near + barWidth;
  const s = size;
  return `M${near} 0H${far}V${near}H${s}V${far}H${far}V${s}H${near}V${far}H0V${near}H${near}Z`;
}

describe('the path geometry glyph data is built from', () => {
  it('draws concursos-abertos’ rounded rectangles and circles exactly', () => {
    const rects: [number, number, number, number, number][] = [
      [0, 0, 31, 31, 9],
      [3, 3, 25, 25, 6.5],
      [0, 0, 34, 23, 6],
    ];
    for (const args of rects) {
      expect(roundedRectPath(...args)).toBe(oracleRoundedRect(...args));
    }
    const circles: [number, number, number][] = [
      [15.5, 15.5, 7.5],
      [15.5, 15.5, 4.7],
      [23.8, 7.2, 2],
    ];
    for (const args of circles) {
      expect(circlePath(...args)).toBe(oracleCircle(...args));
    }
  });

  it('draws concursos-abertos’ 45° capsules exactly, rounded to its 0.01', () => {
    const capsules: [number, number, number, number][] = [
      [7.8, 16.2, 3.6, 4.6],
      [7.8, 16.2, 3.6, 2.2],
      [16.2, 7.8, 3.6, 4.6],
      [16.2, 7.8, 3.6, 2.2],
    ];
    for (const args of capsules) {
      expect(capsulePath(...args, { angle: 45 })).toBe(oracleCapsule(...args));
    }
    expect(parameterValues(CAPSULE_PATH_PARAMETERS)).toEqual({ angle: 0, precision: 0.01 });
  });
});

describe('the shapes', () => {
  it('draws engenharia’s "+" exactly', () => {
    expect(plus(26, INK, { bar: 6 }).draft).toEqual(
      vector({
        geometry: { kind: 'path', d: oraclePlus(26, 6), fillRule: 'nonzero' },
        size: { w: 26, h: 26 },
        fill: INK,
      }),
    );
  });

  it('draws news-da-semana’s two corner brackets exactly, and the other two corners', () => {
    expect(cornerBracketPath(14, 4, 'top-left')).toBe('M0 0H14V4H4V14H0Z');
    expect(cornerBracketPath(14, 4, 'bottom-right')).toBe('M10 0H14V14H0V10H10Z');
    expect(cornerBracketPath(14, 4, 'top-right')).toBe('M0 0H14V14H10V4H0Z');
    expect(cornerBracketPath(14, 4, 'bottom-left')).toBe('M0 0H4V10H14V14H0Z');
    expect(cornerBracket(14, INK, { corner: 'bottom-right' }).draft).toMatchObject({
      geometry: { d: 'M10 0H14V14H0V10H10Z' },
      size: { w: 14, h: 14 },
    });
  });

  it('draws news-da-semana’s diagonal rules and concursos-abertos-ec’s divider exactly', () => {
    expect(rule(54, INK, { direction: 'diagonal-down' }, { name: 'diagonal-logo' }).draft).toEqual(
      vector({
        name: 'diagonal-logo',
        geometry: { kind: 'path', d: 'M0 0L54 54', fillRule: 'nonzero' },
        size: { w: 54, h: 54 },
        stroke: { paint: INK, width: 1, align: 'center' },
      }),
    );
    expect(rule(764, INK, {}, { name: 'divisoria' }).draft).toEqual(
      rect({ name: 'divisoria', size: { w: 764, h: 1 }, fill: INK }),
    );
  });

  it('draws anuncio’s dots exactly, as circles in a row', () => {
    const size = 12;
    const oracleDot = () =>
      block(
        size,
        size,
        rect({ name: 'ponto', size: { w: size, h: size }, radius: size / 2, fill: INK }),
      );
    const dot = () => shape({ w: size, h: size }, INK, { kind: 'circle' }, { name: 'ponto' });

    expect(row({ name: 'divisor', items: [dot(), dot(), dot()], gap: 9 })).toEqual(
      row({ name: 'divisor', items: [oracleDot(), oracleDot(), oracleDot()], gap: 9 }),
    );
  });

  it('rounds a capsule at its short ends, and a rectangle not at all', () => {
    const capsule = shape({ w: 80, h: 30 }, INK, { kind: 'capsule' }).draft as NodeDraft & {
      radius?: unknown;
    };
    const plain = shape({ w: 80, h: 30 }, INK).draft as NodeDraft & { radius?: unknown };

    expect(capsule.radius).toEqual([15, 15, 15, 15]);
    expect(plain.radius).toEqual([0, 0, 0, 0]);
  });
});
