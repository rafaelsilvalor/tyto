import { type Diagnostic, type TemplateManifest, diagnostic, fileSafeName } from '@tyto/core';
import type { PsdResources, RgbaPixels } from '@tyto/export-psd';
import type { Artifact, StoredAsset } from '@tyto/pipeline';
import { PNG } from 'pngjs';

/**
 * `tyto render --guide` (TYTO-740, ADR 0220, ADR 0221): the composition a guide needs, and
 * nothing a stage could do itself.
 *
 * The pipeline rasterises each guide layer into the Scene and hands the PNG bytes to
 * `JobPorts.storeAssets`; the PSD exporter, registered as a built-in, asks a pixels port for
 * each layer's RGBA. The two meet here: a store the first fills and the second reads, and
 * the PNG decoding between them, which is an adapter's (`pngjs`), so it lives in the
 * composition root and not in the pure exporter.
 */

/** The kind the PSD exporter declares; a guide run asks for it and for nothing else. */
export const GUIDE_KIND = 'psd';

/** The artwork `compile` makes for an `inline` slot's canvas (ADR 0220's note). */
export const INLINE_CANVAS_PREFIX = 'external-art-';

export interface GuideStore {
  /** `JobPorts.storeAssets`: keeps each raster's PNG under its ref's id. */
  readonly keep: (assets: readonly StoredAsset[]) => void;
  /** Bound into the PSD exporter: the PNG kept under the ref, decoded to straight RGBA. */
  readonly resources: PsdResources;
}

export function guideStore(): GuideStore {
  const kept = new Map<string, Uint8Array>();
  return {
    keep: (assets) => {
      for (const asset of assets) kept.set(asset.ref.id, asset.bytes);
    },
    resources: {
      pixels: (ref): RgbaPixels | undefined => {
        const bytes = kept.get(ref.id);
        if (bytes === undefined) return undefined;
        // `pngjs` answers 8-bit RGBA whatever the file's colour type, which is the port's shape.
        const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        return {
          width: png.width,
          height: png.height,
          data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
        };
      },
    },
  };
}

/** True when any slot of the template declares art painted outside Tyto. */
export function declaresExternalArt(manifest: TemplateManifest): boolean {
  return Object.values(manifest.slots).some((slot) => slot.external !== undefined);
}

/** What a guide run says when the template has no art to guide. */
export function noExternalArt(manifest: TemplateManifest): Diagnostic {
  return diagnostic('E_GUIDE_NO_EXTERNAL_ART', { template: manifest.name });
}

/**
 * A guide's file name: `<artwork>-<format>.psd` for the artwork's own frame, and
 * `<slot>-<format>.psd` for an `inline` slot's canvas, whose artwork is `external-art-<slot>`.
 *
 * Not the render's `<format>-<NN>`: a guide holds two kinds of canvas per format, the piece
 * and each inline picture, and a person painting reads which is which in the name.
 */
export function guideArtifactName(artifact: Pick<Artifact, 'artwork' | 'format'>): string {
  const owner = artifact.artwork.startsWith(INLINE_CANVAS_PREFIX)
    ? artifact.artwork.slice(INLINE_CANVAS_PREFIX.length)
    : artifact.artwork;
  return `${fileSafeName(owner)}-${fileSafeName(artifact.format)}.${GUIDE_KIND}`;
}
