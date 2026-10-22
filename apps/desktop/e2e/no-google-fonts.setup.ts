import { _electron } from 'playwright';

/**
 * No end-to-end suite reaches Google Fonts unless it means to (TYTO-281, ADR 0120).
 *
 * The window asks Google for a template's face this machine lacks, on by default. A suite that
 * opened a brief in a Google family would fetch it for real: from CI that is a network the run
 * does not own, and an answer that changes when Google's file does. So every launch here gets
 * `TYTO_GOOGLE_FONTS=off`, and so does every CLI a suite runs with this process's environment,
 * **unless the launch names the variable itself** — the one suite that tests the feature says
 * `on` and points the window at a server of its own with `TYTO_GOOGLE_FONTS_BASE`.
 */

const SWITCH = 'TYTO_GOOGLE_FONTS';

process.env[SWITCH] ??= 'off';

// Once per process, as `not-a-first-launch.setup.ts` wraps it: a worker that runs several
// files sees the same `_electron` each time.
const WRAPPED = Symbol.for('tyto.e2e.noGoogleFonts');
const target = _electron as typeof _electron & { [WRAPPED]?: true };
if (target[WRAPPED] !== true) {
  const launch = _electron.launch.bind(_electron);
  target.launch = (options) => {
    // No `env` is Playwright's "this process's", which the line above already covers.
    const env = options?.env;
    if (options === undefined || env === undefined || env[SWITCH] !== undefined) {
      return launch(options);
    }
    return launch({ ...options, env: { ...env, [SWITCH]: 'off' } });
  };
  target[WRAPPED] = true;
}
