import { describe, expect, it } from 'vitest';

import { callToComment } from './parts.js';
import { CTA } from './tokens.js';

import type { Inline } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';
import type { Measure } from '@tyto/template-kit';

/**
 * The call to comment's drawing, pinned (TYTO-880).
 *
 * `callToComment` hands its pill and balloon to the kit's `buttonRow`; before, it placed a
 * stroked rect, the words and the balloon by hand. A probe compared every leaf of the two
 * drawings, at its absolute place, for the three brands, grid and story, measured and not:
 * the same nodes at the same places, to the pixel. These files pin the new drawing, so a
 * change in `buttonRow` or in what the house hands it shows here. Update them on purpose, after
 * looking at a render.
 */

const WORDS: Inline[] = [
  { kind: 'text', value: 'Escreva SIMULADO nos comentários', range: { start: 0, end: 32 } },
];

/** 14 px a character, one line: the words as wide as they are. */
const measured: Measure = (node) => {
  const characters = node.runs.reduce(
    (sum, run) => sum + (run.kind === 'text' ? run.text.length : 0),
    0,
  );
  return {
    runs: node.runs,
    lines: 1,
    width: characters * 14,
    height: 30,
    scale: 1,
    overflow: 0,
  } as ReturnType<Measure>;
};

/** One line per node, indented by depth: its kind, its name, and everything else it carries. */
function outline(draft: NodeDraft, depth = 0): string[] {
  const { kind, name, ...rest } = draft as NodeDraft & { readonly name?: string };
  const { children, ...own } = rest as { children?: NodeDraft[] };
  const line = `${'  '.repeat(depth)}${kind} ${name ?? '-'} ${JSON.stringify(own)}`;
  return [line, ...(children ?? []).flatMap((child) => outline(child, depth + 1))];
}

type Draft = NodeDraft & {
  readonly name?: string;
  readonly children?: readonly Draft[];
  readonly size?: { readonly w: number; readonly h: number };
  readonly box?: { readonly w?: number };
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

const CASES: readonly (readonly [string, number, Measure])[] = [
  ['hugging', 900, measured],
  ['at-the-room', 400, measured],
  ['unmeasured', 900, () => undefined],
];

describe('the call to comment', () => {
  it.each(CASES)('draws the %s pill as pinned', async (name, width, measure) => {
    const drawn = callToComment(WORDS, '#880033', width, measure);
    await expect(`${outline(drawn.draft).join('\n')}\n`).toMatchFileSnapshot(
      `./__snapshots__/call-to-comment-${name}.txt`,
    );
  });

  it('hugs its words, and stands the balloon the gap to the pill’s right', () => {
    const drawn = callToComment(WORDS, '#880033', 900, measured);
    const [pill] = named(drawn.draft, 'cta-pill');
    const [balloon] = named(drawn.draft, 'cta-balloon');
    const [words] = named(drawn.draft, 'cta');
    const wide = 32 * 14 + CTA.padding * 2;

    expect(named(pill!, 'outline')[0]?.size).toEqual({ w: wide, h: CTA.height });
    expect(words?.box?.w).toBe(wide);
    expect((balloon as { transform: { x: number } }).transform.x).toBe(wide + CTA.balloonGap);
    expect(drawn.width).toBe(wide + CTA.balloonGap + CTA.balloon);
  });

  it('never runs past the room, the balloon included', () => {
    const drawn = callToComment(WORDS, '#880033', 400, measured);

    expect(drawn.width).toBe(400);
  });
});
