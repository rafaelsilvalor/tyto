import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { nodeFileSystem } from '@tyto/io';
import { beforeAll, describe, expect, it } from 'vitest';

import { type PreviewService, createPreviewService } from './preview.js';

/**
 * The preview, against the pack the app actually ships.
 *
 * Deliberately not a fake registry. What this card changed is the *composition* — which
 * stages run, in what order, with which resources — and every one of those stages already
 * has its own unit tests against fakes. The thing that can be wrong here is the wiring, and
 * wiring is only wrong against the real thing.
 */

const require_ = createRequire(import.meta.url);
const packDirectory = join(dirname(require_.resolve('@tyto/templates/package.json')), 'templates');

const exampleBrief = (template: string, file: string): string =>
  readFileSync(join(packDirectory, template, 'examples', file), 'utf8');

let preview: PreviewService;

beforeAll(async () => {
  preview = await createPreviewService({ fileSystem: nodeFileSystem() });
});

describe('the preview service', () => {
  it('turns a brief into one self-contained document per frame', async () => {
    const result = await preview.preview(exampleBrief('promo-curso', 'promo.brief'));

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.frames.length).toBeGreaterThan(0);

    for (const frame of result.frames) {
      expect(frame.html).toMatch(/^<!doctype html>/iu);
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
    }
  });

  it('embeds the fonts rather than naming them', async () => {
    // The determinism rule (`docs/architecture.md`) is the point: a preview drawn in
    // whatever face the host substituted is a preview of a different artwork. `@font-face`
    // with a `data:` source is what "embedded" looks like from here, and it is the one thing
    // a reader can check without decoding the document.
    const result = await preview.preview(exampleBrief('promo-curso', 'promo.brief'));
    const [first] = result.frames;

    expect(first).toBeDefined();
    expect(first!.html).toContain('@font-face');
    expect(first!.html).toContain('src: url("data:font/');
  });

  it('makes no request the window would have to wait for', async () => {
    // Self-contained is what lets the renderer show the document with no network and no
    // asset resolver of its own (ADR 0018). `http` appearing at all would mean something
    // in the document points outside it.
    const result = await preview.preview(exampleBrief('carrossel-lista', 'lista.brief'));
    const [first] = result.frames;

    expect(first).toBeDefined();
    expect(first!.html).not.toMatch(/(?:src|href)\s*[=:]\s*["']?https?:/iu);
  });

  it('gives a repeating brief one frame per artwork per format', async () => {
    // A carousel is several slides; the preview needs them all, because the slide selector
    // switches between already-rendered frames rather than asking for another render.
    const result = await preview.preview(exampleBrief('carrossel-lista', 'lista.brief'));

    const artworks = new Set(result.frames.map((frame) => frame.artwork));
    const formats = new Set(result.frames.map((frame) => frame.format));

    expect(artworks.size).toBeGreaterThan(1);
    expect(result.frames).toHaveLength(artworks.size * formats.size);
  });

  it('reports a broken brief instead of rejecting', async () => {
    // The preview runs on every keystroke, and half-typed text is the normal state of a
    // brief rather than an exceptional one. A rejection here would be an error dialog per
    // character.
    const result = await preview.preview('::this is not a brief\n');

    expect(result.frames).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const item of result.diagnostics) expect(item.code).toMatch(/^[EW]_/u);
  });

  it('answers an empty document without throwing', async () => {
    // The state the window opens in, before anybody types.
    await expect(preview.preview('')).resolves.toMatchObject({ frames: [] });
  });
});
