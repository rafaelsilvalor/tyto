import { afterEach, describe, expect, it } from 'vitest';

import { type RunningPreview, renderByHand, startPreview } from './harness.ts';
import { REPOSITORY_ROOT } from './paths.ts';
import { resolveTarget } from './target.ts';

/**
 * The acceptance criterion, in PNG: for one template, brief and format, the image the page
 * shows has the sha256 of the file `tyto render` writes when a person runs it.
 *
 * Two templates, one per route to a `Template`: `agenda-semana` is code compiled into the
 * build (TYTO-166) and `promo-curso` is markup. Bytes and not a pixel diff, because the
 * CLI's rasterizer is Playwright's Chromium with the determinism flags and the same input
 * gives the same file run to run — measured, not assumed: the hashes below come from two
 * separate processes, each launching its own browser.
 *
 * `rebuild: false` because `turbo run test:visual` built `@tyto/templates` already, and a
 * suite that rewrote a package's `dist/` would race every other suite reading it.
 */

let preview: RunningPreview | undefined;

afterEach(async () => {
  await preview?.stop();
  preview = undefined;
});

describe.each(['agenda-semana', 'promo-curso'])('the %s preview', (template) => {
  it('serves every image with the sha256 of the file `tyto render` writes', async () => {
    const target = resolveTarget({ template }, REPOSITORY_ROOT);
    preview = await startPreview(target);
    await preview.session.request({ rebuild: false });

    const state = await preview.state();
    expect(state.status, JSON.stringify(state.diagnostics)).toBe('ok');
    expect(new Set(state.images.map((image) => image.format))).toEqual(new Set(['feed', 'story']));

    const served = await preview.servedHashes();
    const byHand = await renderByHand(target);

    expect(served.size).toBeGreaterThan(0);
    expect(served).toEqual(byHand);
    // Printed rather than logged, so the numbers reach a CI log from a passing run.
    process.stdout.write(
      `${template}: ${[...served].map(([name, hash]) => `${name} ${hash}`).join(', ')}\n`,
    );
  });
});
