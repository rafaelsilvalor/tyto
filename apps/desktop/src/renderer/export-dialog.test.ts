// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  type ExportDialog,
  type ExportProgressView,
  type ExportStartRequest,
  EXPORT_DIALOG_TAG,
  completion,
} from './export-dialog.js';

/**
 * The dialog's arithmetic and its states.
 *
 * **What jsdom can answer and what it cannot** is the whole shape of this file. It does no
 * layout, so nothing here says the dialog is legible, positioned, or that the bar is
 * visible — that has shipped broken with a green suite three times in this repository
 * (TYTO-40, TYTO-41, TYTO-101), and `e2e/export.desktop.test.ts` is what looks. What jsdom
 * *can* answer is which button exists in which state and what the fraction is, and those are
 * real questions: "Cancel while running, Export otherwise" is a rule, not an appearance.
 */

const progress = (over: Partial<ExportProgressView> = {}): ExportProgressView => ({
  status: 'running',
  total: 4,
  done: 1,
  failed: 0,
  directory: '/out',
  diagnostics: [],
  ...over,
});

function dialog(): ExportDialog {
  const element = document.createElement(EXPORT_DIALOG_TAG) as ExportDialog;
  document.body.append(element);
  element.open = true;
  return element;
}

describe('completion', () => {
  it('is unknown before the job has planned', () => {
    // `undefined` and not `0`, because the two say different things: a bar at zero says the
    // work started and produced nothing, and the honest state before a plan exists is that
    // nobody knows yet.
    expect(completion(undefined)).toBeUndefined();
    expect(completion(progress({ total: 0, done: 0 }))).toBeUndefined();
  });

  it('is the fraction of the plan that is done', () => {
    expect(completion(progress({ total: 4, done: 1 }))).toBe(0.25);
    expect(completion(progress({ total: 4, done: 4 }))).toBe(1);
  });

  it('never draws past the end', () => {
    // `done` counts failed frames as well as written ones, so a job reporting more than it
    // planned is possible and a bar at 150% is not.
    expect(completion(progress({ total: 2, done: 5 }))).toBe(1);
  });
});

describe('the export dialog', () => {
  it('will not start without a folder, and will once there is one', async () => {
    const element = dialog();
    await element.updateComplete;

    const button = (): HTMLButtonElement | null =>
      element.querySelector<HTMLButtonElement>('.export__start');

    expect(button()?.disabled).toBe(true);

    element.directory = '/out';
    await element.updateComplete;

    expect(button()?.disabled).toBe(false);
  });

  it('will not start with every file type unticked', async () => {
    const element = dialog();
    element.directory = '/out';
    await element.updateComplete;

    const svg = element.querySelector<HTMLInputElement>('input[value="svg"]');
    expect(svg?.checked).toBe(true);

    svg?.click();
    await element.updateComplete;

    expect(element.querySelector<HTMLButtonElement>('.export__start')?.disabled).toBe(true);
  });

  it('asks for the types in a fixed order, whatever order they were ticked in', async () => {
    // Two people who tick the same boxes should send the same request. Ordering by the
    // declaration rather than by the clicks is what makes the run reproducible.
    const requests: ExportStartRequest[] = [];
    const element = dialog();
    element.directory = '/out';
    element.start = (request) => requests.push(request);
    await element.updateComplete;

    element.querySelector<HTMLInputElement>('input[value="webp"]')?.click();
    await element.updateComplete;
    element.querySelector<HTMLInputElement>('input[value="png"]')?.click();
    await element.updateComplete;

    element.querySelector<HTMLButtonElement>('.export__start')?.click();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.outputs.map((output) => output.kind)).toEqual(['png', 'webp', 'svg']);
  });

  it('sends a quality for the lossy types and none for png and svg', async () => {
    // The raster port throws a `TypeError` on `quality` with `png`, which is a rule the
    // dialog has to respect rather than discover.
    const requests: ExportStartRequest[] = [];
    const element = dialog();
    element.directory = '/out';
    element.start = (request) => requests.push(request);
    await element.updateComplete;

    element.querySelector<HTMLInputElement>('input[value="png"]')?.click();
    element.querySelector<HTMLInputElement>('input[value="jpeg"]')?.click();
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('.export__start')?.click();

    const outputs = requests[0]?.outputs ?? [];

    expect(outputs.find((output) => output.kind === 'png')).not.toHaveProperty('quality');
    expect(outputs.find((output) => output.kind === 'svg')).not.toHaveProperty('quality');
    expect(outputs.find((output) => output.kind === 'jpeg')?.quality).toBe(90);
  });

  it('offers Cancel while it runs and Export when it does not', async () => {
    const element = dialog();
    element.directory = '/out';
    element.progress = progress({ status: 'running' });
    await element.updateComplete;

    expect(element.querySelector('.export__cancel')).not.toBeNull();
    expect(element.querySelector('.export__start')).toBeNull();
    // And the dialog cannot be closed out from under a run: the files would keep appearing
    // with nobody watching.
    expect(element.querySelector<HTMLButtonElement>('.export__close')?.disabled).toBe(true);

    element.progress = progress({ status: 'finished', done: 4 });
    await element.updateComplete;

    expect(element.querySelector('.export__cancel')).toBeNull();
    expect(element.querySelector('.export__start')).not.toBeNull();
    expect(element.querySelector<HTMLButtonElement>('.export__close')?.disabled).toBe(false);
  });

  it('offers the folder only once there is a folder to open', async () => {
    const revealed: string[] = [];
    const element = dialog();
    element.reveal = (directory) => revealed.push(directory);
    element.progress = progress({ status: 'running' });
    await element.updateComplete;

    expect(element.querySelector('.export__reveal')).toBeNull();

    element.progress = progress({ status: 'finished', done: 4, directory: '/out/promo' });
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('.export__reveal')?.click();

    expect(revealed).toEqual(['/out/promo']);
  });

  it('says what went wrong, separating a diagnostic from a failure', async () => {
    const element = dialog();
    element.progress = progress({
      status: 'finished',
      done: 4,
      diagnostics: [{ severity: 'error', message: 'E_UNKNOWN_TEMPLATE: no such template' }],
    });
    await element.updateComplete;

    expect(element.querySelector('.export__problems')?.textContent).toContain('no such template');
    expect(element.querySelector('.export__failure')).toBeNull();

    // A failure is not a diagnostic — `docs/diagnostic-codes.md` is a closed catalogue and
    // "the disk is full" is not in it — so it is shown as its own line.
    element.progress = progress({ status: 'finished', done: 0, failure: 'ENOSPC: no space left' });
    await element.updateComplete;

    expect(element.querySelector('.export__failure')?.textContent).toContain('ENOSPC');
  });
});

/**
 * Formats, scale and quality — the three choices TYTO-43 declared and did not ship (TYTO-137).
 *
 * **The rule every case here circles is that the untouched form is the old behaviour.** The
 * dialog shipped sending every format at scale 1 with quality 90, and a person who opens it and
 * clicks Export has to keep getting exactly that — so `formats` is absent when all of them are
 * ticked and `scale` is absent at 1×, rather than being sent as a full list and a 1.
 */
describe('the export dialog, choosing what to render', () => {
  const withFormats = async (formats: readonly string[]): Promise<ExportDialog> => {
    const element = dialog();
    element.directory = '/out';
    element.formats = formats;
    await element.updateComplete;
    return element;
  };

  const startAndCapture = async (
    element: ExportDialog,
  ): Promise<ExportStartRequest | undefined> => {
    const requests: ExportStartRequest[] = [];
    element.start = (request) => requests.push(request);
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('.export__start')?.click();
    return requests[0];
  };

  it('ticks every format it is given, and sends none of them', async () => {
    const element = await withFormats(['feed', 'story']);

    const ticked = [...element.querySelectorAll<HTMLInputElement>('.export__format input')];
    expect(ticked.map((input) => input.value)).toEqual(['feed', 'story']);
    expect(ticked.every((input) => input.checked)).toBe(true);

    // **Absent, not the full list.** The channel reads an absent `formats` as every format the
    // *manifest* declares; sending the list this window is holding would quietly narrow the
    // export to what it happened to know about.
    expect(await startAndCapture(element)).not.toHaveProperty('formats');
  });

  it('sends the formats that stayed ticked', async () => {
    const element = await withFormats(['feed', 'story']);

    element.querySelector<HTMLInputElement>('.export__format input[value="story"]')?.click();
    await element.updateComplete;

    expect((await startAndCapture(element))?.formats).toEqual(['feed']);
  });

  it('will not start with every format unticked', async () => {
    const element = await withFormats(['feed', 'story']);

    const boxes = [...element.querySelectorAll<HTMLInputElement>('.export__format input')];
    for (const input of boxes) input.click();
    await element.updateComplete;

    // An export of no formats is an export of nothing, the same state as no file types, and
    // it must not be read as "all of them".
    expect(element.querySelector<HTMLButtonElement>('.export__start')?.disabled).toBe(true);
  });

  it('draws the note instead of a checklist when the brief names no template', async () => {
    const element = dialog();
    element.directory = '/out';
    await element.updateComplete;

    // The honest state: nobody knows the list, and the request will render all of them —
    // which is what the note says.
    expect(element.querySelector('.export__formats')).toBeNull();
    expect(element.querySelector('.export__note')).not.toBeNull();
    expect(await startAndCapture(element)).not.toHaveProperty('formats');
  });

  it('re-ticks everything when the list changes under it', async () => {
    const element = await withFormats(['feed', 'story']);
    element.querySelector<HTMLInputElement>('.export__format input[value="story"]')?.click();
    await element.updateComplete;

    // Another tab, another template. A selection naming formats the new template does not
    // have would be an export of nothing wearing a full checklist.
    element.formats = ['quadrado'];
    await element.updateComplete;

    const ticked = [...element.querySelectorAll<HTMLInputElement>('.export__format input')];
    expect(ticked.map((input) => input.value)).toEqual(['quadrado']);
    expect(ticked.every((input) => input.checked)).toBe(true);
  });

  it('puts scale on the raster types and never on svg', async () => {
    const element = dialog();
    element.directory = '/out';
    await element.updateComplete;
    element.querySelector<HTMLInputElement>('input[value="png"]')?.click();
    element.querySelector<HTMLInputElement>('input[value="jpeg"]')?.click();
    await element.updateComplete;

    const picker = element.querySelector<HTMLSelectElement>('[data-testid="export-scale"]');
    expect(picker).not.toBeNull();
    picker!.value = '2';
    picker!.dispatchEvent(new Event('change'));
    await element.updateComplete;

    const outputs = (await startAndCapture(element))?.outputs ?? [];

    expect(outputs.find((output) => output.kind === 'png')?.scale).toBe(2);
    expect(outputs.find((output) => output.kind === 'jpeg')?.scale).toBe(2);
    // An SVG is instructions, not pixels: there is no resolution in it to double.
    expect(outputs.find((output) => output.kind === 'svg')).not.toHaveProperty('scale');
  });

  it('leaves scale off entirely at 1x, which is what shipped', async () => {
    const element = dialog();
    element.directory = '/out';
    await element.updateComplete;
    element.querySelector<HTMLInputElement>('input[value="png"]')?.click();

    const outputs = (await startAndCapture(element))?.outputs ?? [];

    expect(outputs.find((output) => output.kind === 'png')).not.toHaveProperty('scale');
  });

  it('offers no scale at all when only svg is ticked', async () => {
    const element = dialog();
    element.directory = '/out';
    await element.updateComplete;

    expect(element.querySelector('[data-testid="export-scale"]')).toBeNull();
  });

  it('offers quality only while a lossy type is ticked, so png can never be asked', async () => {
    const element = dialog();
    element.directory = '/out';
    await element.updateComplete;

    // SVG alone, then PNG: neither can be compressed, so the control is not on screen. That
    // is the card's criterion in its literal form — impossible from the form rather than
    // refused afterwards by the raster port's `TypeError`.
    expect(element.querySelector('[data-testid="export-quality"]')).toBeNull();
    element.querySelector<HTMLInputElement>('input[value="png"]')?.click();
    await element.updateComplete;
    expect(element.querySelector('[data-testid="export-quality"]')).toBeNull();

    element.querySelector<HTMLInputElement>('input[value="webp"]')?.click();
    await element.updateComplete;
    expect(element.querySelector('[data-testid="export-quality"]')).not.toBeNull();
  });

  it('carries a chosen quality to the lossy types only', async () => {
    const element = dialog();
    element.directory = '/out';
    await element.updateComplete;
    element.querySelector<HTMLInputElement>('input[value="png"]')?.click();
    element.querySelector<HTMLInputElement>('input[value="jpeg"]')?.click();
    await element.updateComplete;

    const box = element.querySelector<HTMLInputElement>('[data-testid="export-quality"]');
    box!.value = '55';
    box!.dispatchEvent(new Event('change'));
    await element.updateComplete;

    const outputs = (await startAndCapture(element))?.outputs ?? [];

    expect(outputs.find((output) => output.kind === 'jpeg')?.quality).toBe(55);
    expect(outputs.find((output) => output.kind === 'png')).not.toHaveProperty('quality');
  });

  it('clamps a quality nobody could mean', async () => {
    const element = dialog();
    element.directory = '/out';
    await element.updateComplete;
    element.querySelector<HTMLInputElement>('input[value="jpeg"]')?.click();
    await element.updateComplete;

    const box = element.querySelector<HTMLInputElement>('[data-testid="export-quality"]');
    box!.value = '0';
    box!.dispatchEvent(new Event('change'));
    await element.updateComplete;

    // Clamped here rather than left to the contract: `quality: 0` fails validation on the
    // wire, and that failure would report a bug in this window to somebody who typed a zero.
    const outputs = (await startAndCapture(element))?.outputs ?? [];
    expect(outputs.find((output) => output.kind === 'jpeg')?.quality).toBe(1);
  });
});
