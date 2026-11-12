import { describe, expect, it } from 'vitest';

import { applyChanges, blockAtLine, deleteBlock, moveBlock, recipeBlocks } from './blocks.js';
import { parseRecipe } from './parse.js';

const RECIPE = [
  'recipe weekly',
  '  | The week in tasks.',
  'param team = design',
  '',
  '# Pull the team, then tag.',
  '# Two lines of note.',
  'acme.pull team={team}',
  'acme.tag',
  '',
  'where status = done',
  'select key, status',
  '',
].join('\n');

const shape = (text: string) =>
  recipeBlocks(text).map((block) => [block.kind, block.firstLine, block.lastLine, block.step]);

describe('a recipe read as blocks (TYTO-676)', () => {
  it('reads a header, a note run, one block per step, and no blank line', () => {
    expect(shape(RECIPE)).toEqual([
      ['header', 1, 3, undefined],
      ['note', 5, 6, undefined],
      ['step', 7, 7, 0],
      ['step', 8, 8, 1],
      ['step', 10, 10, 2],
      ['step', 11, 11, 3],
    ]);
  });

  it("numbers the steps as the parser's cells", () => {
    const parsed = parseRecipe(RECIPE);
    expect(parsed.ok).toBe(true);
    const steps = recipeBlocks(RECIPE).filter((block) => block.kind === 'step');
    expect(steps.map((block) => RECIPE.slice(block.from, block.to))).toEqual(
      parsed.ok ? parsed.value.steps.map((step) => `${step.verb} ${step.text}`.trim()) : [],
    );
  });

  it('still reads blocks from a text that does not parse', () => {
    expect(shape('acme.pull\nwhere = =\n')).toEqual([
      ['step', 1, 1, 0],
      ['step', 2, 2, 1],
    ]);
  });

  it('finds the block holding a line, and none on a blank one', () => {
    const blocks = recipeBlocks(RECIPE);
    expect(blockAtLine(blocks, 6)?.kind).toBe('note');
    expect(blockAtLine(blocks, 4)).toBeUndefined();
  });

  it('ends a block before its line break, and before a \\r on Windows line ends', () => {
    const text = 'acme.pull\r\nacme.tag\r\n';
    expect(recipeBlocks(text).map((block) => text.slice(block.from, block.to))).toEqual([
      'acme.pull',
      'acme.tag',
    ]);
  });
});

describe('moving a block', () => {
  it('swaps it with the block above, leaving the blank lines where they were', () => {
    const edit = moveBlock(RECIPE, 4, 'up');
    expect(edit).toBeDefined();
    const after = applyChanges(RECIPE, edit?.changes ?? []);
    expect(after.split('\n').slice(6, 10)).toEqual([
      'acme.pull team={team}',
      'where status = done',
      '',
      'acme.tag',
    ]);
    expect(after.slice(edit?.at ?? 0).startsWith('where status = done')).toBe(true);
  });

  it('says where the block starts after a move down', () => {
    const edit = moveBlock(RECIPE, 2, 'down');
    const after = applyChanges(RECIPE, edit?.changes ?? []);
    expect(after.slice(edit?.at ?? 0).startsWith('acme.pull team={team}\n')).toBe(true);
  });

  it('never moves a header, nor a block past it', () => {
    expect(moveBlock(RECIPE, 0, 'down')).toBeUndefined();
    expect(moveBlock(RECIPE, 1, 'up')).toBeUndefined();
    expect(moveBlock(RECIPE, 5, 'down')).toBeUndefined();
  });

  // The property ADR 0195 rests on: the text stays the source, so a move changes nothing but
  // where two blocks' lines sit, whatever the blocks and whatever the line ends.
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
          // The block asked to move keeps its own line: the edit writes only its neighbour.
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
  it('takes its lines and the break after them', () => {
    const edit = deleteBlock(RECIPE, 1);
    const after = applyChanges(RECIPE, edit?.changes ?? []);
    expect(after).toBe(RECIPE.replace('# Pull the team, then tag.\n# Two lines of note.\n', ''));
  });

  it('takes the break before the last line when none follows it, \\r included', () => {
    for (const end of ['\n', '\r\n']) {
      const text = `acme.pull${end}acme.tag`;
      const edit = deleteBlock(text, 1);
      expect(applyChanges(text, edit?.changes ?? [])).toBe('acme.pull');
    }
  });

  it('never deletes the header', () => {
    expect(deleteBlock(RECIPE, 0)).toBeUndefined();
  });
});
