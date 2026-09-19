import type { ElectronApplication } from 'playwright';

/**
 * Shut a test app down, answering the quit question on the way out (TYTO-147, ADR 0031).
 *
 * **Every suite here used to rely on a two-second timeout without saying so.** `app.close()`
 * asks Electron to quit, the exit guard prevents it and asks the window, and the window draws an
 * OS message box — under `xvfb`, in front of nobody. Until TYTO-147 that box was overruled two
 * seconds later and the app went; the suites closed cleanly and the reliance was invisible.
 *
 * ADR 0031 took that timeout away on purpose: a clock may no longer decide to discard somebody's
 * text. So a close with unsaved tabs now waits for an answer that never comes, and five suites
 * proved it by each burning the full 300 s hook timeout in CI —
 * `command-bar`, `documents`, `log`, `panel` and `preview`, with 108 of 108 assertions passing
 * and only the teardown hanging.
 *
 * This makes the reliance explicit: a suite that is not about quitting says, in one call, that
 * it would have clicked _discard_. That is the honest form of what it was already getting.
 *
 * **`quit.desktop.test.ts` does not use this**, and must not: answering the box is the thing it
 * measures, so it installs its own stubs and times them deliberately.
 *
 * The stub is installed from main, the same seam the quit suite uses and for its reason:
 * `app.evaluate` runs with the `electron` module in scope, so nothing in the shipped code has to
 * grow a hook for the tests. `response: 1` is the confirm button — `index.ts` builds the box as
 * `buttons: [cancel, confirm]`.
 */
export async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  if (app === undefined) return;

  // A window already gone is the ordinary case for a suite that closed it itself, and an
  // evaluate against it rejects. That is not a failure of the teardown, so it is swallowed here
  // rather than left to fail a suite whose assertions have all already run.
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = ((): Promise<unknown> =>
        Promise.resolve({ response: 1, checkboxChecked: false })) as never;
    });
  } catch {
    // Nothing to answer: either the app is already down, or it never drew a box.
  }

  await app.close();
}

// TYTO-154 baseline probe — throwaway branch, not for merge.
