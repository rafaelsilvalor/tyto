import type { Artwork, AssetRef, Frame, GuideLayer, Scene } from '@tyto/core';
import { createPluginHost } from '@tyto/plugin-api';
import { type Layer, type Psd, initializeCanvas, readPsd } from 'ag-psd';
import { describe, expect, it } from 'vitest';

import { type RgbaPixels, exportFramePsd, psdExporterPlugin } from './index.js';

/**
 * Every test writes a PSD with `ag-psd` and reads it back with `ag-psd`, in plain Node, where
 * no canvas package is installed. The reader allocates its pixel buffers through
 * `createImageData` even with `useImageData`, so the test hands it a plain-array one; the
 * canvas it is handed throws. A green run is therefore also the measurement that the writer
 * reaches for no canvas (ADR 0221 took it on trust): the exporter installs nothing.
 */
type ImageDataMaker = NonNullable<Parameters<typeof initializeCanvas>[1]>;
const plainImageData = ((width: number, height: number) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
})) as unknown as ImageDataMaker;
initializeCanvas(() => {
  throw new Error('a canvas was asked for');
}, plainImageData);

const WIDTH = 4;
const HEIGHT = 3;

function rasterRef(layer: string): AssetRef {
  return {
    id: `guide-layer:artwork-1:grid:${layer}`,
    source: 'inline',
    hash: `test-${layer}`,
    size: { w: WIDTH, h: HEIGHT },
  };
}

/** A transparent picture with one opaque pixel of `rgb` at `pixel` (row-major index). */
function picture(pixel: number, rgb: readonly [number, number, number]): RgbaPixels {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  data.set([...rgb, 255], pixel * 4);
  return { width: WIDTH, height: HEIGHT, data };
}

/** `texto` paints pixel 0 red, `areas` pixel 1 blue, `decoracao` pixel 2 green. */
const PIXELS: ReadonlyMap<string, RgbaPixels> = new Map([
  [rasterRef('texto').id, picture(0, [255, 0, 0])],
  [rasterRef('areas').id, picture(1, [0, 0, 255])],
  [rasterRef('decoracao').id, picture(2, [0, 255, 0])],
]);

const resources = { pixels: (ref: AssetRef) => PIXELS.get(ref.id) };

function layer(
  name: GuideLayer['name'],
  rest: Partial<GuideLayer> & Pick<GuideLayer, 'locked' | 'visible' | 'opacity'>,
): GuideLayer {
  return {
    name,
    label: name,
    nodes: [],
    ...(name === 'arte' ? {} : { raster: rasterRef(name) }),
    ...rest,
  };
}

/** The four layers of a `full` frame, as ADR 0220 orders and flags them. */
const FULL_LAYERS: readonly GuideLayer[] = [
  layer('texto', { locked: true, visible: true, opacity: 1 }),
  layer('areas', { locked: true, visible: true, opacity: 0.5 }),
  layer('arte', { locked: false, visible: true, opacity: 1 }),
  layer('decoracao', { locked: true, visible: false, opacity: 1 }),
];

function frameOf(layers: readonly GuideLayer[], format = 'grid', w = WIDTH, h = HEIGHT): Frame {
  return {
    format,
    size: { w, h },
    children: [],
    guide: {
      art: { slot: 'fundo', kind: 'full', box: { x: 0, y: 0, w, h } },
      layers: [...layers],
    },
  };
}

function sceneOf(artwork: Artwork): Scene {
  return { version: 1, artworks: [artwork], fonts: [], assets: [] };
}

function exported(frame: Frame, options = { resources }) {
  const artwork: Artwork = { id: 'artwork-1', frames: [frame] };
  return exportFramePsd(sceneOf(artwork), artwork, frame, options);
}

function readBack(bytes: Uint8Array): Psd {
  return readPsd(bytes, { useImageData: true, skipThumbnail: true });
}

function written(frame: Frame): Psd {
  const result = exported(frame);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return readBack(result.value);
}

/** Bottom first, as a PSD stores them. */
function layersOf(psd: Psd): readonly Layer[] {
  return psd.children ?? [];
}

function named(psd: Psd, name: string): Layer {
  const found = layersOf(psd).find((item) => item.name === name);
  if (found === undefined) throw new Error(`no layer '${name}'`);
  return found;
}

function pixelAt(psd: Psd, pixel: number): readonly number[] {
  const data = psd.imageData?.data;
  if (data === undefined) throw new Error('no composite');
  return [...data.slice(pixel * 4, pixel * 4 + 4)];
}

describe('a full guide frame', () => {
  const psd = written(frameOf(FULL_LAYERS));

  it('is a document the size of the frame', () => {
    expect([psd.width, psd.height]).toEqual([WIDTH, HEIGHT]);
  });

  it('stacks texto, areas, arte and decoracao, top to bottom', () => {
    expect(layersOf(psd).map((item) => item.name)).toEqual(['decoracao', 'arte', 'areas', 'texto']);
  });

  it('locks every layer but arte', () => {
    expect(layersOf(psd).map((item) => [item.name, item.protected?.all === true])).toEqual([
      ['decoracao', true],
      ['arte', false],
      ['areas', true],
      ['texto', true],
    ]);
    expect(named(psd, 'texto').protected).toMatchObject({
      transparency: true,
      composite: true,
      position: true,
    });
  });

  it('hides decoracao alone', () => {
    expect(layersOf(psd).map((item) => [item.name, item.hidden === true])).toEqual([
      ['decoracao', true],
      ['arte', false],
      ['areas', false],
      ['texto', false],
    ]);
  });

  it('fades areas to half', () => {
    // A PSD stores opacity as a byte: 128 / 255.
    expect(named(psd, 'areas').opacity).toBeCloseTo(0.5, 2);
    expect(named(psd, 'texto').opacity).toBe(1);
  });

  it('carries each painted layer as pixels the size of the frame, and arte as none', () => {
    const sizes = layersOf(psd).map((item) => [
      item.name,
      item.imageData?.width ?? 0,
      item.imageData?.height ?? 0,
    ]);
    expect(sizes).toEqual([
      ['decoracao', WIDTH, HEIGHT],
      ['arte', 0, 0],
      ['areas', WIDTH, HEIGHT],
      ['texto', WIDTH, HEIGHT],
    ]);
    expect([...(named(psd, 'texto').imageData?.data.slice(0, 4) ?? [])]).toEqual([255, 0, 0, 255]);
  });

  it('flattens the visible layers over one another, and leaves the hidden one out', () => {
    expect(pixelAt(psd, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(psd, 1)).toEqual([0, 0, 255, 128]);
    expect(pixelAt(psd, 2)).toEqual([0, 0, 0, 0]);
  });

  it('names a layer by its label', () => {
    const labelled = FULL_LAYERS.map((item) =>
      item.name === 'areas' ? { ...item, label: 'areas do texto' } : item,
    );
    expect(layersOf(written(frameOf(labelled))).map((item) => item.name)).toContain(
      'areas do texto',
    );
  });
});

describe('an inline canvas', () => {
  const arte = (width: number): GuideLayer => ({
    name: 'arte',
    label: `arte ${String(width)}px`,
    nodes: [],
    locked: false,
    visible: true,
    opacity: 1,
  });

  it('is one PSD per format with only arte, named by its width', () => {
    const square = written(frameOf([arte(920)], 'grid-1x1', 920, 560));
    const story = written(frameOf([arte(920)], 'story', 920, 1080));
    expect([square.width, square.height, story.width, story.height]).toEqual([920, 560, 920, 1080]);
    expect(layersOf(square).map((item) => [item.name, item.protected?.all === true])).toEqual([
      ['arte 920px', false],
    ]);
    expect(layersOf(story).map((item) => item.name)).toEqual(['arte 920px']);
  });
});

describe('what it refuses, as diagnostics', () => {
  it('a frame without a guide', () => {
    const { guide: _guide, ...plain } = frameOf(FULL_LAYERS);
    const result = exported(plain);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((item) => item.code)).toEqual(['E_RENDER_FAILED']);
    expect(result.error[0]?.message).toContain("Frame 'artwork-1:grid'");
    expect(result.error[0]?.message).toContain('no guide');
  });

  it('a painted layer with no raster, naming the layer', () => {
    const withoutRaster = ({ raster: _raster, ...rest }: GuideLayer): GuideLayer => rest;
    const missing = FULL_LAYERS.map((item) => (item.name === 'areas' ? withoutRaster(item) : item));
    const result = exported(frameOf(missing));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((item) => item.code)).toEqual(['E_RENDER_FAILED']);
    expect(result.error[0]?.message).toContain("'areas' has no raster");
  });

  it('a raster the host has no pixels for', () => {
    const result = exported(frameOf(FULL_LAYERS), { resources: { pixels: () => undefined } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((item) => item.code)).toEqual([
      'E_EXPORT_ASSET_UNRESOLVED',
      'E_EXPORT_ASSET_UNRESOLVED',
      'E_EXPORT_ASSET_UNRESOLVED',
    ]);
  });

  it('pixels of another size than the frame', () => {
    const result = exported(frameOf(FULL_LAYERS, 'grid', WIDTH + 1, HEIGHT));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.message).toContain('is 4×3 and the frame 5×3');
  });
});

describe('psdExporterPlugin', () => {
  it('registers the psd kind, answering bytes, with no rasterizer', async () => {
    const host = createPluginHost();
    host.activate(psdExporterPlugin({ resources }));
    const exporter = host.registry.exporters.forKind('psd');
    expect(exporter).toMatchObject({ extension: 'psd', rasterized: false });

    const frame = frameOf(FULL_LAYERS);
    const artwork: Artwork = { id: 'artwork-1', frames: [frame] };
    const answer = await exporter?.exportFrame(sceneOf(artwork), artwork, frame);
    expect(answer?.ok && answer.value instanceof Uint8Array).toBe(true);
  });
});
