import { type TytoBridge } from '../../shared/ipc.js';

/**
 * What the window writes down when something in it breaks (TYTO-132).
 *
 * The renderer is a separate process with its own failures, and until now none of them left a
 * trace anywhere: a throw during a paint, a rejected `file:save`, a listener that blew up on a
 * locale it did not have — all of them ended in the page's own console, which a packaged app
 * has nobody reading.
 *
 * **An ordinary question and not a push.** ADR 0029 gave main a way to speak first, and this
 * is not it: the renderer is the side that *has* the failure, so `log:write` travels the
 * direction the bridge always had.
 *
 * **Truncated here as well as capped in the contract, and the two are not the same job.** The
 * contract's 200 and 4000 are what make "no brief text reaches the log" mechanical — a brief
 * physically cannot cross. Truncating here is so an honest report of a long stack is *written*
 * rather than refused: without it, the one failure with the most to say would be the one the
 * contract threw away.
 */

/** The contract's caps, mirrored so a long report is shortened rather than rejected. */
const MESSAGE_LIMIT = 200;
const DETAIL_LIMIT = 4000;

const clip = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

/** Whatever was thrown, as something worth a line. */
function describe(reason: unknown): { message: string; detail?: string } {
  if (reason instanceof Error) {
    return {
      message: clip(`${reason.name}: ${reason.message}`, MESSAGE_LIMIT),
      ...(reason.stack === undefined ? {} : { detail: clip(reason.stack, DETAIL_LIMIT) }),
    };
  }
  const text = typeof reason === 'string' ? reason : String(reason);
  // `min(1)` on the contract, so an empty reason still has to say something — and "nothing was
  // thrown" is itself the interesting part of that report.
  return { message: clip(text === '' ? 'unknown renderer failure' : text, MESSAGE_LIMIT) };
}

/**
 * One line in the log, for a failure somebody already handled (TYTO-153).
 *
 * Exported because a caught failure is now a real case rather than a contradiction. `save`
 * used to re-throw so that the listener below would file it, which worked while a failed save
 * was nobody's answer; it is an answer now — the quit question's **Sim** cancels the exit on
 * one — and a caller that has to know the outcome cannot be handed an exception to let past.
 * So the report is made directly, and what the listeners do is call this too.
 *
 * No bridge is a real state and not a defensive branch: every unit test in `src/renderer` runs
 * with no preload at all, and so does this window's own first paint.
 */
export function reportToLog(bridge: TytoBridge | undefined, reason: unknown, kind: string): void {
  if (bridge === undefined) return;

  const { message, detail } = describe(reason);
  // The send is fire-and-forget **and its own rejection is swallowed**. A logger that throws
  // from inside an error handler is a loop, and the thing that just failed is the thing that
  // would have reported it.
  void bridge['log:write']({
    level: 'error',
    message: `${kind}: ${message}`.slice(0, MESSAGE_LIMIT),
    ...(detail === undefined ? {} : { detail }),
  }).catch(() => undefined);
}

export function installErrorReporting(target: Window, bridge: TytoBridge | undefined): void {
  if (bridge === undefined) return;

  target.addEventListener('error', (event: ErrorEvent) => {
    reportToLog(bridge, event.error ?? event.message, 'renderer error');
  });

  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportToLog(bridge, event.reason, 'renderer rejection');
  });
}
