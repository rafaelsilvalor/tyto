import type { Page } from 'playwright';

/**
 * The templates the window knows, for the suites that wait on them (TYTO-288).
 *
 * They were read off the header's template picker, `#template`'s options, until the picker left
 * the window (ADR 0085). "New brief from template…" lists the same rows — the window's last
 * `templates:list` answer, refreshed when the plugins start and when the folder changes — so the
 * suites read them there: the command bar opened on the command, the rows' names read, closed.
 * Keys go through the page, never through the operating system.
 */
export async function windowTemplates(page: Page): Promise<string[]> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('document.newFromTemplate');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const names = await page.evaluate(() =>
    [...document.querySelectorAll('.command-bar__option .command-bar__label')].map(
      (label) => label.textContent ?? '',
    ),
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('.command-bar__input', { state: 'hidden' });
  return names;
}

/** Waits until the window knows every one of `names`, or throws naming what it knew. */
export async function waitForWindowTemplates(
  page: Page,
  names: readonly string[],
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const known = await windowTemplates(page);
    if (names.every((name) => known.includes(name))) return;
    if (Date.now() > deadline) {
      throw new Error(`the window never listed ${names.join(', ')}; it knew ${known.join(', ')}`);
    }
    await page.waitForTimeout(250);
  }
}
