import { _electron } from 'playwright';

/**
 * Every end-to-end launch runs with unlimited frames (TYTO-341, ADR 0104).
 *
 * **Why.** The suites launch with `TYTO_HEADLESS=1`, and a window created with `show: false`
 * paints about one frame a second. Playwright waits for the renderer to handle the input it
 * sends, and the renderer handles input once a frame: a held mouse step, a wheel, a key typed
 * into CodeMirror each cost up to a second. `--disable-frame-rate-limit` takes that wait away.
 * On CI it was measured on four suites first and then on all of them: summed over every file,
 * 1,152 s with the four and 708 s with every suite (TYTO-291).
 *
 * **Why every launch and not the slow suites only.** Most suites wait on frames somewhere, so
 * the per-file switch left most of the gain behind. It was held back from the rest because it
 * turned a vim test red; that was a product bug, Escape taken by a completion nobody could
 * see, fixed in TYTO-331. A red the switch exposes now is a race in the app or the test, not a
 * reason to launch slower.
 *
 * **Why the harness and not the app.** The switch is a Chromium command-line switch that only
 * this wrapper passes. Nothing under `src` reads or sets it, so the packaged app is unchanged.
 * A launch that names the switch itself is left as it is.
 */

/** The Chromium switch, as `_electron.launch` passes it on the command line. */
export const UNLIMITED_FRAMES_SWITCH = '--disable-frame-rate-limit';

// Once per process, as `not-a-first-launch.setup.ts` wraps it: a worker that runs several
// files sees the same `_electron` each time.
const WRAPPED = Symbol.for('tyto.e2e.unlimitedFrames');
const target = _electron as typeof _electron & { [WRAPPED]?: true };
if (target[WRAPPED] !== true) {
  const launch = _electron.launch.bind(_electron);
  target.launch = (options) => {
    const args = options?.args ?? [];
    if (args.includes(UNLIMITED_FRAMES_SWITCH)) return launch(options);
    return launch({ ...options, args: [...args, UNLIMITED_FRAMES_SWITCH] });
  };
  target[WRAPPED] = true;
}
