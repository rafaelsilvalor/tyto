import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type PlaywrightRasterizer, createPlaywrightRasterizer } from '@tyto/raster';
import { type Layer, type Psd, initializeCanvas, readPsd } from 'ag-psd';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * TYTO-740's measurement: the guide a designer opens is the piece they will paint under.
 *
 * Two runs of `tyto render` over the built-in `arte-teste`, through a real browser: one writes
 * the PNG of the brief, one writes the guide. Read back from the PSD, `decoracao` (the frame's
 * background) with `texto` drawn over it must be that PNG, wherever the guide's `areas` layer
 * paints nothing — `areas` holds every external slot's outlined box and each slot's outline
 * and label, which the PNG draws only in part (the boxes) and the guide draws at half opacity.
 * And every pixel the PNG paints in the boxes' magenta must lie under `areas`, so the boxes
 * the guide outlines are the ones the render draws.
 *
 * ## The tolerance, and why it is not zero
 *
 * The PNG draws the title straight onto the background; the guide draws it alone onto
 * transparency, stores it 8 bits per channel with straight alpha, and the composite puts it
 * back. An antialiased edge pixel loses a little in each of those roundings (ADR 0221: about
 * one step per channel). {@link TOLERANCE} is the largest channel difference allowed; the
 * test prints the largest it measured and how many pixels it compared.
 *
 * The control is the same comparison with the art boxes left in: the PNG's magenta outlines
 * are not in `decoracao` or `texto`, so it must fail by far more than the tolerance.
 *
 * Run with `TYTO_RASTER_CHANNEL=chrome` on a machine with no `playwright install`.
 */

/** Largest difference in any channel of any compared pixel, 0–255. */
const TOLERANCE = 2;

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

const BRIEF = `---
template: arte-teste
formats: [grid-1x1, story]
---
::titulo
  Uma peça com arte **pintada fora**
`;

const CHANNEL = process.env['TYTO_RASTER_CHANNEL'];

let workspace: string;
let rasterizer: PlaywrightRasterizer;

function environment(): CliEnvironment {
  return {
    console: { out: () => undefined, err: (text) => process.stderr.write(text) },
    version: '0.0.0-test',
    cwd: workspace,
    rasterizer: () => ({ raster: (html, options) => rasterizer.raster(html, options) }),
  };
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-guide-visual-'));
  rasterizer = createPlaywrightRasterizer(CHANNEL === undefined ? {} : { channel: CHANNEL });
  await writeFile(join(workspace, 'arte.brief'), BRIEF);
  const flags = ['--no-google-fonts'];
  expect(await run(['render', 'arte.brief', '--out', 'png', ...flags], environment())).toBe(
    EXIT_OK,
  );
  expect(
    await run(['render', 'arte.brief', '--guide', '--out', 'guide', ...flags], environment()),
  ).toBe(EXIT_OK);
});

afterAll(async () => {
  await rasterizer.close();
  await rm(workspace, { recursive: true, force: true });
});

interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

async function pngAt(name: string): Promise<Rgba> {
  const png = PNG.sync.read(await readFile(join(workspace, 'png', name)));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

async function psdAt(name: string): Promise<Psd> {
  const bytes = new Uint8Array(await readFile(join(workspace, 'guide', name)));
  return readPsd(bytes, { useImageData: true, skipThumbnail: true });
}

/** A layer's pixels placed on the document, transparent where the layer has none. */
function layerOf(psd: Psd, name: string): Rgba {
  const layer = psd.children?.find((child: Layer) => child.name === name);
  if (layer === undefined) throw new Error(`no layer '${name}'`);
  const data = new Uint8Array(psd.width * psd.height * 4);
  const image = layer.imageData;
  if (image !== undefined) {
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const from = (y * image.width + x) * 4;
        const to = ((top + y) * psd.width + left + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          data[to + channel] = image.data[from + channel] ?? 0;
        }
      }
    }
  }
  return { width: psd.width, height: psd.height, data };
}

/** `top` over `bottom`, straight alpha, as the PSD exporter's own composite draws it. */
function over(bottom: Rgba, top: Rgba): Rgba {
  const data = new Uint8Array(bottom.data.length);
  for (let index = 0; index < data.length; index += 4) {
    const topAlpha = (top.data[index + 3] ?? 0) / 255;
    const bottomAlpha = (bottom.data[index + 3] ?? 0) / 255;
    const alpha = topAlpha + bottomAlpha * (1 - topAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      const value =
        alpha === 0
          ? 0
          : ((top.data[index + channel] ?? 0) * topAlpha +
              (bottom.data[index + channel] ?? 0) * bottomAlpha * (1 - topAlpha)) /
            alpha;
      data[index + channel] = Math.round(value);
    }
    data[index + 3] = Math.round(alpha * 255);
  }
  return { width: bottom.width, height: bottom.height, data };
}

interface Compared {
  /** Largest channel difference over the compared pixels. */
  readonly max: number;
  readonly compared: number;
  readonly total: number;
}

function compare(expected: Rgba, actual: Rgba, skip: (pixel: number) => boolean): Compared {
  let max = 0;
  let compared = 0;
  for (let pixel = 0; pixel < expected.width * expected.height; pixel += 1) {
    if (skip(pixel)) continue;
    compared += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const index = pixel * 4 + channel;
      max = Math.max(max, Math.abs((expected.data[index] ?? 0) - (actual.data[index] ?? 0)));
    }
  }
  return { max, compared, total: expected.width * expected.height };
}

/** The gap colour (ADR 0035) the art boxes are outlined in, with the edge's antialiasing. */
function magenta(image: Rgba, pixel: number): boolean {
  const red = image.data[pixel * 4] ?? 0;
  const green = image.data[pixel * 4 + 1] ?? 0;
  const blue = image.data[pixel * 4 + 2] ?? 0;
  return red > 200 && green < 80 && blue > 120;
}

/** The title's dark ink (`arte-teste`'s `#1f2933`), which no area outline or label is drawn in. */
function ink(image: Rgba, pixel: number): boolean {
  const red = image.data[pixel * 4] ?? 0;
  const green = image.data[pixel * 4 + 1] ?? 0;
  const blue = image.data[pixel * 4 + 2] ?? 0;
  return red < 80 && green < 80 && blue < 80;
}

describe.each([
  ['grid-1x1', 'grid-1x1-01.png', 'artwork-1-grid-1x1.psd'],
  ['story', 'story-01.png', 'artwork-1-story.psd'],
])('the %s guide', (format, pngName, psdName) => {
  it('is the render under texto and decoracao, wherever areas paints nothing', async () => {
    const render = await pngAt(pngName);
    const psd = await psdAt(psdName);
    expect({ width: psd.width, height: psd.height }).toEqual({
      width: render.width,
      height: render.height,
    });

    const areas = layerOf(psd, 'areas');
    const underAreas = (pixel: number): boolean => (areas.data[pixel * 4 + 3] ?? 0) > 0;
    const texto = layerOf(psd, 'texto');
    const guide = over(layerOf(psd, 'decoracao'), texto);
    // The title is compared, not masked out with the areas: its pixels are counted.
    // Measured before this check existed: every title pixel lay under `areas`, because a
    // hidden text was drawn in every layer, and the comparison passed at 0 over the
    // background alone. Each layer holds only its own ink now, and that is counted.
    let titlePixels = 0;
    let magentaInTexto = 0;
    let inkInAreas = 0;
    for (let pixel = 0; pixel < render.width * render.height; pixel += 1) {
      const inTexto = (texto.data[pixel * 4 + 3] ?? 0) > 0;
      if (inTexto && !underAreas(pixel)) titlePixels += 1;
      if (inTexto && magenta(texto, pixel)) magentaInTexto += 1;
      if ((areas.data[pixel * 4 + 3] ?? 0) > 128 && ink(areas, pixel)) inkInAreas += 1;
    }

    const measured = compare(render, guide, underAreas);
    // The control: the boxes left in, so the PNG's magenta outlines are compared too.
    const control = compare(render, guide, () => false);
    // How many of the render's magenta pixels `areas` covers: all of them.
    let boxPixels = 0;
    let uncovered = 0;
    for (let pixel = 0; pixel < render.width * render.height; pixel += 1) {
      if (!magenta(render, pixel)) continue;
      boxPixels += 1;
      if (!underAreas(pixel)) uncovered += 1;
    }

    process.stdout.write(
      `guide ${format}: max channel difference ${String(measured.max)} over ` +
        `${String(measured.compared)} of ${String(measured.total)} pixels (tolerance ` +
        `${String(TOLERANCE)}); control without the areas mask: ${String(control.max)}; ` +
        `magenta box pixels under areas: ${String(boxPixels - uncovered)} of ${String(boxPixels)}; ` +
        `title pixels compared: ${String(titlePixels)}; magenta in texto: ` +
        `${String(magentaInTexto)}; title ink in areas: ${String(inkInAreas)}\n`,
    );

    expect(measured.compared).toBeGreaterThan(measured.total * 0.9);
    expect(measured.max).toBeLessThanOrEqual(TOLERANCE);
    expect(control.max).toBeGreaterThan(TOLERANCE * 10);
    expect(titlePixels).toBeGreaterThan(1000);
    expect(magentaInTexto).toBe(0);
    expect(inkInAreas).toBe(0);
    expect(boxPixels).toBeGreaterThan(0);
    expect(uncovered).toBe(0);
  });
});

describe('the inline guide', () => {
  it.each([
    ['imagem-grid-1x1.psd', 560],
    ['imagem-story.psd', 1080],
  ])('%s is as wide as the manifest declares', async (name, height) => {
    const psd = await psdAt(name);
    expect({ width: psd.width, height: psd.height }).toEqual({ width: 920, height });
    process.stdout.write(`inline ${name}: ${String(psd.width)}×${String(psd.height)}\n`);
  });
});
