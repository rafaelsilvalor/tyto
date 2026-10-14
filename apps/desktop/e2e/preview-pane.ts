import type { Page } from 'playwright';

/**
 * Where the preview is, for the suites that read it (TYTO-287, ADR 0084).
 *
 * It used to be one dock panel with ids — `#preview-frame`, `#preview-stage`, `#format-tabs` —
 * and a window can now show two previews, a following one and a locked one, so the panes carry
 * no ids. Every suite that only needs "the preview on screen" reads the one shown in front of a
 * group, the first in tree order, through these selectors.
 */

/** The preview pane in front of its group; the first one when two are on screen. */
export const SHOWN_PREVIEW = 'tyto-preview-pane:not([hidden])';

/** One part of the shown preview: `frame`, `stage`, `paper`, `empty`, `formats`, `slide`… */
export const previewPart = (part: string): string => `${SHOWN_PREVIEW} [data-preview-${part}]`;

/** A format button of the shown preview, by the format's own name. */
export const previewFormat = (format: string): string =>
  `${SHOWN_PREVIEW} .preview__tab[data-format="${format}"]`;

/** A zoom button of the shown preview: `in`, `out` or `fit`. */
export const previewZoom = (which: 'in' | 'out' | 'fit'): string =>
  `${SHOWN_PREVIEW} [data-preview-zoom="${which}"]`;

/**
 * Opens the following preview beside the brief with Ctrl+Shift+V, for a suite that reads the
 * art (ADR 0084). The window refuses the command until it has read the last session, which is
 * a moment after the editor exists, so the key is pressed again until the tab is there.
 */
export async function openPreviewBeside(page: Page): Promise<void> {
  const tab = '[data-tab-kind="preview"]';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await page.$(tab)) !== null) break;
    await page.focus('#editor .cm-content');
    await page.keyboard.press('Control+Shift+V');
    await page.waitForTimeout(500);
  }
  await page.waitForSelector(`${SHOWN_PREVIEW} [data-preview-stage]`, { timeout: 30_000 });
}

/** The document the shown preview's frame holds, or `''` when none is on screen. */
export const previewSrcdoc = (page: Page): Promise<string> =>
  page.evaluate(
    (selector) => document.querySelector(selector)?.getAttribute('srcdoc') ?? '',
    previewPart('frame'),
  );
