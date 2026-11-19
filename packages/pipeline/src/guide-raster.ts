import {
  type Artwork,
  type AssetRef,
  type Diagnostic,
  type Frame,
  type GuideLayer,
  type Scene,
  diagnostic,
} from '@tyto/core';
import type { Exporter } from '@tyto/plugin-api';
import type { Rasterizer } from '@tyto/raster';

/**
 * The stage that turns a guide's layers into pixels before anything exports (ADR 0221).
 *
 * A layered file needs each layer as a picture, and an exporter receives only a `Scene`
 * (`AGENTS.md`, hard rules): so the pixels enter the IR here, as each layer's `raster`, and
 * the exporter that writes the file reads them from the Scene like any other asset. The
 * pictures are made the way a PNG export is made: the same frame through the HTML exporter
 * the job was given, with every top-level node outside the layer hidden, through the
 * `Rasterizer` port. Hidden, not removed: every node is absolutely positioned (`RESET` in
 * `export-html`), so `display: none` moves nothing else, and a mask's root is drawn whatever
 * its `visible` says.
 */

/** Bytes a stage of the job made, under the ref the Scene names them by. */
export interface StoredAsset {
  readonly ref: AssetRef;
  readonly bytes: Uint8Array;
}

export interface GuideRasterPorts {
  /** A `rasterized` exporter of `png`: the HTML exporter, as the job's registry answers it. */
  readonly exporter: Exporter;
  readonly rasterizer: Rasterizer;
}

export interface RasterizedGuide {
  /** The Scene with each layer's `raster` set; the same object when nothing had a guide. */
  readonly scene: Scene;
  /** One per raster, in the order the layers were walked. */
  readonly rasters: readonly StoredAsset[];
  /** One `E_RENDER_FAILED` per layer that could not be drawn; that layer has no raster. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The layer the designer paints in: it has nothing to draw, so it gets no raster. */
const PAINTED_LAYER = 'arte';

/** The layer the frame's background belongs to, since a background is no node (ADR 0220). */
const BACKGROUND_LAYER = 'decoracao';

export function hasGuide(scene: Scene): boolean {
  return scene.artworks.some((artwork) =>
    artwork.frames.some((frame) => frame.guide !== undefined),
  );
}

/**
 * The frame as one layer draws it: the layer's own nodes, every other top-level node hidden,
 * and the background only in `decoracao`. Exported for the test that measures the layout.
 */
export function layerFrame(frame: Frame, layer: GuideLayer): Frame {
  const shown = new Set(layer.nodes);
  const { background, guide: _guide, ...rest } = frame;
  return {
    ...rest,
    ...(layer.name === BACKGROUND_LAYER && background !== undefined ? { background } : {}),
    children: frame.children.map((child) =>
      shown.has(child.id) ? child : { ...child, visible: false },
    ),
  };
}

/**
 * FNV-1a, 32 bits, as hex: the ref's content hash. Not a security hash: two layers that
 * rasterise to the same bytes may share it, and that is the hash's job (`AssetRef.hash`).
 */
function contentHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
}

function layerFailure(artwork: Artwork, frame: Frame, layer: GuideLayer, problem: string) {
  return diagnostic('E_RENDER_FAILED', {
    frame: `${artwork.id}:${frame.format}`,
    kind: `the guide layer '${layer.name}'`,
    problem,
  });
}

type LayerAnswer =
  | { readonly ok: true; readonly raster: StoredAsset }
  | { readonly ok: false; readonly problems: readonly Diagnostic[] };

async function rasterOf(
  scene: Scene,
  artwork: Artwork,
  frame: Frame,
  layer: GuideLayer,
  ports: GuideRasterPorts,
): Promise<LayerAnswer> {
  const fail = (problem: string): LayerAnswer => ({
    ok: false,
    problems: [layerFailure(artwork, frame, layer, problem)],
  });

  const exported = await ports.exporter.exportFrame(scene, artwork, layerFrame(frame, layer));
  if (!exported.ok) return { ok: false, problems: exported.error };
  if (typeof exported.value !== 'string') {
    return fail(`the exporter '${ports.exporter.id}' answered bytes, not a document to raster`);
  }

  // The rasterizer takes whole pixels and leaves rounding to its caller, as `encode` does.
  const width = Math.round(frame.size.w);
  const height = Math.round(frame.size.h);
  if (width < 1 || height < 1) return fail('the frame measures no pixels at all');

  try {
    // A PNG keeps its alpha: with no background the rasterizer omits Chromium's white.
    const bytes = await ports.rasterizer.raster(exported.value, { width, height, format: 'png' });
    const ref: AssetRef = {
      id: `guide-layer:${artwork.id}:${frame.format}:${layer.name}`,
      source: 'inline',
      hash: contentHash(bytes),
      size: { w: width, h: height },
    };
    return { ok: true, raster: { ref, bytes } };
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
}

/**
 * Every guide layer but `arte` rasterised into the Scene (ADR 0221), one at a time.
 *
 * A Scene with no guide comes back as the same object, untouched, so a render that is not a
 * guide pays nothing. A layer that fails keeps no raster and says why; the others go on, as
 * one frame of twelve does in `runJob`.
 */
export async function rasterizeGuideLayers(
  scene: Scene,
  ports: GuideRasterPorts,
): Promise<RasterizedGuide> {
  if (!hasGuide(scene)) return { scene, rasters: [], diagnostics: [] };

  const rasters: StoredAsset[] = [];
  const diagnostics: Diagnostic[] = [];
  const artworks: Artwork[] = [];

  for (const artwork of scene.artworks) {
    const frames: Frame[] = [];
    for (const frame of artwork.frames) {
      if (frame.guide === undefined) {
        frames.push(frame);
        continue;
      }
      const layers: GuideLayer[] = [];
      for (const layer of frame.guide.layers) {
        if (layer.name === PAINTED_LAYER) {
          layers.push(layer);
          continue;
        }
        const answer = await rasterOf(scene, artwork, frame, layer, ports);
        if (answer.ok) {
          rasters.push(answer.raster);
          layers.push({ ...layer, raster: answer.raster.ref });
        } else {
          diagnostics.push(...answer.problems);
          layers.push(layer);
        }
      }
      frames.push({ ...frame, guide: { ...frame.guide, layers } });
    }
    artworks.push({ ...artwork, frames });
  }

  return { scene: { ...scene, artworks }, rasters, diagnostics };
}
