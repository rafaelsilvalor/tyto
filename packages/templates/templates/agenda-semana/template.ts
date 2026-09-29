/**
 * `agenda-semana` — the week's agenda as a carousel, several disciplines to a slide.
 *
 * ## The slide, top to bottom
 *
 * | band   | what                                          | drawn by                               |
 * | ------ | --------------------------------------------- | -------------------------------------- |
 * | header | the owl                                       | `header()` — `_estrategia-saude`       |
 * | middle | the cover (first slide only), then the table  | `titleBlock(coverTitle)`, `pillTable(sessionTable)` |
 * | footer | the handle, and the arrow unless last slide   | `footer()` — `_estrategia-saude`       |
 * | seal   | last slide only, when the brief has a `selo`  | `sealed` — kit; `sealOf` — house       |
 *
 * `bandedPage` centres the middle between the header and the footer, whatever the brief put
 * in it. Composition only: every piece comes from the Saúde brand module or from
 * `@tyto/template-kit`, and every number from the brand's tokens (ADR 0047,
 * `docs/template-conventions.md`).
 */

import { frame, solid } from '@tyto/core/template';
import { type Block, bandedPage, pillTable, stack, titleBlock, sealed } from '@tyto/template-kit';

import { sealOf } from '../_estrategia/seal.js';
import { footer, hasNextSlide, header } from '../_estrategia-saude/parts.js';
import { coverTitle, sessionTable } from '../_estrategia-saude/presets.js';
import { BAND, EDGE, GAP, MARGIN, PAPER } from '../_estrategia-saude/tokens.js';

import type { RichText, TemplateBuild, TemplateContext } from '@tyto/core';

export const build: TemplateBuild = (context: TemplateContext) => {
  const width = context.size.w - MARGIN * 2;

  const sessions = pillTable(sessionTable, {
    text: richTextOf(context, 'lamina') ?? [],
    width,
    measure: context.measure,
  });
  const middle = stack({
    name: 'middle',
    gap: GAP.cover,
    items: [...coverOf(context, width), sessions],
  });

  // The last slide may close with the brief's `selo`; the page above it shrinks by its
  // height, so the bands are laid out on what is left (TYTO-201).
  const page = sealed(context.size, sealOf(context));

  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    background: solid(PAPER),
    children: [
      ...bandedPage({
        size: page.size,
        edges: { top: EDGE.top, bottom: EDGE.bottom, side: MARGIN },
        header: { item: header(), band: BAND.header },
        footer: footer(width, { next: hasNextSlide(context.artwork) }),
        middle,
      }),
      ...page.seal,
    ],
  });
};

/**
 * The cover block, on the first slide and on no other.
 *
 * A list of none or one, spread into the middle stack, so the gap below it disappears with
 * it — a stack charges its gap per neighbour, so an absent cover costs no space.
 */
function coverOf(context: TemplateContext, width: number): Block[] {
  if (context.artwork.index !== 0) return [];

  const titulo = richTextOf(context, 'titulo');
  if (titulo === undefined) return [];

  const imagem = context.slots['imagem']?.value;

  return [
    titleBlock(coverTitle, {
      width,
      fields: { titulo, imagem: imagem?.kind === 'image' ? imagem.asset : undefined },
    }),
  ];
}

/** A rich-text slot's value, or nothing when the brief left it unset. */
function richTextOf(context: TemplateContext, name: string): RichText | undefined {
  const value = context.slots[name]?.value;
  return value?.kind === 'rich-text' ? value.text : undefined;
}
