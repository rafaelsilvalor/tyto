import { type Frame, type Scene, type SceneNode, ok, rectNodeSchema } from '@tyto/core';
import { exportFrameHtml } from '@tyto/export-html';
import type { Exporter } from '@tyto/plugin-api';
import type { RasterOptions, Rasterizer } from '@tyto/raster';
import { describe, expect, it } from 'vitest';

import { layerFrame, rasterizeGuideLayers } from './guide-raster.js';

/**
 * The stage on a hand-built guide (ADR 0221): which layers are drawn, what each drawing
 * shows, and that a Scene with no guide is not touched. The exporter and the rasterizer are
 * fakes that record what they were handed; the HTML exporter is real in the layout case.
 */

/** A 40×30 rect at (x, 20), its defaults filled by the schema. */
function box(id: string, x: number, colour: number): SceneNode {
  return rectNodeSchema.parse({
    kind: 'rect',
    id,
    transform: { x, y: 20 },
    radius: [0, 0, 0, 0],
    size: { w: 40, h: 30 },
    fill: { kind: 'solid', color: { r: colour, g: 0, b: 0, a: 1 } },
  });
}

const GUIDED: Frame = {
  format: 'feed',
  size: { w: 200, h: 100 },
  background: { kind: 'solid', color: { r: 0, g: 0, b: 255, a: 1 } },
  children: [box('fundo', 0, 10), box('area', 60, 20), box('titulo', 120, 30)],
  guide: {
    layers: [
      { name: 'texto', label: 'texto', nodes: ['titulo'], locked: true, visible: true, opacity: 1 },
      { name: 'areas', label: 'areas', nodes: ['area'], locked: true, visible: true, opacity: 0.5 },
      { name: 'arte', label: 'arte', nodes: [], locked: false, visible: true, opacity: 1 },
      {
        name: 'decoracao',
        label: 'decoracao',
        nodes: ['fundo'],
        locked: true,
        visible: false,
        opacity: 1,
      },
    ],
  },
};

function sceneOf(...frames: Frame[]): Scene {
  return { version: 1, artworks: [{ id: 'capa', frames }], fonts: [], assets: [] };
}

/** Answers, for each frame it is handed, the ids it draws and whether it has a background. */
function recordingExporter(): Exporter & { readonly seen: Frame[] } {
  const seen: Frame[] = [];
  return {
    id: 'html',
    mime: 'text/html',
    extension: 'html',
    kinds: ['png'],
    rasterized: true,
    seen,
    exportFrame: (_scene, _artwork, frame) => {
      seen.push(frame);
      const drawn = frame.children.filter((child) => child.visible).map((child) => child.id);
      return ok(`${drawn.join(',')}|${frame.background === undefined ? 'clear' : 'background'}`);
    },
  };
}

function recordingRasterizer(): Rasterizer & { readonly calls: [string, RasterOptions][] } {
  const calls: [string, RasterOptions][] = [];
  return {
    calls,
    raster: (html, options) => {
      calls.push([html, options]);
      return Promise.resolve(new TextEncoder().encode(html));
    },
  };
}

describe('rasterizeGuideLayers', () => {
  it("draws every layer but 'arte', top to bottom, each with its own nodes", async () => {
    const exporter = recordingExporter();
    const rasterizer = recordingRasterizer();
    const drawn = await rasterizeGuideLayers(sceneOf(GUIDED), { exporter, rasterizer });

    expect(rasterizer.calls.map(([html]) => html)).toEqual([
      'titulo|clear',
      'area|clear',
      'fundo|background',
    ]);
    expect(rasterizer.calls.map(([, options]) => options)).toEqual([
      { width: 200, height: 100, format: 'png' },
      { width: 200, height: 100, format: 'png' },
      { width: 200, height: 100, format: 'png' },
    ]);
    const layers = drawn.scene.artworks[0]?.frames[0]?.guide?.layers ?? [];
    expect(layers.map((layer) => layer.raster?.id)).toEqual([
      'guide-layer:capa:feed:texto',
      'guide-layer:capa:feed:areas',
      undefined,
      'guide-layer:capa:feed:decoracao',
    ]);
    expect(drawn.rasters.map((raster) => new TextDecoder().decode(raster.bytes))).toEqual([
      'titulo|clear',
      'area|clear',
      'fundo|background',
    ]);
    expect(drawn.diagnostics).toEqual([]);
  });

  it('hides the other nodes rather than removing them, and keeps the frame whole', async () => {
    const exporter = recordingExporter();
    await rasterizeGuideLayers(sceneOf(GUIDED), { exporter, rasterizer: recordingRasterizer() });

    const [texto] = exporter.seen;
    expect(texto?.children.map((child) => [child.id, child.visible])).toEqual([
      ['fundo', false],
      ['area', false],
      ['titulo', true],
    ]);
    expect(texto?.children.map((child) => child.transform)).toEqual(
      GUIDED.children.map((child) => child.transform),
    );
    expect(texto?.size).toEqual(GUIDED.size);
    expect(texto?.guide).toBeUndefined();
  });

  it('gives the background to decoracao alone', async () => {
    const exporter = recordingExporter();
    await rasterizeGuideLayers(sceneOf(GUIDED), { exporter, rasterizer: recordingRasterizer() });

    expect(exporter.seen.map((frame) => frame.background !== undefined)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('leaves a Scene with no guide untouched, the same object, byte for byte', async () => {
    const { guide: _guide, ...plain } = GUIDED;
    const scene = sceneOf(plain);
    const before = JSON.stringify(scene);
    const exporter = recordingExporter();
    const rasterizer = recordingRasterizer();

    const drawn = await rasterizeGuideLayers(scene, { exporter, rasterizer });

    expect(drawn.scene).toBe(scene);
    expect(JSON.stringify(drawn.scene)).toBe(before);
    expect(drawn.rasters).toEqual([]);
    expect(exporter.seen).toEqual([]);
    expect(rasterizer.calls).toEqual([]);
  });

  it('reports a layer the rasterizer could not draw and draws the others', async () => {
    const rasterizer: Rasterizer = {
      raster: (html) =>
        html.startsWith('area')
          ? Promise.reject(new Error('the browser went away'))
          : Promise.resolve(new Uint8Array([1])),
    };
    const drawn = await rasterizeGuideLayers(sceneOf(GUIDED), {
      exporter: recordingExporter(),
      rasterizer,
    });

    expect(drawn.rasters.map((raster) => raster.ref.id)).toEqual([
      'guide-layer:capa:feed:texto',
      'guide-layer:capa:feed:decoracao',
    ]);
    expect(drawn.diagnostics.map((item) => item.message)).toEqual([
      "Frame 'capa:feed' could not be rendered as the guide layer 'areas': the browser went away.",
    ]);
  });
});

describe('a layer drawn by the real HTML exporter', () => {
  /** Each node's own rule in the document's stylesheet, by id. */
  function rulesOf(html: string): Map<string, string> {
    const rules = new Map<string, string>();
    for (const match of html.matchAll(/#([\w-]+) \{([^}]*)\}/g)) {
      rules.set(match[1] ?? '', match[2] ?? '');
    }
    return rules;
  }

  it('moves nothing: every node keeps its rule, and the hidden ones gain display: none', () => {
    const scene = sceneOf(GUIDED);
    const artwork = scene.artworks[0]!;
    const whole = exportFrameHtml(scene, artwork, GUIDED);
    const texto = exportFrameHtml(scene, artwork, layerFrame(GUIDED, GUIDED.guide!.layers[0]!));
    if (!whole.ok || !texto.ok) throw new Error('the HTML exporter refused the frame');

    const before = rulesOf(whole.value);
    const after = rulesOf(texto.value);
    expect([...after.keys()]).toEqual([...before.keys()]);
    expect(before.size).toBeGreaterThanOrEqual(3);
    for (const [id, rule] of after) {
      const hidden = id !== 'titulo';
      expect(rule.replace(' display: none;', '')).toBe(before.get(id));
      expect(rule.includes('display: none')).toBe(hidden);
    }
    // Every node is absolutely placed, so hiding one cannot move another.
    expect(texto.value).toContain('.tyto-node { position: absolute;');
  });
});
