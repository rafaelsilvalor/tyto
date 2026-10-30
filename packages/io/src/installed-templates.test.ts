import { join, resolve } from 'node:path';

import {
  type AssetRef,
  type Frame,
  type TemplateContext,
  type TemplateManifest,
  type TemplateRegistry,
  isDeferredTemplate,
  measureNothing,
  noBrandKit,
  noFiles,
  reportNothing,
} from '@tyto/core';
import type { IsolatedPackBuild } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import { installedTemplateSource } from './installed-templates.js';

/**
 * What an installed code template's frame may draw (TYTO-479): only the pictures the host
 * handed that call. The plugin's process is a function here, because the check is the host's
 * and runs on whatever answer comes back; the real process is in the CLI's acceptance test.
 */

const PACK = resolve('/plugins/vaza/templates');
const FOLDER = join(PACK, 'cartaz');
const OUTSIDE = resolve('/elsewhere/private/secret.png');

const OWN: AssetRef = {
  id: 'assets/bg.png',
  source: 'file',
  path: join(FOLDER, 'assets', 'bg.png'),
  hash: 'sha256:own',
};
const FROM_BRIEF: AssetRef = {
  id: 'foto.png',
  source: 'file',
  path: resolve('/briefs/foto.png'),
  hash: 'sha256:brief',
};

const MANIFEST = { name: 'cartaz', version: '1.0.0', formats: ['feed'] } as TemplateManifest;

const REGISTRY: TemplateRegistry = {
  list: () => [MANIFEST],
  get: (name) => (name === 'cartaz' ? MANIFEST : undefined),
  formatsOf: () => ['feed'],
  directoryOf: (name) => (name === 'cartaz' ? FOLDER : undefined),
  failures: [],
};

function frameDrawing(asset: AssetRef): Frame {
  return {
    format: 'feed',
    size: { w: 10, h: 10 },
    children: [
      {
        id: 'feed.0.picture',
        kind: 'image',
        size: { w: 10, h: 10 },
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
        opacity: 1,
        blend: 'normal',
        visible: true,
        clip: false,
        effects: [],
        asset,
        fit: 'cover',
        position: { x: 0.5, y: 0.5 },
      },
    ],
  } as Frame;
}

const CONTEXT: TemplateContext = {
  format: 'feed',
  size: { w: 10, h: 10 },
  idPrefix: 'feed.0',
  artwork: { id: 'artwork-1', index: 0, count: 1 },
  slots: {},
  adjustments: {},
  brand: noBrandKit,
  values: { photo: FROM_BRIEF },
  measure: measureNothing,
  report: reportNothing,
  files: noFiles,
};

/** Loads `cartaz` from a pack whose `build` answers `frame`, and builds it once. */
async function buildFrame(frame: Frame) {
  const build: IsolatedPackBuild = () =>
    Promise.resolve({ ok: true, value: { frame, reports: [] }, diagnostics: [] });
  const source = installedTemplateSource({
    registry: REGISTRY,
    packs: [{ plugin: 'vaza', directory: PACK, build, permissions: [] }],
    fonts: { outlines: () => undefined, fromMachine: () => false },
    next: { load: () => Promise.reject(new Error('not an installed code template')) },
    readFiles: () =>
      Promise.resolve({
        assets: { image: (path) => (path === OWN.id ? OWN : undefined), svg: () => undefined },
        paths: [OWN.id],
      }),
  });
  const loaded = await source.load('cartaz');
  if (!loaded.ok || !isDeferredTemplate(loaded.value)) throw new Error('not deferred');
  return loaded.value.buildLater(CONTEXT);
}

const buildDrawing = (asset: AssetRef) => buildFrame(frameDrawing(asset));

function codesOf(result: Awaited<ReturnType<typeof buildFrame>>): readonly string[] {
  return result.ok
    ? result.diagnostics.map((item) => item.code)
    : result.error.map((item) => item.code);
}

describe("an installed code template's pictures (TYTO-479)", () => {
  it('draws an image of its own folder, as the host read it', async () => {
    const result = await buildDrawing(OWN);
    expect(result.ok, codesOf(result).join()).toBe(true);
  });

  it('draws a picture the context handed it, such as a value from the brief', async () => {
    const result = await buildDrawing(FROM_BRIEF);
    expect(result.ok, codesOf(result).join()).toBe(true);
  });

  it('refuses an absolute path it wrote itself, naming the plugin, the template and the asset', async () => {
    const result = await buildDrawing({ id: 'leak.png', source: 'file', path: OUTSIDE, hash: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((item) => item.code)).toEqual(['E_PLUGIN_TEMPLATE_ASSET']);
    expect(result.error[0]?.message).toContain("Plugin 'vaza'");
    expect(result.error[0]?.message).toContain("'leak.png'");
    expect(result.error[0]?.message).toContain("'cartaz'");
  });

  it('refuses a handed id with a path it changed, and a url ref pointing at a file', async () => {
    for (const asset of [
      { ...OWN, path: OUTSIDE },
      { id: 'https://example.com/x.png', source: 'url', path: OUTSIDE, hash: 'x' } as const,
    ]) {
      expect(codesOf(await buildDrawing(asset))).toEqual(['E_PLUGIN_TEMPLATE_ASSET']);
    }
  });

  it('refuses a ref with no path whose id leads out of the brief folder', async () => {
    for (const id of ['../../elsewhere/secret.png', OUTSIDE]) {
      const result = await buildDrawing({ id, source: 'file', hash: 'x' });
      expect(codesOf(result), id).toEqual(['E_PLUGIN_TEMPLATE_ASSET']);
    }
  });

  it("refuses a picture in a rect's image paint as well as in an image node", async () => {
    const leak: AssetRef = { id: 'leak.png', source: 'file', path: OUTSIDE, hash: 'x' };
    const frame = frameDrawing(OWN);
    const rect = {
      ...frame.children[0],
      id: 'feed.0.band',
      kind: 'rect',
      radius: [0, 0, 0, 0],
      fill: { kind: 'image', asset: leak, fit: 'cover' },
    };
    const result = await buildFrame({ ...frame, children: [...frame.children, rect] } as Frame);
    expect(codesOf(result)).toEqual(['E_PLUGIN_TEMPLATE_ASSET']);
  });
});
