import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type RunningPreview, getFrom, renderByHand, startPreview } from './harness.ts';
import { IDENTITY_STATEMENT } from './page.ts';
import { BUILT_IN_FORMATS, BUILT_IN_PACK } from './paths.ts';
import type { PreviewState } from './session.ts';
import { resolveTarget } from './target.ts';
import { watchTarget } from './watch.ts';

/**
 * The preview against the real, built `tyto` binary, on a copy of a markup template.
 *
 * `--types svg` so it runs where `pnpm check` runs, which has no Chromium: what is under
 * test here is that the server hands over the file `tyto render` wrote, and an SVG is a
 * file like a PNG is. The PNG half, for `agenda-semana` and a markup template, is
 * `preview.visual.test.ts`.
 */

let project: string;
let preview: RunningPreview | undefined;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'tyto-preview-project-'));
  await cp(join(BUILT_IN_PACK, 'promo-curso'), join(project, 'templates', 'promo-curso'), {
    recursive: true,
  });
  await cp(BUILT_IN_FORMATS, join(project, 'templates', 'formats.yaml'));
});

afterEach(async () => {
  await preview?.stop();
  preview = undefined;
  await rm(project, { recursive: true, force: true });
});

const target = () =>
  resolveTarget({ template: join(project, 'templates', 'promo-curso'), types: ['svg'] }, project);

async function until(
  running: RunningPreview,
  accept: (state: PreviewState) => boolean,
): Promise<PreviewState> {
  const deadline = Date.now() + 45_000;
  for (;;) {
    const state = await running.state();
    if (accept(state)) return state;
    if (Date.now() > deadline)
      throw new Error(`gave up waiting; last state ${JSON.stringify(state)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('the preview of a markup template', () => {
  it('serves exactly the bytes `tyto render` writes for the same brief', async () => {
    preview = await startPreview(target());
    await preview.session.request({ rebuild: false });

    const served = await preview.servedHashes();
    const byHand = await renderByHand(target());

    expect([...served.keys()].sort()).toEqual(['artwork-1-feed.svg', 'artwork-1-story.svg']);
    expect(served).toEqual(byHand);
  });

  it('shows a broken template as its diagnostic, with no image from before it', async () => {
    preview = await startPreview(target());
    await preview.session.request({ rebuild: false });
    const before = await preview.state();
    expect(before.images).toHaveLength(2);

    const markup = join(project, 'templates', 'promo-curso', 'template.html');
    const source = await readFile(markup, 'utf8');
    await writeFile(markup, source.replace('<rect id="veil"', '<rectangle id="veil"'));
    await preview.session.request({ rebuild: false });

    const after = await preview.state();
    expect(after.status).toBe('failed');
    expect(after.images).toEqual([]);
    const located = after.diagnostics.find((item) => item.path?.endsWith('template.html'));
    expect(located, JSON.stringify(after.diagnostics)).toBeDefined();
    expect(located!.line).toBeGreaterThan(0);

    const stale = await getFrom(new URL(before.images[0]!.url, preview.server.url));
    expect(stale.status).toBe(404);
  });

  it('re-renders on save, with nobody asking', async () => {
    const watched = target();
    preview = await startPreview(watched);
    await preview.session.request({ rebuild: false });
    const first = await preview.state();
    const stopWatching = watchTarget(watched, preview.session);

    try {
      const markup = join(project, 'templates', 'promo-curso', 'template.html');
      const source = await readFile(markup, 'utf8');
      // A comment changes no pixel, which is the point: the watcher answers a save, not a
      // difference it would have to compute.
      await writeFile(markup, `${source}\n<!-- saved -->\n`);

      const second = await until(
        preview,
        (state) => state.generation > first.generation && state.status === 'ok',
      );
      expect(second.images).toHaveLength(2);
      expect(second.changeToPictureMs).toBeGreaterThan(0);
    } finally {
      stopWatching();
    }
  });

  it('listens on the loopback address only, and says which Tyto it matches', async () => {
    preview = await startPreview(target());
    expect(preview.server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const address = preview.server.server.address();
    expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');

    const page = (await getFrom(preview.server.url)).body.toString('utf8');
    expect(page).toContain(IDENTITY_STATEMENT);
  });

  it('breaks when the binary it drives breaks, because it draws nothing itself', async () => {
    const broken = join(project, 'broken-tyto.mjs');
    await writeFile(broken, "process.stderr.write('render path broken\\n'); process.exit(2);\n");

    const { renderWithTyto, rebuildTemplates } = await import('./tyto.ts');
    preview = await startPreview(target(), {
      now: () => performance.now(),
      rebuild: rebuildTemplates,
      render: (request) => renderWithTyto({ ...request, binary: broken }),
    });
    await preview.session.request({ rebuild: false });

    const state = await preview.state();
    expect(state.status).toBe('failed');
    expect(state.images).toEqual([]);
    expect(state.diagnostics[0]?.message).toContain('render path broken');
  });
});
