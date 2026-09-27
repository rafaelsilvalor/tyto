import { type Block, at } from './blocks.js';

import type { NodeDraft } from '@tyto/core/template';

/**
 * A page in three bands: a header pinned to the top, a footer pinned to the bottom, and a
 * middle centred in the room left between them.
 *
 * Every Azul slide is laid out this way (TYTO-185), and nothing about it is a brand: the
 * edges and the header band are numbers the brand's tokens supply. Centring is the only
 * position that is right for every brief when the middle's height comes from the brief — a
 * slide with one row and a slide with twelve are both balanced. Only a middle taller than
 * the room is pinned under the header instead, because centring it would lay it over the
 * header; that case is a brief with too much in one slide, not a layout.
 */
export interface BandedPageOptions {
  readonly size: { readonly w: number; readonly h: number };
  /** Paper above the header band and below the footer, and the gutter on either side. */
  readonly edges: { readonly top: number; readonly bottom: number; readonly side: number };
  /** The header, centred vertically in a band of the stated height. */
  readonly header: { readonly item: Block; readonly band: number };
  /** The footer, standing on the bottom edge; its band is its own height. */
  readonly footer: Block;
  readonly middle: Block;
}

/** The three bands, placed: the frame's children, in paint order. */
export function bandedPage(options: BandedPageOptions): NodeDraft[] {
  const { edges, header, footer, middle } = options;

  const headerY = edges.top + (header.band - header.item.height) / 2;
  const top = edges.top + header.band;
  const bottom = options.size.h - edges.bottom - footer.height;
  const middleY = Math.max(top, top + (bottom - top - middle.height) / 2);

  return [
    at(edges.side, headerY, header.item),
    at(edges.side, middleY, middle),
    at(edges.side, bottom, footer),
  ];
}
