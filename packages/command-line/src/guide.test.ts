import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRenderResult } from '@tyto/io';
import type { Rasterizer } from '@tyto/raster';
import { type Psd, initializeCanvas, readPsd } from 'ag-psd';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { guideArtifactName } from './guide.js';
import { run } from './program.js';

import briefSource from './__fixtures__/cartaz.brief?raw';
import formatsSource from './__fixtures__/formats.yaml?raw';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import markSource from './__fixtures__/mark.svg?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * `tyto render --guide` end to end with a fake browser (TYTO-740): the built-in `arte-teste`
 * template, the files a guide writes and their names, and the run that has nothing to guide.
 * What the layers look like is the visual suite's (`guide.visual.test.ts`), with a real one.
 *
 * The fake answers a real PNG of the size it is asked for, so the pixels port decodes what
 * a browser would have handed it and the PSD exporter checks the size it always checks.
 */

/** `ag-psd` reads through `createImageData`; Node has none, so it gets a plain one. */
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

const ARTE_TESTE_BRIEF = `---
template: arte-teste
formats: [grid-1x1, story]
---
::titulo
  Uma peça com arte **pintada fora**
`;

let workspace: string;
let out: string[];
let errors: string[];
let rastered: { width: number; height: number }[];

/** A grey picture of the size asked for, as a browser's PNG would be. */
function pngRasterizer(): Rasterizer {
  return {
    raster: (_html, options) => {
      rastered.push({ width: options.width, height: options.height });
      const png = new PNG({ width: options.width, height: options.height });
      png.data.fill(128);
      return Promise.resolve(new Uint8Array(PNG.sync.write(png)));
    },
  };
}

function environment(): CliEnvironment {
  return {
    console: { out: (text) => out.push(text), err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    rasterizer: () => pngRasterizer(),
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-guide-'));
  out = [];
  errors = [];
  rastered = [];
  await writeFile(join(workspace, 'arte.brief'), ARTE_TESTE_BRIEF);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function psdAt(name: string): Promise<Psd> {
  const bytes = await readFile(join(workspace, 'out', name));
  return readPsd(new Uint8Array(bytes), { useImageData: true, skipThumbnail: true });
}

// Six full-size PNGs encoded and decoded and four PSDs written: seconds, more under load.
describe('tyto render --guide', { timeout: 30_000 }, () => {
  it('writes the piece per format and each inline picture per format, named for a person', async () => {
    const code = await run(
      ['render', 'arte.brief', '--guide', '--out', 'out', '--no-google-fonts'],
      environment(),
    );
    expect(errors.join('')).not.toContain('error');
    expect(code).toBe(EXIT_OK);

    const files = (await readdir(join(workspace, 'out'))).sort();
    expect(files).toEqual([
      'artwork-1-grid-1x1.psd',
      'artwork-1-story.psd',
      'imagem-grid-1x1.psd',
      'imagem-story.psd',
      'result.json',
    ]);

    // `result.json` names the files the folder holds, not the render's `<format>-<NN>`.
    const result = parseRenderResult(
      JSON.parse(await readFile(join(workspace, 'out', 'result.json'), 'utf8')),
    );
    if (!result.ok) throw new Error('result.json does not parse');
    expect(result.value.artifacts.map((artifact) => artifact.name).sort()).toEqual(
      files.slice(0, 4),
    );
    expect(out.join('').split('\n').filter(Boolean).sort()).toEqual(files.slice(0, 4));

    // Three painted layers per piece (texto, areas, decoracao), none for an inline canvas.
    expect(rastered).toEqual([
      ...Array.from({ length: 3 }, () => ({ width: 1080, height: 1080 })),
      ...Array.from({ length: 3 }, () => ({ width: 1080, height: 1920 })),
    ]);
  });

  it('writes the piece at the format size with the four layers, top first', async () => {
    await run(
      ['render', 'arte.brief', '--guide', '--out', 'out', '--no-google-fonts'],
      environment(),
    );

    for (const [name, height] of [
      ['artwork-1-grid-1x1.psd', 1080],
      ['artwork-1-story.psd', 1920],
    ] as const) {
      const psd = await psdAt(name);
      expect({ width: psd.width, height: psd.height }, name).toEqual({ width: 1080, height });
      // `ag-psd` lists layers bottom first.
      expect(psd.children?.map((layer) => layer.name).reverse()).toEqual([
        'texto',
        'areas',
        'arte',
        'decoracao',
      ]);
    }
  });

  it('writes each inline picture at the width the manifest declares for that format', async () => {
    await run(
      ['render', 'arte.brief', '--guide', '--out', 'out', '--no-google-fonts'],
      environment(),
    );

    // `arte-teste`'s manifest: 920 wide in both, 560 and 1080 suggested high.
    for (const [name, height] of [
      ['imagem-grid-1x1.psd', 560],
      ['imagem-story.psd', 1080],
    ] as const) {
      const psd = await psdAt(name);
      expect({ width: psd.width, height: psd.height }, name).toEqual({ width: 920, height });
      expect(psd.children?.map((layer) => layer.name)).toEqual(['arte 920px']);
    }
  });

  it('refuses a template with no external art, and writes no guide', async () => {
    const template = join(workspace, 'templates', 'cartaz');
    await mkdir(join(template, 'assets'), { recursive: true });
    await writeFile(join(template, 'manifest.yaml'), manifestSource);
    await writeFile(join(template, 'template.html'), templateMarkup);
    await writeFile(join(template, 'assets', 'mark.svg'), markSource);
    await writeFile(join(workspace, 'formats.yaml'), formatsSource);
    await writeFile(join(workspace, 'cartaz.brief'), briefSource);

    const code = await run(
      ['render', 'cartaz.brief', '--guide', '--out', 'out', '--no-google-fonts'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_GUIDE_NO_EXTERNAL_ART');
    expect(errors.join('')).toContain("Template 'cartaz' declares no slot with external art");
    // `result.json` is the contract's even for a failed run (ADR 0011); no artwork beside it.
    expect(await readdir(join(workspace, 'out'))).toEqual(['result.json']);
    expect(rastered).toEqual([]);
  });

  it('refuses --guide beside --types, which a guide decides', async () => {
    const code = await run(
      ['render', 'arte.brief', '--guide', '--types', 'png', '--out', 'out'],
      environment(),
    );
    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain("option '--guide' cannot be used with option '--types");
  });

  it('refuses psd as a type, since only a guide has the layers it writes', async () => {
    const code = await run(
      ['render', 'arte.brief', '--types', 'psd', '--out', 'out'],
      environment(),
    );
    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('ask for it with --guide');
  });
});

describe('guideArtifactName', () => {
  it('names the piece by its artwork and an inline canvas by its slot', () => {
    expect(guideArtifactName({ artwork: 'artwork-1', format: 'story' })).toBe(
      'artwork-1-story.psd',
    );
    expect(guideArtifactName({ artwork: 'external-art-imagem', format: 'grid-1x1' })).toBe(
      'imagem-grid-1x1.psd',
    );
  });
});
