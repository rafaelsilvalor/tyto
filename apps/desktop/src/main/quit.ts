/**
 * The latch that stands between a person and the loss of every unsaved tab (TYTO-123).
 *
 * Main cannot answer the question it is guarding. The workspace is the renderer's, `isUnsaved`
 * is a comparison computed from it rather than a flag anybody stores (ADR 0026), and the
 * language the question has to be asked in is whatever the footer picker last chose — which
 * main was told exactly once, at startup. So the exit is **prevented**, the window is asked,
 * and the answer releases or refuses it (ADR 0029).
 *
 * **No Electron import, on purpose.** `send` is the port — "the question was delivered" — and
 * `resume` is what to do once permission exists. That is what lets the whole of this
 * decision be unit-tested, leaving `index.ts` holding nothing but event hooks, which is
 * the arrangement `ipc.ts` and `credentials.ts` already have (ADR 0010).
 *
 * **The wait is in two stages, and only the first one has a clock** (TYTO-147, ADR 0031).
 * Delivering the question is machine work; answering it is a person reading a box that main
 * itself draws. A single deadline over both was a deadline over the reading, so it took the
 * text of anybody slower than it — which was the common case, not the wedged one. So the
 * deadline bounds `acknowledge` alone; after that the guard waits with no clock at all, and
 * `windowGone` is what releases it when there is no longer anybody to wait for.
 *
 * **One latch for two hooks, and that is the part worth reading twice.** The window's X
 * button and Cmd+Q are different doors: on win32 and linux the X destroys the renderer and
 * only then reaches `window-all-closed` → `app.quit()` → `before-quit`, so a guard on
 * `before-quit` alone would send its question to a webContents that is already gone, be told
 * nothing was delivered, and let the app out — a green suite and the original bug. Both are
 * hooked, and they share this object so that the second one to run finds the permission the
 * first one already got instead of asking again.
 */

export interface ExitGuardOptions {
  /**
   * Puts the question in front of the window, and says whether it arrived.
   *
   * `false` is "there is nobody to ask" — no window, or one whose renderer has already been
   * torn down. It is not an error and it does not veto: an app that cannot be quit is worse
   * than the loss it would have reported, and the caller has no other way out.
   */
  readonly send: (askId: number) => boolean;
  /**
   * How long an **unacknowledged** question holds the app open (TYTO-147, ADR 0031).
   *
   * What it bounds is a push reaching a listener that is already registered and one `invoke`
   * coming back: a window that has not said "I have it" by then is not slow, it is wedged, and
   * an app that cannot be closed is worse than the loss it would have reported.
   *
   * It is deliberately **not** how long an answer may take. That wait has no deadline, because
   * the thing on the other end of it is a person; ADR 0031 has the argument.
   *
   * **Five seconds, and the first number tried was two.** The round trip measures 0-2 ms on an
   * idle machine and 44 ms at the worst of twenty, so two seconds looked like 45x headroom. It
   * was not: the end-to-end case that answers slower than the deadline failed **3 of 13 runs**
   * against a built app, every failure the app exiting at ~2.02 s — the clock running on time
   * and the acknowledgement simply not back yet. A budget that a real launch misses about a
   * fifth of the time is the card's own bug with a smaller window, so the budget moved rather
   * than the test. Five seconds is ~113x the worst round trip measured, and the only thing it
   * costs is three more seconds before a genuinely wedged window lets the app go.
   *
   * **What it can honestly measure is narrower than the wording suggests, and ADR 0031 records
   * the gap.** This is a `setTimeout` on *main's* event loop, so a main process blocked past the
   * deadline runs `release` the moment it is free with the window's acknowledgement queued
   * behind it, unread — measured against the built app: block main for longer than the deadline
   * and it quits with the renderer answering normally.
   */
  readonly ackTimeoutMs?: number;
}

export interface ExitGuard {
  /**
   * Whether the exit may proceed, and what to run once it may.
   *
   * `true` means go; `false` means the caller must `event.preventDefault()`. `resume` is
   * called later, from the answer, and only on the path that did not already return `true`.
   */
  mayExit: (resume: () => void) => boolean;
  /**
   * The window saying it has the question, arriving on `app:exit-ack` (TYTO-147, ADR 0031).
   *
   * It proves one thing and it is the only thing the deadline was ever able to measure
   * honestly: JS in that window is running and has been handed the question. Receiving it
   * stops the clock; what follows is a person's and is not timed.
   */
  acknowledge: (askId: number) => void;
  /** The renderer's answer, arriving on `app:exit-answer`. */
  answer: (askId: number, allow: boolean) => void;
  /**
   * There is no longer a window to wait for (TYTO-147, ADR 0031).
   *
   * Wired in the composition root to `render-process-gone`, to the window's `closed`, and to a
   * main-frame navigation — a reload keeps the process and throws away the page that had the
   * question, which is a death this file cannot tell apart from the others and must not miss.
   * Since the wait after an acknowledgement has no deadline, this is what keeps a window that
   * died mid-question from holding the app open forever *and* refusing every later quit —
   * `mayExit` returns `false` for as long as a question is outstanding. The unsaved text of a
   * page that is gone is gone with it, so there is nothing left here to protect.
   */
  windowGone: () => void;
}

export function createExitGuard({ send, ackTimeoutMs = 5000 }: ExitGuardOptions): ExitGuard {
  /**
   * Permission, once given, is not asked for again.
   *
   * This is what stops the X button asking twice on its way through `close` →
   * `window-all-closed` → `app.quit()` → `before-quit`: the second hook finds the answer the
   * first one got. It is never set back to false — a released exit is on its way out, and a
   * guard that could change its mind mid-teardown would be asking a window that is closing.
   */
  let confirmed = false;
  let nextAskId = 0;
  /**
   * The one question outstanding, if any. One window, one exit, one question.
   *
   * `timer` is `undefined` once the window has acknowledged: that is the whole representation
   * of stage two, and it is the same field rather than a second flag so that "the clock is
   * running" and "the clock has been stopped" cannot disagree.
   */
  let pending:
    | { askId: number; resume: () => void; timer: ReturnType<typeof setTimeout> | undefined }
    | undefined;

  /** Stops whatever clock is running, if one still is. Safe after an acknowledgement. */
  const disarm = (outstanding: { timer: ReturnType<typeof setTimeout> | undefined }): void => {
    if (outstanding.timer !== undefined) clearTimeout(outstanding.timer);
  };

  const release = (): void => {
    const outstanding = pending;
    if (outstanding === undefined) return;
    disarm(outstanding);
    pending = undefined;
    confirmed = true;
    outstanding.resume();
  };

  return {
    mayExit: (resume) => {
      if (confirmed) return true;
      // A question is already in front of the person. Prevent, and do not ask a second time:
      // two hooks fire for one X button, and two dialogs for one click is the bug a naive
      // "hook them both" would ship.
      if (pending !== undefined) return false;

      const askId = nextAskId++;
      if (!send(askId)) {
        // Nobody to ask. Latch anyway, so the hooks that follow this one do not each retry a
        // window that is not there.
        confirmed = true;
        return true;
      }

      pending = {
        askId,
        resume,
        timer: setTimeout(release, ackTimeoutMs),
      };
      return false;
    },

    acknowledge: (askId) => {
      // The id is checked for `answer`'s reason: a stale ack, from a question the person has
      // since refused, must not disarm the deadline on the one they have not yet been asked.
      // A duplicate for the *current* id is harmless and lands here as `disarm` finding no
      // clock, which is why the timer is the representation and not a second flag.
      if (pending === undefined || pending.askId !== askId) return;

      disarm(pending);
      pending = { ...pending, timer: undefined };
    },

    windowGone: () => {
      // Deliberately `release` and not `confirmed = true`. With nothing outstanding — which is
      // every ordinary quit, since `release` cleared `pending` before the window went — this
      // returns early and changes nothing. Setting the latch directly here would mean the next
      // quit asked nobody, which is the bug TYTO-123 exists to have closed.
      release();
    },

    answer: (askId, allow) => {
      // An id that is not the outstanding one is an answer to a question that was already
      // resolved — by a timeout, or by a refusal the person has since typed past. Honouring
      // it would let a stale yes release an exit somebody has not been asked about yet.
      if (pending === undefined || pending.askId !== askId) return;

      if (allow) {
        release();
        return;
      }

      disarm(pending);
      pending = undefined;
      // `confirmed` deliberately stays false: a no is about *this* attempt. Quitting again
      // asks again, which is what makes the refusal a pause rather than a permanent veto.
    },
  };
}
