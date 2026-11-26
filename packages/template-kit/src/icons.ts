import { group, rect, solid, vector } from '@tyto/core/template';

import { type Block, at, block } from './blocks.js';
import { type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

/**
 * Five single-colour icons for calls to action (TYTO-860, TYTO-888): a heart, a speech balloon,
 * a paper plane, a bookmark and an arrow. Geometry only, drawn for the kit on a 24-unit box and
 * never copied from a brand file; the colour comes from the caller (`AGENTS.md`: geometry in,
 * colour out).
 *
 * An icon is either filled or stroked. A stroke is in the box's units, so it scales with the
 * icon: a 2-unit line on a 24-unit box is a 3 px line on an icon 36 px tall.
 */
export interface Icon {
  readonly box: { readonly w: number; readonly h: number };
  readonly d: string;
  /** Filled, or outlined by a line this many box units wide. */
  readonly paint: { readonly kind: 'fill' } | { readonly kind: 'stroke'; readonly width: number };
  /**
   * How the path's overlaps fill: `evenodd` leaves a hole where a subpath lies inside another (a
   * ring, a lens). A property of the geometry, so it travels with it (TYTO-888); absent, nonzero.
   */
  readonly fillRule?: 'nonzero' | 'evenodd';
}

/** An outlined heart: like. */
export const HEART_ICON: Icon = {
  box: { w: 24, h: 24 },
  d:
    'M12 20.4C12 20.4 3 14.7 3 8.9C3 6.2 5.1 4 7.8 4C9.6 4 11.2 5 12 6.5' +
    'C12.8 5 14.4 4 16.2 4C18.9 4 21 6.2 21 8.9C21 14.7 12 20.4 12 20.4Z',
  paint: { kind: 'stroke', width: 1.8 },
};

/** An outlined speech balloon with its tail to the bottom left: comment. */
export const BALLOON_ICON: Icon = {
  box: { w: 24, h: 24 },
  d:
    'M12 3.5C7 3.5 3 7 3 11.3C3 13.5 4 15.4 5.7 16.8L4.6 20.6L9.1 18.7' +
    'C10 19 11 19.1 12 19.1C17 19.1 21 15.6 21 11.3C21 7 17 3.5 12 3.5Z',
  paint: { kind: 'stroke', width: 1.8 },
};

/** An outlined paper plane: share. */
export const PAPER_PLANE_ICON: Icon = {
  box: { w: 24, h: 24 },
  d: 'M21 3L2.8 10.4L10.2 13.8L13.6 21.2L21 3ZM10.2 13.8L21 3',
  paint: { kind: 'stroke', width: 1.8 },
};

/** An outlined bookmark: save (TYTO-888). */
export const BOOKMARK_ICON: Icon = {
  box: { w: 24, h: 24 },
  d: 'M6 3.5H18V20.5L12 15.8L6 20.5Z',
  paint: { kind: 'stroke', width: 1.8 },
};

/** A filled arrow pointing right: go. */
export const ARROW_ICON: Icon = {
  box: { w: 24, h: 24 },
  d: 'M13.2 4.6L11.8 6L16.8 11H3V13H16.8L11.8 18L13.2 19.4L20.6 12L13.2 4.6Z',
  paint: { kind: 'fill' },
};

/**
 * No paint at all. A vector with a stroke and no `fill` is filled black by the exporter, so an
 * outlined icon states that its inside is empty (measured on informativo's icons, TYTO-699).
 */
const NO_FILL = solid({ r: 0, g: 0, b: 0, a: 0 });

/** An icon `height` tall, in `color`, as wide as its box at that height. */
export function icon(shape: Icon, height: number, color: string, name: string): Block {
  const scale = height / shape.box.h;
  const paint =
    shape.paint.kind === 'fill'
      ? { fill: solid(color) }
      : {
          fill: NO_FILL,
          stroke: {
            paint: solid(color),
            width: shape.paint.width,
            align: 'center' as const,
          },
        };
  return block(
    shape.box.w * scale,
    height,
    vector({
      name,
      geometry: { kind: 'path', d: shape.d, fillRule: shape.fillRule ?? 'nonzero' },
      size: shape.box,
      ...paint,
      transform: { scaleX: scale, scaleY: scale },
    }),
  );
}

/** The numbers an icon in a disc uses. */
export const ICON_IN_DISC_PARAMETERS = {
  iconRatio: {
    kind: 'ratio',
    default: 0.5,
    min: 0,
    max: 1,
    description: "The icon's height as a share of the disc's diameter.",
  },
} as const satisfies ParameterSchema;

export type IconInDiscParameters = ValuesOf<typeof ICON_IN_DISC_PARAMETERS>;

/**
 * An icon centred in a filled disc `diameter` wide (TYTO-888): the disc in `colors.disc`, the
 * icon in `colors.icon`, its height `iconRatio` of the diameter.
 */
export function iconInDisc(
  shape: Icon,
  diameter: number,
  colors: { readonly disc: string; readonly icon: string },
  given: Partial<IconInDiscParameters> = {},
  options: { readonly name?: string; readonly discName?: string; readonly iconName?: string } = {},
): Block {
  const { iconRatio } = parameterValues(ICON_IN_DISC_PARAMETERS, given);
  const glyph = icon(shape, diameter * iconRatio, colors.icon, options.iconName ?? 'icon');
  return block(
    diameter,
    diameter,
    group({
      name: options.name ?? 'icon-in-disc',
      children: [
        rect({
          name: options.discName ?? 'disc',
          size: { w: diameter, h: diameter },
          radius: diameter / 2,
          fill: solid(colors.disc),
        }),
        at((diameter - glyph.width) / 2, (diameter - glyph.height) / 2, glyph),
      ],
    }),
  );
}
