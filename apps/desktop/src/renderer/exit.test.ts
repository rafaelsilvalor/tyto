import { describe, expect, it, vi } from 'vitest';

import { type ExitAnswer, type SaveOutcome, resolveExit } from './exit.js';

/**
 * The three buttons and what each one is worth (TYTO-153).
 *
 * Reachable as a unit because `resolveExit` takes its workspace, its dialog and its disk as
 * functions — the arrangement `src/main/quit.ts` has on the other side of the same question.
 * What the end-to-end suite adds is that the three processes are wired to each other; what
 * this file holds is that a dismissed picker is not a save, which is a branch no dialog stub
 * in a launched app makes convenient to reach.
 */

const question = (
  unsaved: readonly string[],
  answer: ExitAnswer,
  saves: readonly SaveOutcome[] = [],
) => {
  const queue = [...saves];
  return {
    unsaved: () => unsaved,
    ask: vi.fn<(count: number) => Promise<ExitAnswer>>(() => Promise.resolve(answer)),
    save: vi.fn<(documentId: string) => Promise<SaveOutcome>>(() =>
      Promise.resolve(queue.shift() ?? 'saved'),
    ),
  };
};

describe('resolveExit', () => {
  it('lets the app go without asking when nothing is unsaved', async () => {
    const asked = question([], 'cancel');

    expect(await resolveExit(asked)).toBe(true);
    // The branch and not a box with a trivial answer: a question on every quit is what
    // teaches somebody to click past the one that matters.
    expect(asked.ask).not.toHaveBeenCalled();
  });

  it('names the count to the box, because the box is what says what would be lost', async () => {
    const asked = question(['a', 'b', 'c'], 'discard');

    await resolveExit(asked);

    expect(asked.ask.mock.calls).toEqual([[3]]);
  });

  it('stays on a cancel, with nothing written', async () => {
    const asked = question(['a'], 'cancel');

    expect(await resolveExit(asked)).toBe(false);
    expect(asked.save).not.toHaveBeenCalled();
  });

  it('goes on a discard, with nothing written', async () => {
    const asked = question(['a', 'b'], 'discard');

    expect(await resolveExit(asked)).toBe(true);
    expect(asked.save).not.toHaveBeenCalled();
  });

  it('writes every dirty tab on a save, in tab order, and then goes', async () => {
    const asked = question(['a', 'b', 'c'], 'save');

    expect(await resolveExit(asked)).toBe(true);
    expect(asked.save.mock.calls).toEqual([['a'], ['b'], ['c']]);
  });

  it('cancels the quit when a save fails, and stops at the one that failed', async () => {
    const asked = question(['a', 'b', 'c'], 'save', ['saved', 'failed']);

    // **The card's fourth criterion.** Going anyway would be the app discarding the other two
    // tabs on behalf of somebody who had just asked for them to be kept.
    expect(await resolveExit(asked)).toBe(false);
    expect(asked.save.mock.calls).toEqual([['a'], ['b']]);
  });

  it('cancels the quit when the Save-As picker is dismissed', async () => {
    const asked = question(['a', 'b'], 'save', ['dismissed']);

    // Dismissing a picker is how somebody changes their mind halfway through an answer. It is
    // not a failure and it is not a save, and only the middle one of those three would be
    // grounds to quit.
    expect(await resolveExit(asked)).toBe(false);
    expect(asked.save.mock.calls).toEqual([['a']]);
  });

  it('asks one question for the whole quit, however many tabs are dirty', async () => {
    const asked = question(['a', 'b', 'c'], 'save');

    await resolveExit(asked);

    // One box and three pickers, rather than three boxes and three pickers — the decision the
    // card took over asking per document.
    expect(asked.ask).toHaveBeenCalledTimes(1);
  });
});
