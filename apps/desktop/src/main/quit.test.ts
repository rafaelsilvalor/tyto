import { afterEach, describe, expect, it, vi } from 'vitest';

import { createExitGuard } from './quit.js';

/**
 * What this suite is for, and what it deliberately cannot reach.
 *
 * The guard is the whole of the decision — when to ask, when not to ask twice, what a stale
 * answer is worth, and what happens when nobody answers — and none of it needs Electron,
 * which is why `quit.ts` takes a `send` port instead of a `BrowserWindow`. What is *not* here
 * is that `index.ts` hooks both `close` and `before-quit` and that a real renderer answers:
 * that is `e2e/quit.desktop.test.ts`, and it is the only place it exists.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('createExitGuard', () => {
  it('prevents the exit and asks the window, exactly once', () => {
    const send = vi.fn(() => true);
    const guard = createExitGuard({ send });
    const resume = vi.fn();

    expect(guard.mayExit(resume)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(0);
    expect(resume).not.toHaveBeenCalled();
  });

  it('does not ask a second time while an answer is outstanding', () => {
    const send = vi.fn(() => true);
    const guard = createExitGuard({ send });

    expect(guard.mayExit(vi.fn())).toBe(false);
    // The X button fires `close` and then, through `window-all-closed`, `before-quit`. Two
    // dialogs for one click is the bug a naive "hook them both" ships.
    expect(guard.mayExit(vi.fn())).toBe(false);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('resumes the exit on a yes, and never asks again', () => {
    const send = vi.fn(() => true);
    const guard = createExitGuard({ send });
    const resume = vi.fn();

    guard.mayExit(resume);
    guard.answer(0, true);

    expect(resume).toHaveBeenCalledTimes(1);
    // The latch. Without it the `app.quit()` that `resume` just ran would come straight back
    // through this guard and ask the same person the same question on the way out.
    expect(guard.mayExit(vi.fn())).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('leaves the app running on a no, and asks again on the next attempt', () => {
    const send = vi.fn(() => true);
    const guard = createExitGuard({ send });
    const resume = vi.fn();

    guard.mayExit(resume);
    guard.answer(0, false);

    expect(resume).not.toHaveBeenCalled();
    // A refusal is about *this* attempt. A guard that latched on `no` would be an app that
    // could never be quit again without a restart.
    expect(guard.mayExit(vi.fn())).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(1);
  });

  it('ignores an answer to a question that is no longer outstanding', () => {
    const guard = createExitGuard({ send: () => true });
    const resume = vi.fn();

    guard.mayExit(vi.fn());
    guard.answer(0, false);
    guard.mayExit(resume);

    // The first question's `yes`, arriving late. Honouring it would release an exit the
    // person has been asked about a second time and has not answered.
    guard.answer(0, true);

    expect(resume).not.toHaveBeenCalled();
  });

  it('lets the exit through when there is no window to ask', () => {
    const send = vi.fn(() => false);
    const guard = createExitGuard({ send });

    // A renderer that is already gone cannot report a loss. An app that cannot be closed is
    // worse than the one it would have reported.
    expect(guard.mayExit(vi.fn())).toBe(true);
    // And it latches, so the hooks that follow do not each retry a window that is not there.
    expect(guard.mayExit(vi.fn())).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives up on a window that never acknowledged, which is the wedged case', () => {
    vi.useFakeTimers();
    const guard = createExitGuard({ send: () => true, ackTimeoutMs: 2000 });
    const resume = vi.fn();

    guard.mayExit(resume);
    expect(resume).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    // Nothing said it had the question, so there is nobody reading anything and an app that
    // could not be closed would be worse than the loss it would have reported.
    expect(resume).toHaveBeenCalledTimes(1);
    expect(guard.mayExit(vi.fn())).toBe(true);
  });

  it('does not fire the timeout after an answer has already arrived', () => {
    vi.useFakeTimers();
    const guard = createExitGuard({ send: () => true, ackTimeoutMs: 2000 });
    const resume = vi.fn();

    guard.mayExit(resume);
    guard.answer(0, true);
    vi.advanceTimersByTime(5000);

    // Twice would be `app.quit()` called against an app already on its way out.
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not quit later because of a timer left over from a refusal', () => {
    vi.useFakeTimers();
    const guard = createExitGuard({ send: () => true, ackTimeoutMs: 2000 });
    const resume = vi.fn();

    guard.mayExit(resume);
    guard.answer(0, false);
    vi.advanceTimersByTime(5000);

    // The window said no. An uncleared timer would close the app two seconds later, with the
    // person looking at the text they just chose to keep.
    expect(resume).not.toHaveBeenCalled();
  });
});

/**
 * The card, in one describe (TYTO-147, ADR 0031).
 *
 * The deadline used to cover the whole question — delivery *and* a person reading a box main
 * itself draws — so anybody who read before clicking had their tabs taken at two seconds. These
 * cases pin the two-stage shape that replaced it: the clock bounds the acknowledgement, the wait
 * after it has none, and a window that dies is what ends it.
 */
describe('the deadline is over the acknowledgement, not over the person', () => {
  it('waits with no deadline at all once the window has acknowledged', () => {
    vi.useFakeTimers();
    const guard = createExitGuard({ send: () => true, ackTimeoutMs: 2000 });
    const resume = vi.fn();

    guard.mayExit(resume);
    guard.acknowledge(0);

    // Ten minutes. There is no number a person reading a box can be held to, which is the
    // whole of the decision — the shipped bug is this assertion failing at two seconds.
    vi.advanceTimersByTime(600_000);
    expect(resume).not.toHaveBeenCalled();

    guard.answer(0, true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('ignores an acknowledgement for a question that is not the outstanding one', () => {
    vi.useFakeTimers();
    const guard = createExitGuard({ send: () => true, ackTimeoutMs: 2000 });
    const resume = vi.fn();

    guard.mayExit(resume);
    // A stale ack — from a question already refused, or from a window answering out of order.
    // Honouring it would disarm the deadline on a question nobody has actually received.
    guard.acknowledge(99);
    vi.advanceTimersByTime(2000);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('releases the exit when a window that acknowledged then dies', () => {
    vi.useFakeTimers();
    const guard = createExitGuard({ send: () => true, ackTimeoutMs: 2000 });
    const resume = vi.fn();

    guard.mayExit(resume);
    guard.acknowledge(0);
    vi.advanceTimersByTime(600_000);

    // The hang the no-deadline wait would otherwise create: `pending` stays set forever, and
    // `mayExit` refuses every later attempt while it is. A dead renderer's unsaved text is
    // already gone, so there is nothing left to protect by holding on.
    guard.windowGone();

    expect(resume).toHaveBeenCalledTimes(1);
    expect(guard.mayExit(vi.fn())).toBe(true);
  });

  it('does not latch when the window goes with no question outstanding', () => {
    const send = vi.fn(() => true);
    const guard = createExitGuard({ send });

    // Every ordinary quit reaches `closed` too, after `release` already cleared the question.
    // A `windowGone` that set the latch directly instead of delegating to `release` would make
    // the next quit skip the question entirely — TYTO-123's bug, restored, with a green suite.
    guard.windowGone();

    expect(guard.mayExit(vi.fn())).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
