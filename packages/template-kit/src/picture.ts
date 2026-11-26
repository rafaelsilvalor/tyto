import { group, image, rect, vector } from '@tyto/core/template';

import { type Block, sized } from './blocks.js';
import { imageHeight } from './image.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

import type { AssetRef, Color, Paint } from '@tyto/core';

/**
 * A picture in a frame, and a picture alone, as measured blocks (TYTO-625, ADR 0224).
 *
 * questao-estrategica and voce-conhece each drew the frame by hand: a border on the top, the
 * right and the foot, a bar down the left, the inside's two left corners rounded where they
 * meet the bar, a shadow, and the picture fitted inside. A fix to it (TYTO-608) had to land
 * twice, and one of its two halves never reached the second copy. Here it is one piece: it
 * takes the picture, an area and its declared parameters, and returns a block. **Geometry in,
 * colour out**: the border's, the paper's and the shadow's colours are the caller's.
 */

/* -------------------------------------------------------------------- the picture -- */

/** The numbers a picture's size and fit use, framed or not. */
const PICTURE_SHAPE_PARAMETERS = {
  widest: {
    kind: 'ratio',
    default: 3,
    min: 0,
    description: 'The widest shape the picture may take, as width over height.',
  },
  tallest: {
    kind: 'ratio',
    default: 1,
    min: 0,
    description:
      'The tallest shape the picture may take, as width over height; a taller file is fitted whole.',
  },
  fallback: {
    kind: 'ratio',
    default: 2,
    min: 0,
    description: "The picture's shape, as width over height, when the file's size is unknown.",
  },
  fit: {
    kind: 'choice',
    default: 'auto',
    choices: ['auto', 'cover', 'contain'],
    description:
      'How the file fills the picture: `auto` covers it when the picture took the file’s own ' +
      'shape and fits it whole otherwise.',
  },
} as const satisfies ParameterSchema;

/** The numbers a picture with no frame uses. */
export const BARE_PICTURE_PARAMETERS = PICTURE_SHAPE_PARAMETERS;

export type BarePictureParameters = ValuesOf<typeof BARE_PICTURE_PARAMETERS>;

/** The picture's size inside `width`, at most `cap` tall, and how the file fills it. */
function pictureSize(
  asset: AssetRef,
  width: number,
  cap: number,
  values: BarePictureParameters,
): {
  readonly size: { readonly w: number; readonly h: number };
  readonly fit: 'cover' | 'contain';
} {
  const natural = imageHeight(asset, width, width / values.fallback);
  // The area's height caps the picture before its shape's limits do: a shape the limits refuse
  // wins over the area, as a picture never takes a shape its template ruled out.
  const capped = Math.min(natural, cap);
  const clamped = Math.min(width / values.tallest, Math.max(width / values.widest, capped));
  // A picture that took the file's own shape is covered by it, losing under a pixel to the
  // rounding; `contain` would leave half a pixel of paper down each side, a light seam
  // (TYTO-608). A picture held to another shape is fitted whole, with paper around it.
  const fit = values.fit === 'auto' ? (clamped === natural ? 'cover' : 'contain') : values.fit;
  return { size: { w: width, h: Math.round(clamped) }, fit };
}

/**
 * A picture with no frame (`{sem-quadro}`): the file alone, as wide as `area`, as tall as its
 * own shape makes it, at most `area.height`, held between `widest` and `tallest`.
 */
export function barePicture(
  asset: AssetRef,
  area: Area,
  given: Partial<BarePictureParameters> = {},
  options: { readonly name?: string } = {},
): Block {
  const values = parameterValues(BARE_PICTURE_PARAMETERS, given);
  const { size, fit } = pictureSize(asset, area.width, area.height, values);
  return sized(image({ name: options.name ?? 'image', asset, size, fit }));
}

/* ---------------------------------------------------------------------- the frame -- */

/** The numbers a framed picture uses: its picture's, the frame's and the shadow's. */
export const FRAMED_PICTURE_PARAMETERS = {
  ...PICTURE_SHAPE_PARAMETERS,
  border: {
    kind: 'length',
    default: 4,
    min: 0,
    description: 'The border on the top, the right and the foot, in px.',
  },
  side: {
    kind: 'length',
    default: 29,
    min: 0,
    description: 'The bar down the left side, border included, in px.',
  },
  radius: {
    kind: 'length',
    default: 32,
    min: 0,
    description: "The inside's two left corners, where it meets the bar, in px.",
  },
  shadowX: { kind: 'length', default: 17, description: "The shadow's offset to the right, in px." },
  shadowY: { kind: 'length', default: 47, description: "The shadow's offset down, in px." },
  shadowBlur: {
    kind: 'length',
    default: 12,
    min: 0,
    description: "The shadow's blur, a standard deviation in px.",
  },
  shadowSpread: {
    kind: 'length',
    default: -20,
    description: 'How much wider than the frame the shadow is on every side; below 0, narrower.',
  },
} as const satisfies ParameterSchema;

export type FramedPictureParameters = ValuesOf<typeof FRAMED_PICTURE_PARAMETERS>;

/** The colours of a framed picture: its border and bar, the paper behind the file, its shadow. */
export interface FramedPicturePaints {
  readonly border: Paint;
  readonly paper: Paint;
  /** The shadow's colour; with none, the frame casts no shadow. */
  readonly shadow?: Color;
}

/** The names the framed picture's four nodes take. */
export interface FramedPictureNames {
  readonly frame: string;
  readonly paper: string;
  readonly image: string;
  readonly outline: string;
}

const DEFAULT_NAMES: FramedPictureNames = {
  frame: 'frame',
  paper: 'paper',
  image: 'image',
  outline: 'outline',
};

/**
 * The frame's ink as one shape, in the frame's own coordinates: the whole frame less the inside,
 * whose two left corners are rounded by `radius`. One shape, so the border, the bar and the
 * corners share their edges: drawn as separate pieces over the paper, each was blended on its
 * own where an edge fell inside a pixel, and at a fractional scale (a preview, a 125 % screen) a
 * light seam showed along the corners (measured 2026-11-04, TYTO-608). Fill it even-odd.
 */
export function frameOutlinePath(
  size: { readonly w: number; readonly h: number },
  frame: { readonly border: number; readonly side: number; readonly radius: number },
): string {
  const r = frame.radius;
  const left = frame.side;
  const right = size.w - frame.border;
  const top = frame.border;
  const foot = size.h - frame.border;
  return [
    `M0 0H${size.w}V${size.h}H0Z`,
    `M${left + r} ${top}H${right}V${foot}H${left + r}`,
    `A${r} ${r} 0 0 1 ${left} ${foot - r}V${top + r}A${r} ${r} 0 0 1 ${left + r} ${top}Z`,
  ].join('');
}

/**
 * A picture in a frame, as wide as `area`: a `border` on the top, the right and the foot, a
 * `side` bar down the left, and the inside's two left corners rounded by `radius`. The inside is
 * as tall as the file's own shape makes it at the inside's width (ADR 0158), the frame at most
 * `area.height` tall, held between `widest` and `tallest`.
 *
 * Four nodes, in order: the frame under everything, which only casts the shadow; the paper
 * behind the file; the file; and the outline over it (`frameOutlinePath`), so a photo that fills
 * the inside is cut to the same corners. Place the block on a whole pixel: at a fractional top
 * the outline's edges are blended and the paper shows through as a line (TYTO-608).
 */
export function framedPicture(
  asset: AssetRef,
  area: Area,
  paints: FramedPicturePaints,
  given: Partial<FramedPictureParameters> = {},
  options: { readonly name?: string; readonly names?: Partial<FramedPictureNames> } = {},
): Block {
  const values = parameterValues(FRAMED_PICTURE_PARAMETERS, given);
  const names = { ...DEFAULT_NAMES, ...options.names };
  const inner = area.width - values.side - values.border;
  const { size, fit } = pictureSize(asset, inner, area.height - 2 * values.border, values);
  const outer = { w: area.width, h: size.h + 2 * values.border };
  const inside = { x: values.side, y: values.border };
  const shadow =
    paints.shadow === undefined
      ? {}
      : {
          effects: [
            {
              kind: 'shadow' as const,
              x: values.shadowX,
              y: values.shadowY,
              blur: values.shadowBlur,
              spread: values.shadowSpread,
              color: paints.shadow,
            },
          ],
        };
  const children = [
    rect({
      name: names.frame,
      size: outer,
      fill: paints.border,
      ...shadow,
      transform: { x: 0, y: 0 },
    }),
    rect({ name: names.paper, size, fill: paints.paper, transform: inside }),
    image({ name: names.image, asset, size, fit, transform: inside }),
    vector({
      name: names.outline,
      geometry: { kind: 'path', d: frameOutlinePath(outer, values), fillRule: 'evenodd' },
      size: outer,
      fill: paints.border,
      transform: { x: 0, y: 0 },
    }),
  ];
  return {
    width: outer.w,
    height: outer.h,
    draft: group({ children, ...(options.name === undefined ? {} : { name: options.name }) }),
  };
}
