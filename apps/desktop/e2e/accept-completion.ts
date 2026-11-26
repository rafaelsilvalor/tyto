import type { Page } from 'playwright';

/**
 * Accepting an editor completion with Enter, as a person does (TYTO-898).
 *
 * CodeMirror's autocompletion ignores Enter for `interactionDelay` milliseconds after its list
 * opens, so a key pressed as the list appears is not taken for a choice; the editor then types
 * the newline instead. A test that pressed Enter as soon as the list was visible went red
 * whenever the list opened late: measured on the "/" menu, Enter landed 9.7 to 13.6 ms after the
 * list appeared on every red run and 87.6 to 113 ms on every green one, with the right option
 * selected each time. So the wait is for the cause: the option selected, and the list open for
 * longer than the delay, timed inside the page from the moment the list appeared.
 */

/**
 * `@codemirror/autocomplete`'s default `interactionDelay`. The editor's `autocompletion()` calls
 * set none, and CodeMirror does not expose the configured value outside its state.
 */
const INTERACTION_DELAY = 75;

/** Past the delay: the list opens a frame before it reaches the page, and timers are coarse. */
const MARGIN = 50;

/**
 * Presses Enter on the completion list once `label` is the selected option and the list has been
 * open for longer than CodeMirror's delay. A list already open when this is called counts from
 * now, which only waits longer than it needs.
 */
export async function acceptCompletion(page: Page, label: string, timeout = 15_000): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { tytoCompletionOpened?: number };
    if (scope.tytoCompletionOpened !== undefined) return;
    const open = () => document.querySelector('.cm-tooltip-autocomplete') !== null;
    scope.tytoCompletionOpened = open() ? performance.now() : -1;
    // A list that closes and opens again starts CodeMirror's delay again, so this time does too.
    new MutationObserver(() => {
      if (!open()) scope.tytoCompletionOpened = -1;
      else if (scope.tytoCompletionOpened === -1) scope.tytoCompletionOpened = performance.now();
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.waitForFunction(
    ({ wanted, wait }) => {
      const opened = (window as unknown as { tytoCompletionOpened: number }).tytoCompletionOpened;
      const selected = document.querySelector(
        '.cm-tooltip-autocomplete li[aria-selected] .cm-completionLabel',
      )?.textContent;
      return selected === wanted && opened >= 0 && performance.now() - opened > wait;
    },
    { wanted: label, wait: INTERACTION_DELAY + MARGIN },
    { timeout },
  );
  await page.keyboard.press('Enter');
}
