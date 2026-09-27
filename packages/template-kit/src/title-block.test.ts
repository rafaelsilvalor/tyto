import { systemFont } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { rich } from './rich-text.fixture.js';
import { type TitleBlockStyle, titleBlock } from './title-block.js';

import type { AssetRef } from '@tyto/core';
import type { GroupDraft, NodeDraft } from '@tyto/core/template';
import type { TextStyle } from './text.js';

/**
 * The title block's arithmetic: which pieces are drawn, where each lands, and how tall the
 * block says it is. The pixels are proven by rendering the agenda's cover and the approved
 * list's title (TYTO-185).
 */

const STYLE: TextStyle = { font: systemFont('Test'), size: 20, weight: 400, color: '#000000' };

const ASSET = { kind: 'file', path: 'emblem.png' } as unknown as AssetRef;

const WIDTH = 800;

const FULL: TitleBlockStyle = {
  name: 'title',
  parts: [
    { kind: 'image', field: 'emblem', name: 'emblem', size: { w: 200, h: 100 } },
    { kind: 'text', field: 'kicker', name: 'kicker', style: STYLE, height: 30, gapAbove: 10 },
    { kind: 'rule', name: 'rule', width: 500, thickness: 3, color: '#333333', gapAbove: 15 },
    { kind: 'text', field: 'title', name: 'title-words', style: STYLE, height: 80, gapAbove: 20 },
  ],
};

function children(draft: NodeDraft): readonly NodeDraft[] {
  expect(draft.kind).toBe('group');
  return (draft as GroupDraft).children;
}

const layout = (draft: NodeDraft) =>
  children(draft).map((child) => ({
    name: child.name,
    x: child.transform.x,
    y: child.transform.y,
  }));

describe('titleBlock', () => {
  it('stacks every piece, centred, with the gap above each one after the first', () => {
    const block = titleBlock(FULL, {
      width: WIDTH,
      fields: { emblem: ASSET, kicker: rich('Resultado'), title: rich('CADAR') },
    });

    expect(layout(block.draft)).toEqual([
      { name: 'emblem', x: 300, y: 0 },
      { name: 'kicker', x: 0, y: 110 },
      { name: 'rule', x: 150, y: 155 },
      { name: 'title-words', x: 0, y: 178 },
    ]);
    expect(block.height).toBe(258);
  });

  it('leaves out a piece the brief left empty, and the gap above it', () => {
    const block = titleBlock(FULL, {
      width: WIDTH,
      fields: { kicker: rich('A'), title: rich('B') },
    });

    expect(layout(block.draft).map((each) => [each.name, each.y])).toEqual([
      ['kicker', 0],
      ['rule', 45],
      ['title-words', 68],
    ]);
  });

  it('leaves out a rule with nothing drawn on one side of it', () => {
    const block = titleBlock(FULL, { width: WIDTH, fields: { emblem: ASSET, kicker: rich('A') } });

    expect(layout(block.draft).map((each) => each.name)).toEqual(['emblem', 'kicker']);
  });

  it('draws nothing, and takes no room, when every field is empty', () => {
    const block = titleBlock(FULL, { width: WIDTH, fields: {} });

    expect(block.height).toBe(0);
    expect(children(block.draft)).toEqual([]);
  });
});
