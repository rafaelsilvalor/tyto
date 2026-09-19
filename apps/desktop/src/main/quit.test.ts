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

  it('drops the question when nothing acknowledged, and does not quit on its way past', () => {
    vi.useFakeTimers();
    const guard = createExitGuard({ send: () => true, ackTimeoutMs: 2000 });
    const resume = vi.fn();

    guard.mayExit(resume);
    expect(resume).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    // **The deadline is not a vote.** Nothing acknowledged, so the app has no answer — and no
    // answer is not permission. The exit that was prevented is simply dropped and the window
    // keeps its text, because the only party entitled to trade a document for a closed app is
    // the person looking at the box (TYTO-147, ADR 0031).
    expect(resume).not.toHaveBeenCalled();
  });

  it('asks again on the next attempt after a question was dropped', () => {
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const guard = createExitGuard({ send, ackTimeoutMs: 2000 });

    guard.mayExit(vi.fn());
    vi.advanceTimersByTime(2000);

    // The latch has to come off with the question, or the dropped attempt would wedge every
    // later one: `mayExit` refuses while anything is outstanding. This is the whole reason the
    // deadline still exists now that it no longer decides anything.
    expect(guard.mayExit(vi.fn())).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('defaults the acknowledgement budget to thirty seconds', () => {
    // The composition root names no budget, so the default IS the product's behaviour. It is
    // generous on purpose: since running out only drops the question, no length of this timer
    // can cost a tab, and a short one buys nothing (TYTO-147, ADR 0031). Without this test the
    // default drifts back to a guess on a green suite, which is how two seconds got there.
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const guard = createExitGuard({ send });

    guard.mayExit(vi.fn());

    vi.advanceTimersByTime(29_999);
    expect(guard.mayExit(vi.fn())).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(guard.mayExit(vi.fn())).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
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
    const send = vi.fn(() => true);
    const guard = createExitGuard({ send, ackTimeoutMs: 2000 });
    const resume = vi.fn();

    guard.mayExit(resume);
    // A stale ack — from a question already refused, or from a window answering out of order.
    // Honouring it would disarm the deadline on a question nobody has actually received.
    guard.acknowledge(99);
    vi.advanceTimersByTime(2000);

    // The clock was not disarmed, so the question was dropped: a later attempt has to ask again.
    // `resume` is the assertion that matters as much — a dropped question is not permission.
    guard.mayExit(vi.fn());
    expect(send).toHaveBeenCalledTimes(2);
    expect(resume).not.toHaveBeenCalled();
  });

  it('keeps the question alive past the deadline once the right window acknowledged', () => {
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const guard = createExitGuard({ send, ackTimeoutMs: 2000 });

    guard.mayExit(vi.fn());
    // The contrast that gives the case above its force: the *outstanding* id disarms the clock,
    // so the question survives the deadline and a later attempt finds it still standing rather
    // than asking a person who is already reading.
    guard.acknowledge(0);
    vi.advanceTimersByTime(60_000);

    expect(guard.mayExit(vi.fn())).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
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
