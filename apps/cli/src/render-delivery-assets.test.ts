import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { run } from './program.js';

import briefSource from './__fixtures__/cartaz.brief?raw';
import formatsSource from './__fixtures__/formats.yaml?raw';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import markSource from './__fixtures__/mark.svg?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * `tyto render --delivery` copies the images its brief uses from outside the delivery into the
 * delivery's `assets/` (ADR 0161, TYTO-499). The `cli.test.ts` setup, cut to what a delivery
 * needs: the `cartaz` template, and the real `--types svg` path with no fake anywhere.
 */

/** A real 1×1 PNG, so the asset resolver has bytes to hash and a file to find. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const NAME = 'mca-1_promo';

let workspace: string;
let errors: string[];

const delivery = (...segments: string[]) => join(workspace, NAME, ...segments);
const listed = async (...segments: string[]) => [...(await readdir(delivery(...segments)))].sort();

function environment(): CliEnvironment {
  return {
    console: { out: () => undefined, err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    // `--types svg` draws no PNG; a rasterizer asked for anyway is a test that went wrong.
    rasterizer: () => ({
      raster: () => Promise.reject(new Error('this suite renders svg only')),
    }),
  };
}

const render = () =>
  run(['render', `${NAME}/editaveis/${NAME}.brief`, '--delivery', '--types', 'svg'], environment());

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-cli-delivery-assets-'));
  errors = [];
  const template = join(workspace, 'templates', 'cartaz');
  await mkdir(join(template, 'assets'), { recursive: true });
  await writeFile(join(template, 'manifest.yaml'), manifestSource);
  await writeFile(join(template, 'template.html'), templateMarkup);
  await writeFile(join(template, 'assets', 'mark.svg'), markSource);
  await writeFile(join(workspace, 'formats.yaml'), formatsSource);

  // The brief's `./logo.png` sits beside it in editaveis/, outside the delivery's assets/.
  await mkdir(delivery('editaveis'), { recursive: true });
  await writeFile(delivery('editaveis', `${NAME}.brief`), briefSource);
  await writeFile(delivery('editaveis', 'logo.png'), LOGO_PNG);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('tyto render --delivery copies the brief’s images (ADR 0161)', () => {
  it('copies an image from outside assets/ into it, and leaves the brief as written', async () => {
    const code = await render();

    expect(code, errors.join('')).toBe(EXIT_OK);
    expect(await listed('assets')).toEqual(['logo.png']);
    expect(await readFile(delivery('assets', 'logo.png'))).toEqual(LOGO_PNG);
    expect(await readFile(delivery('editaveis', `${NAME}.brief`), 'utf8')).toBe(briefSource);
  });

  it('keeps a different same-named file in assets/ and warns, removing nothing', async () => {
    await mkdir(delivery('assets'), { recursive: true });
    await writeFile(delivery('assets', 'logo.png'), 'the person’s own logo');
    await writeFile(delivery('assets', 'outra.png'), 'unused by the brief');

    const code = await render();

    expect(code, errors.join('')).toBe(EXIT_OK);
    expect(errors.join('')).toContain(
      `warning W_DELIVERY_ASSET_KEPT Kept '${delivery('assets', 'logo.png')}'`,
    );
    expect(await readFile(delivery('assets', 'logo.png'), 'utf8')).toBe('the person’s own logo');
    expect(await listed('assets')).toEqual(['logo.png', 'outra.png']);
  });

  it('copies nothing for a run whose frames failed (ADR 0054: it did not finish)', async () => {
    // The image resolves before the frames are drawn; the rasterizer then refuses every one.
    const code = await run(
      ['render', `${NAME}/editaveis/${NAME}.brief`, '--delivery', '--types', 'png'],
      environment(),
    );

    expect(code).not.toBe(EXIT_OK);
    expect(errors.join('')).toContain('error');
    expect(await listed()).not.toContain('assets');
  });

  it('says nothing the second time, when assets/ already holds the same bytes', async () => {
    await render();
    errors = [];

    const code = await render();

    expect(code, errors.join('')).toBe(EXIT_OK);
    expect(errors.join('')).not.toContain('W_DELIVERY_ASSET_KEPT');
    expect(await listed('assets')).toEqual(['logo.png']);
  });
});
