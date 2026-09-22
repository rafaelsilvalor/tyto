/**
 * `agenda-semana` — the week's agenda as a carousel, one discipline to a slide.
 *
 * The first production template written in TypeScript (TYTO-167), and written as
 * composition: what goes where, in what order. Everything it draws comes from `parts.ts`,
 * every number it draws with comes from `tokens.ts`, and everything it arranges with comes
 * from `@tyto/template-kit`. `docs/template-conventions.md` is why those are three files.
 *
 * ## The three things the code route buys, in three lines of this file
 *
 * - **Stacking** is {@link stack}, not a coordinate anybody typed (would have been TYTO-161).
 * - **Repetition** is `.map()` over the sessions the brief wrote (would have been TYTO-163).
 * - **First slide only** is `context.artwork.index === 0` (would have been TYTO-164).
 *
 * None of those three cards is closed by this template. They stay real for the markup
 * route; they just do not block this one.
 *
 * ## What it still cannot do
 *
 * The grey pill's height is fixed, because a template cannot measure text (TYTO-162). See
 * `sessionPill` in `parts.ts` for what that costs and how it is made to announce itself.
 */

import { frame, solid } from '@tyto/core/template';
import { type Block, at, stack } from '@tyto/template-kit';

import { cover, discipline, footer, header } from './parts.js';
import { fields, lines } from './rich-text.js';
import { GAP, MARGIN, PAPER, TYPE } from './tokens.js';

import type { RichText, TemplateBuild, TemplateContext } from '@tyto/core';
import type { Session } from './parts.js';

/**
 * The cover's type size per format — the one thing that genuinely differs between a square
 * and a story, because a story is read further away.
 *
 * A template states its layout and not its canvas, so everything else comes off
 * `context.size`. A format the manifest declares and this does not know about falls back to
 * `feed`, which is a layout somebody can look at rather than a crash.
 */
const COVER_SIZE: Readonly<Record<string, number>> = {
  feed: TYPE.cover,
  story: TYPE.coverStory,
};

/** Where the owl sits, and therefore where the body may start. */
const HEADER_Y = 72;

/** The least room between the owl and the body, whatever the arithmetic below wants. */
const HEADER_CLEARANCE = 64;

export const build: TemplateBuild = (context: TemplateContext) => {
  const width = context.size.w - MARGIN * 2;

  const chrome = header();
  const sign = footer();

  const body = stack({
    name: 'body',
    gap: GAP.cover,
    items: [
      ...coverOf(context, width, COVER_SIZE[context.format] ?? TYPE.cover),
      disciplineOf(context, width),
    ],
  });

  // Centred in what is left between the owl and the handle, rather than started at a
  // number per format. This is the payoff of a `Block` carrying its own height: a slide
  // with one session and a slide with four are both balanced, and neither is measured by
  // hand — which is the thing the markup route cannot do at all, since a group there has
  // no size to read back (`packages/core/src/scene/bounds.ts`: "a group has no box").
  const top = HEADER_Y + chrome.height + HEADER_CLEARANCE;
  const bottom = context.size.h - MARGIN - sign.height;
  const y = Math.max(top, top + (bottom - top - body.height) / 2);

  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    background: solid(PAPER),
    children: [at(MARGIN, HEADER_Y, chrome), at(MARGIN, y, body), at(MARGIN, bottom, sign)],
  });
};

/**
 * The cover block, on the first slide and on no other.
 *
 * Returned as a list of none or one so that the caller spreads it into the stack and the
 * gap below it disappears with it — a stack charges its gap per neighbour, so an absent
 * cover costs no space rather than leaving a hole where it would have been.
 */
function coverOf(context: TemplateContext, width: number, size: number): Block[] {
  if (context.artwork.index !== 0) return [];

  const titulo = richTextOf(context, 'titulo');
  if (titulo === undefined) return [];

  const ilustracao = context.slots['ilustracao']?.value;

  return [
    cover({
      titulo,
      width,
      size,
      ...(ilustracao?.kind === 'image' ? { ilustracao: ilustracao.asset } : {}),
    }),
  ];
}

/** This slide's discipline, read out of the one repeatable slot. */
function disciplineOf(context: TemplateContext, width: number): Block {
  const value = richTextOf(context, 'disciplina') ?? [];
  const [name = [], ...rest] = lines(value);

  return discipline(name, rest.map(sessionOf), width);
}

/**
 * One line of the block as a session.
 *
 * Three fields at most: a title holding the separator keeps it, because the remainder stays
 * in the last field. Fewer than three is not an error — a session with no professor yet is
 * a real thing to write on a Monday — and the missing fields draw as nothing.
 */
function sessionOf(line: RichText): Session {
  const [data = [], titulo = [], professor = []] = fields(line, FIELD_COUNT);
  return { data, titulo, professor };
}

const FIELD_COUNT = 3;

/** A rich-text slot's value, or nothing when the brief left it unset. */
function richTextOf(context: TemplateContext, name: string): RichText | undefined {
  const value = context.slots[name]?.value;
  return value?.kind === 'rich-text' ? value.text : undefined;
}
