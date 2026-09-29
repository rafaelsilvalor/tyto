/**
 * `aprovados` — an exam's approved list, on one slide or several (TYTO-190).
 *
 * ## A slide, top to bottom
 *
 * | band   | what                                                     | drawn by                         |
 * | ------ | -------------------------------------------------------- | -------------------------------- |
 * | header | the owl                                                  | `header()` — `_estrategia-saude` |
 * | middle | first slide only: emblem, kicker, subtitle, rule, exam    | `titleBlock(resultTitle)`        |
 * |        | this `::lamina`'s specialties, each as wide as its names | `pillTable(approvedTable)`       |
 * | footer | the handle, and the arrow unless this is the last slide  | `footer()` — `_estrategia-saude` |
 * | seal   | last slide only, when the brief has a `selo`: the art     | `sealed` — kit; `sealOf` — house |
 *
 * The second Saúde template (TYTO-185), and the first written after the four layers of
 * ADR 0047: it draws nothing of its own. Every piece is the brand's or the kit's, and every
 * number the brand's tokens.
 */

import { frame, solid } from '@tyto/core/template';
import { type Block, bandedPage, pillTable, stack, titleBlock, sealed } from '@tyto/template-kit';

import { sealOf } from '../_estrategia/seal.js';
import { footer, hasNextSlide, header } from '../_estrategia-saude/parts.js';
import { approvedTable, resultTitle } from '../_estrategia-saude/presets.js';
import { APPROVED, BAND, EDGE, MARGIN, PAPER } from '../_estrategia-saude/tokens.js';

import type { RichText, TemplateBuild, TemplateContext } from '@tyto/core';

export const build: TemplateBuild = (context: TemplateContext) => {
  const width = context.size.w - MARGIN * 2;

  const list = pillTable(approvedTable, {
    text: richTextOf(context, 'lamina') ?? [],
    width,
    measure: context.measure,
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
        middle: stack({
          name: 'middle',
          gap: APPROVED.gap.table,
          items: [...titleOf(context, width), list],
        }),
      }),
      ...page.seal,
    ],
  });
};

/**
 * The title block, on the first slide and on no other (TYTO-190).
 *
 * A list of none or one, spread into the middle stack, so the gap below it disappears with
 * it — the same shape as the agenda's cover. Every later slide is its list alone, centred.
 */
function titleOf(context: TemplateContext, width: number): Block[] {
  if (context.artwork.index !== 0) return [];

  return [
    titleBlock(resultTitle, {
      width,
      fields: {
        imagem: imageOf(context, 'imagem'),
        chamada: richTextOf(context, 'chamada'),
        subtitulo: richTextOf(context, 'subtitulo'),
        titulo: richTextOf(context, 'titulo'),
      },
    }),
  ];
}

/** A rich-text slot's value, or nothing when the brief left it unset. */
function richTextOf(context: TemplateContext, name: string): RichText | undefined {
  const value = context.slots[name]?.value;
  return value?.kind === 'rich-text' ? value.text : undefined;
}

/** An image slot's asset, or nothing when the brief left it unset. */
function imageOf(context: TemplateContext, name: string) {
  const value = context.slots[name]?.value;
  return value?.kind === 'image' ? value.asset : undefined;
}
