import type {
  Artwork,
  AssetRef,
  Diagnostic,
  Diagnostics,
  Frame,
  GuideLayer,
  Result,
  Scene,
} from '@tyto/core';
import { diagnostic, err, ok } from '@tyto/core';
import { type Layer, type Psd, writePsdUint8Array } from 'ag-psd';

import { type CompositeLayer, type RgbaPixels, compositeOver } from './composite.js';

/**
 * What the PSD exporter is handed, bound at registration (ADR 0221): the decoded pixels of
 * a guide layer's `raster`. The host decodes the stored PNG; the exporter never sees a PNG.
 * `undefined` when the host has no bytes under the ref's id.
 */
export interface PsdResources {
  readonly pixels?: (ref: AssetRef) => RgbaPixels | undefined;
}

export interface PsdExportOptions {
  readonly resources?: PsdResources;
}

/**
 * Locked in every way Photoshop offers: pixels, transparency, position, and the "lock all"
 * bit its padlock button sets. A guide's painted layers are a reference, not a draft.
 */
const LOCKED: NonNullable<Layer['protected']> = {
  transparency: true,
  composite: true,
  position: true,
  all: true,
};

/** `arte` is where the designer paints, so it is the one layer that has no pixels. */
const PAINTED_HERE = 'arte';

function frameName(artwork: Artwork, frame: Frame): string {
  return `${artwork.id}:${frame.format}`;
}

function failure(artwork: Artwork, frame: Frame, problem: string): Diagnostic {
  return diagnostic('E_RENDER_FAILED', { frame: frameName(artwork, frame), kind: 'psd', problem });
}

type LayerPixels =
  | { readonly ok: true; readonly pixels: RgbaPixels | undefined }
  | { readonly ok: false; readonly problem: Diagnostic };

/** A layer's pixels at the document's size, or why it has none it should have. */
function pixelsOf(
  artwork: Artwork,
  frame: Frame,
  layer: GuideLayer,
  size: { readonly width: number; readonly height: number },
  resources: PsdResources,
): LayerPixels {
  if (layer.raster === undefined) {
    if (layer.name === PAINTED_HERE) return { ok: true, pixels: undefined };
    return {
      ok: false,
      problem: failure(
        artwork,
        frame,
        `the guide layer '${layer.name}' has no raster; the pipeline's rasterizeGuideLayers draws one`,
      ),
    };
  }
  const pixels = resources.pixels?.(layer.raster);
  if (pixels === undefined) {
    return {
      ok: false,
      problem: diagnostic('E_EXPORT_ASSET_UNRESOLVED', {
        asset: layer.raster.id,
        node: `guide layer '${layer.name}'`,
      }),
    };
  }
  if (
    pixels.width !== size.width ||
    pixels.height !== size.height ||
    pixels.data.length !== size.width * size.height * 4
  ) {
    return {
      ok: false,
      problem: failure(
        artwork,
        frame,
        `the guide layer '${layer.name}' is ${String(pixels.width)}×${String(pixels.height)} ` +
          `and the frame ${String(size.width)}×${String(size.height)}`,
      ),
    };
  }
  return { ok: true, pixels };
}

function psdLayer(layer: GuideLayer, pixels: RgbaPixels | undefined): Layer {
  return {
    name: layer.label,
    opacity: layer.opacity,
    hidden: !layer.visible,
    ...(layer.locked ? { protected: LOCKED } : {}),
    ...(pixels === undefined
      ? {}
      : {
          left: 0,
          top: 0,
          right: pixels.width,
          bottom: pixels.height,
          imageData: { width: pixels.width, height: pixels.height, data: pixels.data },
        }),
  };
}

/**
 * One guide frame as a layered PSD (ADR 0220, ADR 0221).
 *
 * The document is the frame's size, rounded to whole pixels, as the raster stage drew each
 * layer. Its layers are the guide's, in the guide's order, each named by its `label`, with
 * its lock, visibility and opacity; `arte` is left empty, every other layer is its raster.
 * A full frame writes `texto`, `areas`, `arte` and `decoracao`; an `inline` canvas writes
 * `arte` alone, named by its width.
 *
 * Nothing is written when anything is missing: a guide without a layer the designer counts on
 * is worse than no guide, since it looks complete. A frame without `guide`, a painted layer
 * with no raster, pixels the host cannot supply or of the wrong size are each one diagnostic,
 * never a throw. Scene diagnostics carry no source range, so each names its frame
 * (`<artwork>:<format>`) as the other exporters' do.
 */
export function exportFramePsd(
  _scene: Scene,
  artwork: Artwork,
  frame: Frame,
  options: PsdExportOptions = {},
): Result<Uint8Array, Diagnostics> {
  const guide = frame.guide;
  if (guide === undefined) {
    return err([
      failure(
        artwork,
        frame,
        'it has no guide; a PSD is written from compile(..., { guide: true })',
      ),
    ]);
  }

  const size = { width: Math.round(frame.size.w), height: Math.round(frame.size.h) };
  if (size.width < 1 || size.height < 1) {
    return err([failure(artwork, frame, 'it has no area to paint on')]);
  }

  const problems: Diagnostic[] = [];
  const layers: Layer[] = [];
  const visible: CompositeLayer[] = [];
  // The guide lists its layers top first; a PSD stacks them bottom first.
  for (const layer of [...guide.layers].reverse()) {
    const answer = pixelsOf(artwork, frame, layer, size, options.resources ?? {});
    if (!answer.ok) {
      problems.push(answer.problem);
      continue;
    }
    layers.push(psdLayer(layer, answer.pixels));
    if (layer.visible && answer.pixels !== undefined) {
      visible.push({ pixels: answer.pixels, opacity: layer.opacity });
    }
  }
  if (problems.length > 0) return err(problems);

  const composite = compositeOver(size.width, size.height, visible);
  const psd: Psd = {
    width: size.width,
    height: size.height,
    children: layers,
    imageData: composite,
  };
  // `noBackground`: a bottom layer with no transparent pixel (a `decoracao` painting the
  // frame's background) would otherwise become Photoshop's "Background", which cannot be
  // hidden or faded and would lose what the guide says about it.
  try {
    return ok(writePsdUint8Array(psd, { generateThumbnail: false, noBackground: true }));
  } catch (thrown) {
    // `ag-psd` reports a document it cannot write by throwing; this stage answers a Result.
    const problem = thrown instanceof Error ? thrown.message : String(thrown);
    return err([failure(artwork, frame, `ag-psd could not write it: ${problem}`)]);
  }
}
