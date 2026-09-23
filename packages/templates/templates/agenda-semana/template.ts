/**
 * `agenda-semana` — the week's agenda as a carousel, several disciplines to a slide.
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
import { BAND, EDGE, GAP, MARGIN, PAPER, TYPE } from './tokens.js';

import type { RichText, TemplateBuild, TemplateContext } from '@tyto/core';
import type { Session } from './parts.js';

export const build: TemplateBuild = (context: TemplateContext) => {
  const width = context.size.w - MARGIN * 2;

  const chrome = header();
  const sign = footer(width);

  const [cover] = coverOf(context, width, TYPE.cover);
  const disciplinas = stack({
    name: 'disciplinas',
    gap: GAP.disciplines,
    items: disciplinesOf(context).map((item) => discipline(item.name, item.sessions, width)),
  });

  // The slide is three bands. The owl is pinned to the top and the handle to the bottom,
  // and the middle is centred in what is left between them. On the first slide the middle is
  // the cover and the disciplines together, a fixed gap apart, so the words stay close to
  // the agenda they introduce; on every other slide it is the disciplines alone. This is the
  // payoff of a `Block` carrying its own height: a slide with one session and a slide with
  // four are both balanced, and neither is measured by hand — which the markup route cannot
  // do at all, since a group there has no size to read back
  // (`packages/core/src/scene/bounds.ts`: "a group has no box").
  const middle =
    cover === undefined
      ? disciplinas
      : stack({ name: 'middle', gap: GAP.cover, items: [cover, disciplinas] });

  // Centred exactly between the two bands, whatever the brief put in it: the content is
  // dynamic, so the centre is the only position that is right for every week. Only a middle
  // taller than the room is pinned under the header instead, because centring it would lay
  // it over the owl — and that case is a brief with too much in one slide, not a layout.
  const owlY = EDGE.top + (BAND.header - chrome.height) / 2;
  const top = EDGE.top + BAND.header;
  const bottom = context.size.h - EDGE.bottom - sign.height;
  const y = Math.max(top, top + (bottom - top - middle.height) / 2);

  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    background: solid(PAPER),
    children: [at(MARGIN, owlY, chrome), at(MARGIN, y, middle), at(MARGIN, bottom, sign)],
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

/** One discipline of a slide: its heading and the sessions written under it. */
interface Discipline {
  readonly name: RichText;
  readonly sessions: Session[];
}

/**
 * This slide's disciplines, read out of the one repeatable slot.
 *
 * A line with no field separator starts a discipline; a line with one is a session of the
 * discipline above it. That is the whole convention, and it is why the brief needs no
 * second separator: the heading is the line that is not a session. Sessions written before
 * any heading belong to a discipline with no name, which draws as its sessions alone rather
 * than as an error — the published artwork has no such slide, but a brief being written has.
 */
function disciplinesOf(context: TemplateContext): Discipline[] {
  const result: Discipline[] = [];

  for (const line of lines(richTextOf(context, 'slide') ?? [])) {
    const isSession = fields(line).length > 1;
    if (!isSession) {
      result.push({ name: line, sessions: [] });
      continue;
    }
    if (result.length === 0) result.push({ name: [], sessions: [] });
    result[result.length - 1]!.sessions.push(sessionOf(line));
  }

  return result;
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
