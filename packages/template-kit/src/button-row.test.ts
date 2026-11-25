import { group } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { type Block, block } from './blocks.js';
import { type Button, type ButtonStyle, buttonRow, buttonWidth } from './button-row.js';
import { ARROW_ICON, BALLOON_ICON, HEART_ICON, PAPER_PLANE_ICON, icon } from './icons.js';

import type { TemplateReport } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';

/**
 * The call-to-action component (TYTO-860), asserted on the drafts: the two shapes the
 * reference art draws — one pill with an end cap, and three pills with leading icons — and
 * how a row packs, spreads and reports. Words are stand-in blocks of a stated size, because
 * the component never draws them.
 */

const words = (width: number, height = 24): Block =>
  block(width, height, group({ name: 'words', children: [] }));

const OUTLINED: ButtonStyle = {
  height: 56,
  radius: 28,
  stroke: { color: '#880000', width: 2 },
  padding: { left: 30, right: 30 },
  gap: 14,
};

type Draft = NodeDraft & {
  readonly name?: string;
  readonly kind?: string;
  readonly children?: readonly Draft[];
  readonly transform?: { readonly x?: number; readonly y?: number };
  readonly size?: { readonly w: number; readonly h: number };
  readonly stroke?: unknown;
  readonly fill?: unknown;
};

function named(draft: NodeDraft, name: string): Draft[] {
  const found: Draft[] = [];
  const walk = (node: Draft) => {
    if (node.name === name) found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(draft as Draft);
  return found;
}

/** Where a named node sits inside its button, through the one wrapper `at` may add. */
function placeOf(button: Draft, name: string): { x: number; y: number } {
  for (const child of button.children ?? []) {
    const inner = child.name === name ? child : child.children?.find((each) => each.name === name);
    if (inner !== undefined) {
      return {
        x: (child.transform?.x ?? 0) + (inner === child ? 0 : (inner.transform?.x ?? 0)),
        y: (child.transform?.y ?? 0) + (inner === child ? 0 : (inner.transform?.y ?? 0)),
      };
    }
  }
  throw new Error(`no ${name} in the button`);
}

describe('one button with an end cap', () => {
  const style: ButtonStyle = {
    ...OUTLINED,
    padding: { left: 30, right: 9 },
    trailing: { width: 132, fill: '#880000', radius: 27 },
  };
  const button: Button = {
    style,
    words: words(464),
    trailing: icon(ARROW_ICON, 36, '#ffffff', 'arrow'),
  };

  it('is as wide as its padding, words and end cap', () => {
    expect(buttonWidth(button)).toBe(30 + 464 + 9 + 132);
  });

  it('draws the cap at the right end, the arrow centred in it, and the outline on top', () => {
    const row = buttonRow([button], { gap: 0 });
    const [drawn] = named(row.draft, 'button');
    const [end] = named(drawn!, 'end');

    expect(end!.transform?.x).toBe(635 - 132);
    expect(end!.size).toEqual({ w: 132, h: 56 });
    expect(placeOf(drawn!, 'arrow')).toEqual({ x: 635 - 132 + (132 - 36) / 2, y: 10 });
    expect(drawn!.children?.map((child) => child.name ?? child.children?.[0]?.name)).toEqual([
      'end',
      'arrow',
      'outline',
      'words',
    ]);
  });

  it('starts the words after the left padding, centred on the pill’s height', () => {
    const [drawn] = named(buttonRow([button], { gap: 0 }).draft, 'button');

    expect(placeOf(drawn!, 'words')).toEqual({ x: 30, y: 16 });
  });
});

describe('three buttons with leading icons', () => {
  const filled: ButtonStyle = { ...OUTLINED, fill: '#880000' };
  const buttons: Button[] = [
    { style: OUTLINED, words: words(106), leading: icon(HEART_ICON, 36, '#880000', 'icon') },
    { style: filled, words: words(156), leading: icon(BALLOON_ICON, 36, '#ffffff', 'icon') },
    { style: OUTLINED, words: words(224), leading: icon(PAPER_PLANE_ICON, 36, '#880000', 'icon') },
  ];

  it('puts the icon after the padding and the words after the icon and the gap', () => {
    const [first] = named(buttonRow(buttons, { gap: 15 }).draft, 'button');

    expect(placeOf(first!, 'icon')).toEqual({ x: 30, y: 10 });
    expect(placeOf(first!, 'words')).toEqual({ x: 30 + 36 + 14, y: 16 });
  });

  it('packs the buttons gap apart and centres them in the room', () => {
    const natural = buttons.map(buttonWidth).reduce((sum, each) => sum + each, 0) + 2 * 15;
    const row = buttonRow(buttons, { gap: 15, width: natural + 100 });
    const xs = named(row.draft, 'button').map((_, index) => index);

    expect(row.width).toBe(natural + 100);
    expect(xs).toHaveLength(3);
    const first = (row.draft as Draft).children?.[0]?.transform?.x;
    expect(first).toBe(50);
  });

  it('spreads what is left between the buttons when justified', () => {
    const natural = buttons.map(buttonWidth).reduce((sum, each) => sum + each, 0) + 2 * 15;
    const row = buttonRow(buttons, { gap: 15, width: natural + 100, arrange: 'justified' });
    const placed = (row.draft as Draft).children ?? [];

    expect(placed[0]?.transform?.x ?? 0).toBe(0);
    expect((placed[2]?.transform?.x ?? 0) + buttonWidth(buttons[2]!)).toBeCloseTo(natural + 100);
  });

  it('fills only the button whose style has a fill', () => {
    const row = buttonRow(buttons, { gap: 15 });

    expect(named(row.draft, 'pill')).toHaveLength(1);
    expect(named(row.draft, 'outline')).toHaveLength(3);
  });
});

describe('the room', () => {
  it('reports a row wider than its room, by how much', () => {
    const reports: TemplateReport[] = [];
    buttonRow([{ style: OUTLINED, words: words(500) }], {
      gap: 0,
      width: 400,
      report: (report) => reports.push(report),
    });

    expect(reports).toEqual([{ code: 'W_TEMPLATE_OVERFLOW', overflow: 160 }]);
  });

  it('reports nothing for a row that fits', () => {
    const reports: TemplateReport[] = [];
    buttonRow([{ style: OUTLINED, words: words(100) }], {
      gap: 0,
      width: 400,
      report: (report) => reports.push(report),
    });

    expect(reports).toEqual([]);
  });
});

describe('icons', () => {
  it('scales an icon to its height and paints it in the caller’s colour, filled or stroked', () => {
    const arrow = icon(ARROW_ICON, 36, '#123456', 'arrow');
    const heart = icon(HEART_ICON, 36, '#123456', 'heart');

    expect([arrow.width, arrow.height]).toEqual([36, 36]);
    expect((arrow.draft as Draft).fill).toBeDefined();
    expect((arrow.draft as Draft).stroke).toBeUndefined();
    expect((heart.draft as Draft).stroke).toBeDefined();
    expect((heart.draft as Draft).fill).toBeUndefined();
  });
});
