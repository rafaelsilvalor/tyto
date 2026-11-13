import { describe, expect, it } from 'vitest';

import {
  applyChanges,
  blockAtLine,
  deleteBlock,
  moveBlock,
  recipeBlocks,
  recipeLines,
} from './blocks.js';
import { parseRecipe } from './parse.js';

const RECIPE = [
  'recipe weekly',
  '  | The week in tasks.',
  'param team = design',
  '',
  '# Pull the team, then tag.',
  '# Two lines of note.',
  '',
  'acme.pull team={team}',
  'acme.tag',
  '',
  '# keep the done ones',
  'where status = done',
  'select key, status',
  '',
].join('\n');

const shape = (text: string) =>
  recipeBlocks(text).map((block) => [
    block.kind,
    block.firstLine,
    block.lastLine,
    block.steps === undefined ? undefined : [block.steps.first, block.steps.last],
  ]);

describe('a recipe read as blocks (TYTO-676, ADR 0196)', () => {
  it('reads a block between blank lines: a header, a note, and blocks of several steps', () => {
    expect(shape(RECIPE)).toEqual([
      ['header', 1, 3, undefined],
      ['note', 5, 6, undefined],
      ['step', 8, 9, [0, 1]],
      ['step', 11, 13, [2, 3]],
    ]);
  });

  it("says where a block's last step starts, the line its result goes under", () => {
    const blocks = recipeBlocks(RECIPE);
    expect(blocks.map((block) => block.steps?.lastFrom)).toEqual([
      undefined,
      undefined,
      RECIPE.indexOf('acme.tag'),
      RECIPE.indexOf('select key'),
    ]);
  });

  it('splits the header from a step written right under it, with no blank line', () => {
    expect(shape('recipe x\nparam a = 1\nacme.pull\nacme.tag\n')).toEqual([
      ['header', 1, 2, undefined],
      ['step', 3, 4, [0, 1]],
    ]);
  });

  it('reads a run of param lines further down as a header block, which nothing moves', () => {
    const text = 'recipe x\n\nacme.pull\n\nparam b = 2\n\nacme.tag\n';
    expect(shape(text).map(([kind]) => kind)).toEqual(['header', 'step', 'header', 'step']);
    expect(moveBlock(text, 3, 'up')).toBeUndefined();
  });

  it('reads a param line inside a block as a line of that block, and still as a header line', () => {
    const text = 'recipe x\n\nacme.pull\nparam b = 2\nacme.tag\n';
    expect(shape(text)).toEqual([
      ['header', 1, 1, undefined],
      ['step', 3, 5, [0, 1]],
    ]);
    const header = recipeLines(text, 'header').map((line) => text.slice(line.from, line.to));
    expect(header).toEqual(['recipe x', 'param b = 2']);
    const steps = recipeLines(text, 'step').map((line) => text.slice(line.from, line.to));
    expect(steps).toEqual(['acme.pull', 'acme.tag']);
  });

  it("numbers the steps as the parser's cells", () => {
    const parsed = parseRecipe(RECIPE);
    expect(parsed.ok).toBe(true);
    const blocks = recipeBlocks(RECIPE).filter((block) => block.kind === 'step');
    expect(blocks.at(-1)?.steps?.last).toBe(parsed.ok ? parsed.value.steps.length - 1 : -1);
  });

  it('still reads blocks from a text that does not parse', () => {
    expect(shape('acme.pull\nwhere = =\n\nselect a\n')).toEqual([
      ['step', 1, 2, [0, 1]],
      ['step', 4, 4, [2, 2]],
    ]);
  });

  it('finds the block holding a line, and none on a blank one', () => {
    const blocks = recipeBlocks(RECIPE);
    expect(blockAtLine(blocks, 12)?.firstLine).toBe(11);
    expect(blockAtLine(blocks, 7)).toBeUndefined();
  });

  it('ends a block before its line break, and before a \\r on Windows line ends', () => {
    const text = 'acme.pull\r\nacme.tag\r\n\r\nselect a\r\n';
    expect(recipeBlocks(text).map((block) => text.slice(block.from, block.to))).toEqual([
      'acme.pull\r\nacme.tag',
      'select a',
    ]);
  });
});

describe('moving a block', () => {
  it('swaps a whole block with the one above, leaving the blank line between them', () => {
    const edit = moveBlock(RECIPE, 3, 'up');
    const after = applyChanges(RECIPE, edit?.changes ?? []);
    expect(after.split('\n').slice(4, 13)).toEqual([
      '# Pull the team, then tag.',
      '# Two lines of note.',
      '',
      '# keep the done ones',
      'where status = done',
      'select key, status',
      '',
      'acme.pull team={team}',
      'acme.tag',
    ]);
    expect(after.slice(edit?.at ?? 0).startsWith('# keep the done ones\n')).toBe(true);
  });

  it('says where the block starts after a move down', () => {
    const edit = moveBlock(RECIPE, 2, 'down');
    const after = applyChanges(RECIPE, edit?.changes ?? []);
    expect(after.slice(edit?.at ?? 0).startsWith('acme.pull team={team}\nacme.tag\n')).toBe(true);
  });

  it('never moves a header, nor a block past it', () => {
    expect(moveBlock(RECIPE, 0, 'down')).toBeUndefined();
    expect(moveBlock(RECIPE, 1, 'up')).toBeUndefined();
    expect(moveBlock(RECIPE, 3, 'down')).toBeUndefined();
  });

  // The property ADR 0195 rests on, for blocks of several lines (ADR 0196): a move changes
  // nothing but where two blocks' lines sit, whatever the blocks and whatever the line ends.
  it('keeps every line and every byte outside the two blocks, for every move', () => {
    for (const text of [RECIPE, RECIPE.replaceAll('\n', '\r\n'), RECIPE.trimEnd()]) {
      const blocks = recipeBlocks(text);
      for (let index = 0; index < blocks.length; index += 1) {
        for (const direction of ['up', 'down'] as const) {
          const edit = moveBlock(text, index, direction);
          if (edit === undefined) continue;
          const after = applyChanges(text, edit.changes);
          expect(after.length).toBe(text.length);
          expect([...after.split('\n')].sort()).toEqual([...text.split('\n')].sort());
          const first = Math.min(...edit.changes.map((change) => change.from));
          const last = Math.max(...edit.changes.map((change) => change.to));
          expect(after.slice(0, first)).toBe(text.slice(0, first));
          expect(after.slice(last)).toBe(text.slice(last));
          // The block asked to move keeps its own lines: the edit writes only its neighbour.
          const moved = recipeBlocks(text)[index];
          const kept = text.slice(moved?.from, moved?.to);
          for (const change of edit.changes) {
            expect(change.from >= (moved?.to ?? 0) || change.to <= (moved?.from ?? 0)).toBe(true);
          }
          expect(after.slice(edit.at, (edit.at ?? 0) + kept.length)).toBe(kept);
          // Moving it back gives the text it came from.
          const back = recipeBlocks(after).findIndex((block) => block.from === edit.at);
          const undo = moveBlock(after, back, direction === 'up' ? 'down' : 'up');
          expect(applyChanges(after, undo?.changes ?? [])).toBe(text);
        }
      }
    }
  });
});

describe('deleting a block', () => {
  it('takes all its lines and the blank line after them, one still parting the others', () => {
    const edit = deleteBlock(RECIPE, 2);
    const after = applyChanges(RECIPE, edit?.changes ?? []);
    expect(after).toBe(RECIPE.replace('acme.pull team={team}\nacme.tag\n\n', ''));
  });

  it('takes the last block with the blank line before it, \\r included', () => {
    expect(applyChanges(RECIPE, deleteBlock(RECIPE, 3)?.changes ?? [])).toBe(
      RECIPE.replace('\n\n# keep the done ones\nwhere status = done\nselect key, status', ''),
    );
    for (const end of ['\n', '\r\n']) {
      const text = `acme.pull${end}${end}acme.tag`;
      const edit = deleteBlock(text, 1);
      expect(applyChanges(text, edit?.changes ?? [])).toBe('acme.pull');
    }
  });

  it('takes a lone block with the break after it', () => {
    const text = 'acme.pull\nacme.tag\n';
    expect(applyChanges(text, deleteBlock(text, 0)?.changes ?? [])).toBe('');
  });

  it('never deletes the header', () => {
    expect(deleteBlock(RECIPE, 0)).toBeUndefined();
  });
});
