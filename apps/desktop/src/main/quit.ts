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
 * decision be unit-tested, leaving `index.ts` holding nothing but two event hooks, which is
 * the arrangement `ipc.ts` and `credentials.ts` already have (ADR 0010).
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
   * How long an unanswered question holds the app open.
   *
   * It resolves towards quitting, which is the one place this guard can still lose work, and
   * it is a deliberate trade rather than an oversight — see ADR 0029. Two seconds because the
   * renderer's part is a filter over an array and an OS dialog: a window that has not answered
   * by then is not slow, it is wedged.
   */
  readonly timeoutMs?: number;
}

export interface ExitGuard {
  /**
   * Whether the exit may proceed, and what to run once it may.
   *
   * `true` means go; `false` means the caller must `event.preventDefault()`. `resume` is
   * called later, from the answer, and only on the path that did not already return `true`.
   */
  mayExit: (resume: () => void) => boolean;
  /** The renderer's answer, arriving on `app:exit-answer`. */
  answer: (askId: number, allow: boolean) => void;
}

export function createExitGuard({ send, timeoutMs = 2000 }: ExitGuardOptions): ExitGuard {
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
  /** The one question outstanding, if any. One window, one exit, one question. */
  let pending:
    { askId: number; resume: () => void; timer: ReturnType<typeof setTimeout> } | undefined;

  const release = (): void => {
    const outstanding = pending;
    if (outstanding === undefined) return;
    clearTimeout(outstanding.timer);
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
        timer: setTimeout(release, timeoutMs),
      };
      return false;
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

      clearTimeout(pending.timer);
      pending = undefined;
      // `confirmed` deliberately stays false: a no is about *this* attempt. Quitting again
      // asks again, which is what makes the refusal a pause rather than a permanent veto.
    },
  };
}
