import { rect, vector } from '@tyto/core/template';

import { type Block, sized } from './blocks.js';
import { type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

import type { Paint } from '@tyto/core';

/**
 * Shapes, rules, corner brackets, the "+" ornament and the next-slide arrow, as measured blocks
 * (TYTO-886, ADR 0224).
 *
 * Five template repositories drew these by hand at the slide's coordinates — the same arrow
 * formula in four, with another head proportion in a fifth; a rounded rectangle, a circle and a
 * capsule built as path strings; corner brackets as paths in one and as pairs of rectangles in
 * another. Each is one piece here: it takes its size, its paint and its declared parameters, and
 * returns a block the arrangements place. **Geometry in, colour out**: the paint — solid or a
 * linear gradient — is the caller's, never the kit's.
 *
 * Glyphs that belong to someone else (a network's logo, an institution's emblem) stay in the
 * template as data; the path helpers at the end of this file are what such data is built from.
 */

/** A size in px. */
export interface Size {
  readonly w: number;
  readonly h: number;
}

/** An outline: its paint and width, drawn on the shape's edge, inside it or outside it. */
export interface Outline {
  readonly paint: Paint;
  readonly width: number;
  readonly align?: 'inside' | 'center' | 'outside';
}

/* --------------------------------------------------------------------------- shape -- */

/** The numbers a shape uses (ADR 0224 decision 2). */
export const SHAPE_PARAMETERS = {
  kind: {
    kind: 'choice',
    default: 'rect',
    choices: ['rect', 'rounded', 'capsule', 'circle'],
    description:
      'A rectangle, one with rounded corners, one rounded whole at its short ends, or a circle.',
  },
  radius: {
    kind: 'length',
    default: 0,
    min: 0,
    description: "The corners' radius for `rounded`; the others ignore it.",
  },
} as const satisfies ParameterSchema;

export type ShapeParameters = ValuesOf<typeof SHAPE_PARAMETERS>;

/**
 * A rectangle, rounded rectangle, capsule or circle of `size`, filled with `fill` and outlined
 * with `outline` when given. A circle is as wide as `size.w`; a capsule's ends are half its
 * shorter side.
 */
export function shape(
  size: Size,
  fill: Paint | undefined,
  given: Partial<ShapeParameters> = {},
  options: { readonly outline?: Outline; readonly name?: string } = {},
): Block {
  const values = parameterValues(SHAPE_PARAMETERS, given);
  const box = values.kind === 'circle' ? { w: size.w, h: size.w } : size;
  const radius =
    values.kind === 'rounded'
      ? values.radius
      : values.kind === 'capsule'
        ? Math.min(box.w, box.h) / 2
        : values.kind === 'circle'
          ? box.w / 2
          : 0;
  return sized(
    rect({
      ...(options.name === undefined ? {} : { name: options.name }),
      size: box,
      ...(radius === 0 ? {} : { radius }),
      ...(fill === undefined ? {} : { fill }),
      ...(options.outline === undefined
        ? {}
        : {
            stroke: {
              paint: options.outline.paint,
              width: options.outline.width,
              align: options.outline.align ?? 'center',
            },
          }),
    }),
  );
}

/* ---------------------------------------------------------------------------- rule -- */

/** The numbers a rule uses. */
export const RULE_PARAMETERS = {
  thickness: { kind: 'length', default: 1, min: 0, description: "The line's thickness, in px." },
  direction: {
    kind: 'choice',
    default: 'horizontal',
    choices: ['horizontal', 'vertical', 'diagonal-down', 'diagonal-up'],
    description: 'Across, down, or at 45° falling or rising to the right.',
  },
} as const satisfies ParameterSchema;

export type RuleParameters = ValuesOf<typeof RULE_PARAMETERS>;

/**
 * A line `length` px long. Across or down it is a filled rectangle `thickness` thick; at 45° it
 * is a stroked path across a `length` square, `thickness` wide on its centre.
 */
export function rule(
  length: number,
  paint: Paint,
  given: Partial<RuleParameters> = {},
  options: { readonly name?: string } = {},
): Block {
  const values = parameterValues(RULE_PARAMETERS, given);
  const name = options.name === undefined ? {} : { name: options.name };
  if (values.direction === 'horizontal' || values.direction === 'vertical') {
    const across = values.direction === 'horizontal';
    return sized(
      rect({
        ...name,
        size: across ? { w: length, h: values.thickness } : { w: values.thickness, h: length },
        fill: paint,
      }),
    );
  }
  const d =
    values.direction === 'diagonal-down' ? `M0 0L${length} ${length}` : `M0 ${length}L${length} 0`;
  return sized(
    vector({
      ...name,
      geometry: { kind: 'path', d, fillRule: 'nonzero' },
      size: { w: length, h: length },
      stroke: { paint, width: values.thickness, align: 'center' },
    }),
  );
}

/* ------------------------------------------------------------------ corner bracket -- */

/** The numbers a corner bracket uses. */
export const CORNER_BRACKET_PARAMETERS = {
  thickness: { kind: 'length', default: 4, min: 0, description: "The bracket's arms, in px." },
  corner: {
    kind: 'choice',
    default: 'top-left',
    choices: ['top-left', 'top-right', 'bottom-right', 'bottom-left'],
    description: 'Which corner of its square the bracket draws.',
  },
} as const satisfies ParameterSchema;

export type CornerBracketParameters = ValuesOf<typeof CORNER_BRACKET_PARAMETERS>;

/** The path of a corner bracket: two arms `t` thick meeting at one corner of an `s` square. */
export function cornerBracketPath(s: number, t: number, corner: CornerBracketParameters['corner']) {
  switch (corner) {
    case 'top-left':
      return `M0 0H${s}V${t}H${t}V${s}H0Z`;
    case 'top-right':
      return `M0 0H${s}V${s}H${s - t}V${t}H0Z`;
    case 'bottom-right':
      return `M${s - t} 0H${s}V${s}H0V${s - t}H${s - t}Z`;
    case 'bottom-left':
      return `M0 0H${t}V${s - t}H${s}V${s}H0Z`;
  }
}

/** An L-shaped bracket filling one corner of a `size` square. */
export function cornerBracket(
  size: number,
  paint: Paint,
  given: Partial<CornerBracketParameters> = {},
  options: { readonly name?: string } = {},
): Block {
  const values = parameterValues(CORNER_BRACKET_PARAMETERS, given);
  return sized(
    vector({
      ...(options.name === undefined ? {} : { name: options.name }),
      geometry: {
        kind: 'path',
        d: cornerBracketPath(size, values.thickness, values.corner),
        fillRule: 'nonzero',
      },
      size: { w: size, h: size },
      fill: paint,
    }),
  );
}

/* ---------------------------------------------------------------------------- plus -- */

/** The numbers a "+" uses. */
export const PLUS_PARAMETERS = {
  bar: { kind: 'length', default: 6, min: 0, description: "The bars' thickness, in px." },
} as const satisfies ParameterSchema;

export type PlusParameters = ValuesOf<typeof PLUS_PARAMETERS>;

/** A "+" filling a `size` square, its two bars `bar` thick and centred. */
export function plus(
  size: number,
  paint: Paint,
  given: Partial<PlusParameters> = {},
  options: { readonly name?: string } = {},
): Block {
  const { bar } = parameterValues(PLUS_PARAMETERS, given);
  const near = (size - bar) / 2;
  const far = near + bar;
  const s = size;
  const d = `M${near} 0H${far}V${near}H${s}V${far}H${far}V${s}H${near}V${far}H0V${near}H${near}Z`;
  return sized(
    vector({
      ...(options.name === undefined ? {} : { name: options.name }),
      geometry: { kind: 'path', d, fillRule: 'nonzero' },
      size: { w: s, h: s },
      fill: paint,
    }),
  );
}

/* --------------------------------------------------------------------------- arrow -- */

/** The numbers the next-slide arrow uses. */
export const ARROW_SHAPE_PARAMETERS = {
  shaft: { kind: 'length', default: 9, min: 0, description: "The shaft's thickness, in px." },
  headRatio: {
    kind: 'ratio',
    default: 0.64,
    min: 0,
    description: "The head's length as a share of the arrow's height, rounded to a whole px.",
  },
} as const satisfies ParameterSchema;

export type ArrowShapeParameters = ValuesOf<typeof ARROW_SHAPE_PARAMETERS>;

/**
 * The arrow's path: a shaft centred on the height, and a triangular head as tall as the arrow
 * whose length is the height times `headRatio`, rounded to a whole pixel.
 */
export function arrowPath(size: Size, shaft: number, headRatio: number): string {
  const head = Math.round(size.h * headRatio);
  const top = (size.h - shaft) / 2;
  const neck = size.w - head;
  return `M0 ${top}H${neck}V0L${size.w} ${size.h / 2}L${neck} ${size.h}V${top + shaft}H0Z`;
}

/** An arrow pointing right, filling `size`. */
export function arrowShape(
  size: Size,
  paint: Paint,
  given: Partial<ArrowShapeParameters> = {},
  options: { readonly name?: string } = {},
): Block {
  const values = parameterValues(ARROW_SHAPE_PARAMETERS, given);
  return sized(
    vector({
      ...(options.name === undefined ? {} : { name: options.name }),
      geometry: {
        kind: 'path',
        d: arrowPath(size, values.shaft, values.headRatio),
        fillRule: 'nonzero',
      },
      size,
      fill: paint,
    }),
  );
}

/* ---------------------------------------------------------------- path geometry -- */

/** A rounded rectangle's path at `x`, `y`, its corners `r`. */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

/** A circle's path, centred on `cx`, `cy`. */
export function circlePath(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}Z`;
}

/** The numbers a capsule's path uses. */
export const CAPSULE_PATH_PARAMETERS = {
  angle: {
    kind: 'length',
    default: 0,
    description: "The capsule's long axis, in degrees from horizontal, rising to the right.",
  },
  precision: {
    kind: 'length',
    default: 0.01,
    min: 0,
    description: "Each point's coordinates are rounded to this step; 0 keeps them as computed.",
  },
} as const satisfies ParameterSchema;

export type CapsulePathParameters = ValuesOf<typeof CAPSULE_PATH_PARAMETERS>;

/**
 * A capsule's path, centred on `cx`, `cy`: its straight sides `half` px either side of the
 * centre along `angle`, its round ends of radius `r`.
 */
export function capsulePath(
  cx: number,
  cy: number,
  half: number,
  r: number,
  given: Partial<CapsulePathParameters> = {},
): string {
  const { angle, precision } = parameterValues(CAPSULE_PATH_PARAMETERS, given);
  const radians = (angle * Math.PI) / 180;
  const along = { x: Math.cos(radians), y: -Math.sin(radians) };
  const across = { x: Math.sin(radians), y: Math.cos(radians) };
  // Multiplied by the inverse and divided back, so a step of 0.01 is the templates' `× 100 / 100`.
  const steps = precision === 0 ? 1 : 1 / precision;
  const round = (value: number) => (precision === 0 ? value : Math.round(value * steps) / steps);
  const point = (a: number, b: number) =>
    `${round(cx + along.x * a + across.x * b)} ${round(cy + along.y * a + across.y * b)}`;
  return (
    `M${point(half, -r)}A${r} ${r} 0 0 1 ${point(half, r)}` +
    `L${point(-half, r)}A${r} ${r} 0 0 1 ${point(-half, -r)}Z`
  );
}
