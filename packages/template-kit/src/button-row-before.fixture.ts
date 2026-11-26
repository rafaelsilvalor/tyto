/*
 * `button-row.ts` as it was before TYTO-891, copied whole from origin/main (ece2ddeb) by a script that
 * only renames `buttonRow` to `oldButtonRow`, so the tests can hold the new forms to it byte for byte.
 */
import { group, rect, solid } from '@tyto/core/template';

import { type Block, at, block } from './blocks.js';
import { reportOverflow } from './page.js';

import type { Corners } from './table.js';
import type { TemplateContext } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';

/**
 * A row of buttons: the one component that draws a call to action (TYTO-860).
 *
 * A button is a pill — filled, outlined, or both — holding an optional leading piece (an
 * icon), its words, and an optional trailing box: a filled end cap holding its own piece (an
 * arrow). One button with a trailing box is "Escreva X nos comentários →"; three buttons with
 * leading icons are "♡ Curta · ◯ Comente · ➤ Compartilhe". A button may hold an icon alone,
 * with no words, and a trailing piece may sit after the words with no box of its own
 * (TYTO-884): "Confira →" on a pill of one colour. **The template decides what each
 * button holds and how it looks**: the words and icons arrive as blocks built by the
 * components that draw them (`textBlock`, `icon`…), and every size and colour in the style.
 * The kit holds the mechanism and no house value.
 */

export interface ButtonStyle {
  readonly height: number;
  /** The pill's corners; `height / 2` rounds its ends whole. */
  readonly radius: Corners;
  readonly fill?: string;
  /** An outline drawn inside the pill's edge. */
  readonly stroke?: { readonly color: string; readonly width: number };
  /** Room between the pill's ends and what it holds; `right` is before the trailing box. */
  readonly padding: { readonly left: number; readonly right: number };
  /** Between the leading piece and the words. */
  readonly gap: number;
  /** The end cap at the pill's right end, as tall as the pill. */
  readonly trailing?: { readonly width: number; readonly fill: string; readonly radius: Corners };
}

export interface Button {
  readonly style: ButtonStyle;
  /** The words, as wide as they need: the button grows to hold them. Absent: an icon alone. */
  readonly words?: Block;
  /** Before the words, centred on the pill's height. */
  readonly leading?: Block;
  /**
   * Centred in the trailing box when the style has one; without a box, after the words, `gap`
   * apart and centred on the pill's height, like the leading piece on the other side.
   */
  readonly trailing?: Block;
  /** The button's group in the scene. Default `button`. */
  readonly name?: string;
}

export interface ButtonRowOptions {
  /** Between two buttons, at least. */
  readonly gap: number;
  /**
   * The room the row has. `packed` centres the buttons in it at `gap` apart; `justified`
   * spreads what is left over between them, so the first and last touch its edges. Absent,
   * the row is as wide as its buttons.
   */
  readonly width?: number;
  readonly arrange?: 'packed' | 'justified';
  /** When given, a row wider than `width` is reported as an overflow. */
  readonly report?: TemplateContext['report'];
  /** The row's group in the scene. Default `buttons`. */
  readonly name?: string;
}

/**
 * What sits between the padding, in order: the leading piece, the words, and a trailing piece
 * the style gives no box. `gap` apart.
 */
function piecesOf(button: Button): Block[] {
  const boxless = button.style.trailing === undefined ? button.trailing : undefined;
  return [button.leading, button.words, boxless].filter(
    (piece): piece is Block => piece !== undefined,
  );
}

/** How wide one button is: its padding, its pieces `gap` apart, and its trailing box. */
export function buttonWidth(button: Button): number {
  const { style } = button;
  const pieces = piecesOf(button);
  const inner =
    pieces.reduce((sum, piece) => sum + piece.width, 0) +
    style.gap * Math.max(0, pieces.length - 1);
  const trailing = style.trailing?.width ?? 0;
  return style.padding.left + inner + style.padding.right + trailing;
}

/** The buttons, side by side, centred on the tallest one's middle. */
export function oldButtonRow(buttons: readonly Button[], options: ButtonRowOptions): Block {
  const widths = buttons.map(buttonWidth);
  const natural =
    widths.reduce((sum, each) => sum + each, 0) + options.gap * Math.max(0, buttons.length - 1);
  const room = options.width ?? natural;
  if (options.report !== undefined) reportOverflow(options.report, natural, room);

  const spare = Math.max(0, room - natural);
  const justified = options.arrange === 'justified' && buttons.length > 1;
  const gap = justified ? options.gap + spare / (buttons.length - 1) : options.gap;
  const height = buttons.reduce((tallest, each) => Math.max(tallest, each.style.height), 0);

  let x = justified ? 0 : spare / 2;
  const children = buttons.map((button, index) => {
    const drawn = drawButton(button, widths[index]!);
    const placed = at(x, (height - drawn.height) / 2, drawn);
    x += drawn.width + gap;
    return placed;
  });

  return block(
    Math.max(room, natural),
    height,
    group({ name: options.name ?? 'buttons', children }),
  );
}

function drawButton(button: Button, width: number): Block {
  const { style } = button;
  const h = style.height;
  const middle = (piece: Block) => (h - piece.height) / 2;
  const children: NodeDraft[] = [];

  if (style.fill !== undefined) {
    children.push(
      rect({ name: 'pill', size: { w: width, h }, radius: style.radius, fill: solid(style.fill) }),
    );
  }
  if (style.trailing !== undefined) {
    const box = style.trailing;
    children.push(
      rect({
        name: 'end',
        size: { w: box.width, h },
        radius: box.radius,
        fill: solid(box.fill),
        transform: { x: width - box.width, y: 0 },
      }),
    );
    if (button.trailing !== undefined) {
      children.push(
        at(
          width - box.width + (box.width - button.trailing.width) / 2,
          middle(button.trailing),
          button.trailing,
        ),
      );
    }
  }
  if (style.stroke !== undefined) {
    children.push(
      rect({
        name: 'outline',
        size: { w: width, h },
        radius: style.radius,
        stroke: { paint: solid(style.stroke.color), width: style.stroke.width, align: 'inside' },
      }),
    );
  }

  let x = style.padding.left;
  for (const piece of piecesOf(button)) {
    children.push(at(x, middle(piece), piece));
    x += piece.width + style.gap;
  }

  return block(width, h, group({ name: button.name ?? 'button', children }));
}
