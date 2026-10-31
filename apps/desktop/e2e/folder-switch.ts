import type { Page } from 'playwright';

/**
 * Runs `start`, a command that opens or closes a workspace folder, and waits for the window
 * it reloads into (TYTO-513, ADR 0165).
 *
 * A switch to another folder files the window's tabs under the folder it left and reloads, and
 * the new page restores the new folder's tabs. Anything a suite does before that page has
 * restored would act on the page being thrown away, so a suite never runs the next step on the
 * old page: it waits for the `load` of the new one and for the mark `main.ts` sets once the
 * session is back.
 */
export async function switchingFolder(window: Page, start: () => Promise<unknown>): Promise<void> {
  const loaded = window.waitForEvent('load', { timeout: 30_000 });
  await start();
  await loaded;
  await window.waitForFunction(
    () => document.documentElement.dataset.session === 'restored',
    null,
    {
      timeout: 30_000,
    },
  );
}
