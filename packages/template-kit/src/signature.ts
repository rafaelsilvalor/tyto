import { group } from '@tyto/core/template';

import { type Block, anchorOf, at } from './blocks.js';
import { type CapTextOptions, type FontMetrics, capText, plainRuns } from './cap-text.js';
import { type Area, type ParameterSchema, type ValuesOf, parameterValues } from './parameters.js';

import type { FontRef } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';

/**
 * The signature at a slide's foot, and the carousel's footer that carries it (TYTO-887, ADR
 * 0224).
 *
 * Six template repositories and house-style drew the brand's signature by hand, each with its
 * own size, tracking and top, and each subtracted the seal's band from that top so the line rose
 * with it. Here the line is one component over `capText` — measured, placed by its capitals —
 * and the footer is one arrangement over the page `sealed` returns: it stands its pieces on that
 * page's foot, so a seal lifts them with no arithmetic at the call.
 */

/* ------------------------------------------------------------------ the signature -- */

/** The numbers a signature line uses. The face, the weight and the colour are the caller's. */
export const SIGNATURE_LINE_PARAMETERS = {
  size: { kind: 'length', default: 24, min: 1, description: 'The type size, in px.' },
  letterSpacing: {
    kind: 'length',
    default: 0,
    description: 'Space added between letters, in px.',
  },
  lineHeight: {
    kind: 'ratio',
    default: 1,
    min: 0.5,
    description: "The line's height, as a multiple of the size.",
  },
  align: {
    kind: 'choice',
    default: 'center',
    choices: ['left', 'center', 'right'],
    description: 'Where the line sits across its area.',
  },
} as const satisfies ParameterSchema;

export type SignatureLineParameters = ValuesOf<typeof SIGNATURE_LINE_PARAMETERS>;

/** The run style of a signature: everything but its size, which is a parameter. */
export interface SignatureStyle {
  readonly font: FontRef;
  readonly weight: number;
  readonly color: string;
}

/**
 * `words` — the brand kit's signature (`signatureOf` in house-style) or a slot's text — on one
 * line across `area`, measured, its anchor at its capitals. With a finite `area.width` the line
 * is aligned in that width, which starts at the block's left edge: a line centred on the slide
 * takes the slide's width.
 */
export function signatureLine(
  words: string,
  area: Area,
  style: SignatureStyle,
  given: Partial<SignatureLineParameters> = {},
  options: Pick<CapTextOptions, 'name' | 'text'> & { readonly metrics?: FontMetrics } = {},
): Block {
  const values = parameterValues(SIGNATURE_LINE_PARAMETERS, given);
  return capText(plainRuns(words, { ...style, size: values.size }), area, values, {
    name: options.name ?? 'signature',
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    ...(options.text === undefined ? {} : { text: options.text }),
  });
}

/* --------------------------------------------------------------------- the footer -- */

/** The footer's distances, every one measured from the page's foot or its sides. */
export const CAROUSEL_FOOTER_PARAMETERS = {
  signatureFromFoot: {
    kind: 'length',
    default: 72,
    description: "From the page's foot up to the top of the signature's capitals, in px.",
  },
  leadingFromFoot: {
    kind: 'length',
    default: 48,
    description: "From the page's foot up to the leading piece's foot, in px.",
  },
  leadingInset: {
    kind: 'length',
    default: 64,
    description: "From the page's left edge to the leading piece, in px.",
  },
  trailingFromFoot: {
    kind: 'length',
    default: 48,
    description: "From the page's foot up to the trailing piece's foot, in px.",
  },
  trailingInset: {
    kind: 'length',
    default: 64,
    description: "From the page's right edge to the trailing piece, in px.",
  },
} as const satisfies ParameterSchema;

export type CarouselFooterParameters = ValuesOf<typeof CAROUSEL_FOOTER_PARAMETERS>;

/** What a carousel's footer carries: the signature, and a piece on either side of it. */
export interface CarouselFooterPieces {
  /** Placed at the page's left edge, by its anchor's capitals (`signatureLine`). */
  readonly signature: Block;
  /** At the left, standing on its foot: a slide number, say. */
  readonly leading?: Block;
  /** At the right, standing on its foot: the next-slide arrow (`arrowShape`), say. */
  readonly trailing?: Block;
}

/**
 * The footer as a layer as large as `page` — the area `sealed(...)` returns, or the frame's when
 * there is no seal — with its pieces drawn at that area's foot. Place it at (0, 0): a seal makes
 * the page shorter, and everything here rises by its height.
 */
export function carouselFooter(
  page: Area,
  pieces: CarouselFooterPieces,
  given: Partial<CarouselFooterParameters> = {},
  options: { readonly name?: string } = {},
): Block {
  const values = parameterValues(CAROUSEL_FOOTER_PARAMETERS, given);
  const foot = page.height;
  const { signature, leading, trailing } = pieces;
  const children: NodeDraft[] = [
    ...(leading === undefined
      ? []
      : [at(values.leadingInset, foot - values.leadingFromFoot - leading.height, leading)]),
    at(0, foot - values.signatureFromFoot - anchorOf(signature).capTop, signature),
    ...(trailing === undefined
      ? []
      : [
          at(
            page.width - values.trailingInset - trailing.width,
            foot - values.trailingFromFoot - trailing.height,
            trailing,
          ),
        ]),
  ];
  return {
    width: page.width,
    height: page.height,
    draft: group({ name: options.name ?? 'footer', children }),
  };
}
