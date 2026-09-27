import { describe, expect, it, vi } from 'vitest';

import { isUnsaved, newDocument, workspaceOf } from './documents.js';
import { type ExitAnswer, type SaveOutcome, listenForExit, resolveExit } from './exit.js';

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

/**
 * The listener is registered first in `load()`, before anything is awaited, so it must work
 * against a window that has done nothing else yet (TYTO-44, ADR 0039).
 */
describe('listenForExit', () => {
  const channel = () => {
    const calls: string[] = [];
    let handler: ((askId: number) => void) | undefined;
    return {
      calls,
      push: (askId: number) => handler?.(askId),
      onRequest: (next: (askId: number) => void) => {
        calls.push('onRequest');
        handler = next;
      },
      acknowledge: (askId: number) => calls.push(`ack ${String(askId)}`),
      listening: () => calls.push('listening'),
    };
  };

  it('says it is listening only after the listener exists', () => {
    const port = channel();

    listenForExit(port, () => Promise.resolve());

    expect(port.calls).toEqual(['onRequest', 'listening']);
  });

  it('acknowledges before it starts to answer', () => {
    const port = channel();
    const answer = vi.fn((askId: number) => {
      port.calls.push(`answer ${String(askId)}`);
      return Promise.resolve();
    });
    listenForExit(port, answer);

    port.push(3);

    expect(port.calls.slice(2)).toEqual(['ack 3', 'answer 3']);
  });

  it('lets the app go when the only document is the untitled one the window starts with', async () => {
    // Exactly the workspace `main.ts` holds at module load, before `load()` has awaited
    // anything: one document with no editor state yet. A push answered this early must count
    // it as clean and let the quit through without asking — and `ask` is where every
    // translated string lives, so not reaching it is also what keeps this path off `state`.
    const workspace = workspaceOf(newDocument('document-1'));
    const asked = question(
      workspace.documents.filter(isUnsaved).map((document_) => document_.id),
      'cancel',
    );

    expect(await resolveExit(asked)).toBe(true);
    expect(asked.ask).not.toHaveBeenCalled();
  });
});
