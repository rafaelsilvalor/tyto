import {
  type AssetRef,
  type AssetResolver,
  type Frame,
  type FormatCatalogue,
  type GuideLayer,
  type Scene,
  type Template,
  type TemplateBuild,
  type TemplateFiles,
  defineTemplate,
  parseFormats,
  parseManifest,
} from '@tyto/core';
import { exportFramePsd } from '@tyto/export-psd';
import { exportSvg } from '@tyto/export-svg';
import { compileTemplate, placeholderFont } from '@tyto/template-kit/testing';
import { initializeCanvas, readPsd } from 'ag-psd';
import { describe, expect, it } from 'vitest';

import arteSemArteBrief from '../templates/arte-teste/examples/sem-arte.brief?raw';
import arteManifest from '../templates/arte-teste/manifest.yaml?raw';
import { build as arteTeste } from '../templates/arte-teste/template.js';
import agenciaBrief from '../templates/banner-teste/examples/agencia.brief?raw';
import prefeituraBrief from '../templates/banner-teste/examples/prefeitura.brief?raw';
import bannerManifest from '../templates/banner-teste/manifest.yaml?raw';
import { build as bannerTeste } from '../templates/banner-teste/template.js';
import formatsYaml from '../templates/formats.yaml?raw';

/**
 * The bytes every built-in code template writes for its own example briefs (TYTO-453).
 *
 * Each example goes through the real `parseBrief` → `resolve` → `compile` → exporter chain,
 * by `compileTemplate` (ADR 0152), and every frame's HTML and SVG is compared to a committed
 * file. The template tests beside each template assert what a template means; these assert
 * what it writes, so a house-style token that moves — `PAPER`, a margin — turns this red
 * even where those tests import the very token they check.
 *
 * **The same on every machine, by construction.** Nothing is measured (no faces: text keeps
 * the lines the template broke it into), every face is `placeholderFont`'s name, and no image
 * is read — the brief's pictures and a template's own files answer a ref named after their
 * path, embedded as that name. So neither the fonts a machine has (the CI has no CircularXX)
 * nor whether Git LFS fetched a PNG reaches a snapshot.
 *
 * Moving a template to its own repository (E18) copies its block below; the snapshots that
 * follow it are the proof the move kept its bytes.
 */

const FORMATS: FormatCatalogue = valueOf(parseFormats(formatsYaml, 'formats.yaml'));

/** A ref that stands for the file at `path` without its bytes; its id is what gets embedded. */
function refAt(path: string): AssetRef {
  return { id: path, source: 'file', path, hash: `test-${path}` };
}

/** The brief's images, every one found, none read. */
const ASSETS: AssetResolver = {
  base: '(snapshot test)',
  resolve: (reference) => Promise.resolve(refAt(reference)),
};

/** A template's own folder (`assets/bg-banner.png`), every image found, no SVG in it. */
const FILES: TemplateFiles = {
  svg: () => undefined,
  image: refAt,
};

const placeholderAsset = (ref: AssetRef): string => `tyto-test-asset:${ref.id}`;

function valueOf<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error, undefined, 2));
  return result.value;
}

function templateOf(manifest: string, build: TemplateBuild): Template {
  return defineTemplate(valueOf(parseManifest(manifest, 'manifest.yaml')), build, FILES);
}

interface Example {
  /** The example's file name without `.brief`, which names its snapshots. */
  readonly name: string;
  readonly brief: string;
}

/**
 * Compiles one example and compares each frame with `__snapshots__/<template>/`, as
 * `<example>.<artwork>.<format>.html` and `.svg`.
 */
function snapshotsOf(template: Template, examples: readonly Example[]): void {
  for (const example of examples) {
    it(`writes the bytes it wrote for ${example.name}.brief`, async () => {
      const compiled = valueOf(
        await compileTemplate({
          brief: example.brief,
          template,
          formats: FORMATS,
          assets: ASSETS,
          asset: placeholderAsset,
        }),
      );
      const svg = svgOf(compiled.scene);
      expect(svg).toHaveLength(compiled.frames.length);

      const folder = `./__snapshots__/${template.manifest.name}`;
      for (const [index, frame] of compiled.frames.entries()) {
        const file = `${folder}/${example.name}.${frame.artwork}.${frame.format}`;
        await expect(frame.html).toMatchFileSnapshot(`${file}.html`);
        await expect(svg[index]).toMatchFileSnapshot(`${file}.svg`);
      }
    });
  }
}

function svgOf(scene: Scene): readonly string[] {
  const exported = exportSvg(scene, {
    resources: { font: placeholderFont, asset: placeholderAsset },
  });
  return valueOf(exported).map((frame) => frame.svg);
}

describe('banner-teste', () => {
  snapshotsOf(templateOf(bannerManifest, bannerTeste), [
    { name: 'agencia', brief: agenciaBrief },
    { name: 'prefeitura', brief: prefeituraBrief },
  ]);
});

// External art with no file yet (ADR 0220): both pictures are outlined boxes where they go.
describe('arte-teste', () => {
  snapshotsOf(templateOf(arteManifest, arteTeste), [{ name: 'sem-arte', brief: arteSemArteBrief }]);
});

const NEWLINE = '\n';

/** JSON with every value that fits on a line written on one, so a diff reads node by node. */
function compactJson(value: unknown, indent = ''): string {
  const flat = JSON.stringify(value);
  if (flat.length + indent.length <= 100 || value === null || typeof value !== 'object') {
    return flat;
  }
  const inner = `${indent}  `;
  const lines = Array.isArray(value)
    ? value.map((item) => inner + compactJson(item, inner))
    : Object.entries(value).map(
        ([key, item]) => `${inner}${JSON.stringify(key)}: ${compactJson(item, inner)}`,
      );
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return [open, lines.join(`,${NEWLINE}`), `${indent}${close}`].join(NEWLINE);
}

/**
 * The guide for the same brief (ADR 0220), as the Scene `compile(..., { guide: true })` hands
 * the layered-file exporter: the frame of each format cut into layers, the title's area, and
 * the `inline` picture's own canvas per format. JSON, because what is pinned is the layering,
 * which no HTML or SVG shows.
 */
describe('arte-teste guide', () => {
  it('writes the guide Scene it wrote for sem-arte.brief', async () => {
    const compiled = valueOf(
      await compileTemplate({
        brief: arteSemArteBrief,
        template: templateOf(arteManifest, arteTeste),
        formats: FORMATS,
        assets: ASSETS,
        asset: placeholderAsset,
        guide: true,
      }),
    );
    expect(compiled.scene.artworks.map((artwork) => artwork.id)).toEqual([
      'artwork-1',
      'external-art-imagem',
    ]);
    await expect(compactJson(compiled.scene) + NEWLINE).toMatchFileSnapshot(
      './__snapshots__/arte-teste/sem-arte.guide.json',
    );
  });
});

/**
 * The same guide written as PSDs (ADR 0221), each painted layer standing in for the raster
 * the pipeline would draw with a transparent picture of the frame's size, read back with
 * `ag-psd`. What is pinned is the file's shape per frame: size, and each layer bottom first
 * with its lock, visibility and opacity. The pixels are `@tyto/export-psd`'s own tests'.
 */
describe('arte-teste guide as PSD', () => {
  // `ag-psd` reads pixel buffers through `createImageData`, which needs a canvas unless it
  // is handed a plain one; Node has no canvas, and the writer is never handed one.
  type ImageDataMaker = NonNullable<Parameters<typeof initializeCanvas>[1]>;
  initializeCanvas(
    () => {
      throw new Error('a canvas was asked for');
    },
    ((width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    })) as unknown as ImageDataMaker,
  );

  const withRaster = (artwork: string, frame: Frame, layer: GuideLayer): GuideLayer =>
    layer.name === 'arte'
      ? layer
      : {
          ...layer,
          raster: {
            id: `guide-layer:${artwork}:${frame.format}:${layer.name}`,
            source: 'inline',
            hash: 'test',
            size: frame.size,
          },
        };

  it('writes one PSD per frame, four layers for the full art and arte alone inline', async () => {
    const compiled = valueOf(
      await compileTemplate({
        brief: arteSemArteBrief,
        template: templateOf(arteManifest, arteTeste),
        formats: FORMATS,
        assets: ASSETS,
        asset: placeholderAsset,
        guide: true,
      }),
    );
    const pixels = (ref: AssetRef) => {
      const width = ref.size?.w ?? 0;
      const height = ref.size?.h ?? 0;
      return { width, height, data: new Uint8Array(width * height * 4) };
    };

    const files = compiled.scene.artworks.flatMap((artwork) =>
      artwork.frames.map((frame) => {
        const guide = frame.guide;
        const rastered: Frame =
          guide === undefined
            ? frame
            : {
                ...frame,
                guide: {
                  ...guide,
                  layers: guide.layers.map((layer) => withRaster(artwork.id, frame, layer)),
                },
              };
        const bytes = valueOf(
          exportFramePsd(compiled.scene, artwork, rastered, { resources: { pixels } }),
        );
        const psd = readPsd(bytes, { useImageData: true, skipThumbnail: true });
        const layers = (psd.children ?? []).map((layer) =>
          [
            layer.name,
            layer.protected?.all === true ? 'locked' : 'open',
            layer.hidden === true ? 'hidden' : 'shown',
            Math.round((layer.opacity ?? 1) * 100),
          ].join(' '),
        );
        return `${artwork.id} ${frame.format} ${String(psd.width)}x${String(psd.height)}: ${layers.join(', ')}`;
      }),
    );

    expect(files).toEqual([
      'artwork-1 grid-1x1 1080x1080: decoracao locked hidden 100, arte open shown 100, areas locked shown 50, texto locked shown 100',
      'artwork-1 story 1080x1920: decoracao locked hidden 100, arte open shown 100, areas locked shown 50, texto locked shown 100',
      'external-art-imagem grid-1x1 920x560: arte 920px open shown 100',
      'external-art-imagem story 920x1080: arte 920px open shown 100',
    ]);
  });
});
