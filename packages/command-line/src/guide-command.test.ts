import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Rasterizer } from '@tyto/raster';
import { initializeCanvas, readPsd } from 'ag-psd';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * `tyto guide` end to end over the built-in `arte-teste` (TYTO-741, ADR 0222), with a fake
 * browser that answers a real PNG, so each PSD written is a real one read back here. Nothing
 * is opened: `--open` reaches a fake that records the path.
 */

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
fundo: fundo.png
---
::titulo
  Uma peça com arte **pintada fora**
`;

let workspace: string;
let out: string[];
let errors: string[];
let opened: string[];
let rasterizers: number;

function pngRasterizer(): Rasterizer {
  rasterizers += 1;
  return {
    raster: (_html, options) => {
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
    openFile: (path) => {
      opened.push(path);
      return Promise.resolve();
    },
  };
}

async function guide(...words: string[]): Promise<number> {
  return run(['guide', 'arte.brief', '--no-google-fonts', ...words], environment());
}

/** Back-dates the brief, so a guide written now is newer than it, as one painted in would be. */
async function briefOlderThanGuides(): Promise<void> {
  const past = new Date(Date.now() - 60_000);
  await utimes(join(workspace, 'arte.brief'), past, past);
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-guide-verb-'));
  out = [];
  errors = [];
  opened = [];
  rasterizers = 0;
  await writeFile(join(workspace, 'arte.brief'), BRIEF);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('tyto guide', { timeout: 30_000 }, () => {
  it('lists the cited file, a guide per format with its state, and the slot left uncited', async () => {
    expect(await guide('--list')).toBe(EXIT_OK);
    expect(out.join('')).toBe(
      [
        'fundo (full): fundo.png, line 4',
        `  grid-1x1: guide ${join('assets', 'fundo.grid-1x1.guide.psd')} missing; art ${join('assets', 'fundo.grid-1x1.png')} missing`,
        `  story: guide ${join('assets', 'fundo.story.guide.psd')} missing; art ${join('assets', 'fundo.story.png')} missing`,
        'imagem (inline): not cited; add "imagem: imagem.png" to the brief',
        '',
      ].join('\n'),
    );
    expect(rasterizers).toBe(0);
    expect(await readdir(workspace)).toEqual(['arte.brief']);
  });

  it("writes each format's guide beside the cited file, named after it, as real PSDs", async () => {
    expect(await guide()).toBe(EXIT_OK);
    expect(errors.join('')).toBe('');
    const assets = join(workspace, 'assets');
    expect((await readdir(assets)).sort()).toEqual([
      'fundo.grid-1x1.guide.psd',
      'fundo.story.guide.psd',
    ]);
    expect(out.join('')).toBe(
      `${join('assets', 'fundo.grid-1x1.guide.psd')}\n${join('assets', 'fundo.story.guide.psd')}\n`,
    );
    for (const [name, height] of [
      ['fundo.grid-1x1.guide.psd', 1080],
      ['fundo.story.guide.psd', 1920],
    ] as const) {
      const psd = readPsd(new Uint8Array(await readFile(join(assets, name))), {
        useImageData: true,
        skipThumbnail: true,
      });
      expect({ width: psd.width, height: psd.height }, name).toEqual({ width: 1080, height });
      expect(psd.children?.map((layer) => layer.name).reverse()).toEqual([
        'texto',
        'areas',
        'arte',
        'decoracao',
      ]);
    }
  });

  it('names one guide with no format when the brief renders one', async () => {
    expect(await guide('--formats', 'story')).toBe(EXIT_OK);
    expect(await readdir(join(workspace, 'assets'))).toEqual(['fundo.guide.psd']);
  });

  it('writes only the missing guides by default, and nothing when every one is there', async () => {
    await mkdir(join(workspace, 'assets'));
    await writeFile(join(workspace, 'assets', 'fundo.story.guide.psd'), 'painted');
    expect(await guide()).toBe(EXIT_OK);
    expect(out.join('')).toBe(`${join('assets', 'fundo.grid-1x1.guide.psd')}\n`);
    expect(await readFile(join(workspace, 'assets', 'fundo.story.guide.psd'), 'utf8')).toBe(
      'painted',
    );

    out = [];
    expect(await guide()).toBe(EXIT_OK);
    expect(out).toEqual([]);
    expect(errors.join('')).toContain('every guide is already there');
  });

  it('refuses to write over a guide newer than the brief, writing none, unless forced', async () => {
    await mkdir(join(workspace, 'assets'));
    await writeFile(join(workspace, 'assets', 'fundo.story.guide.psd'), 'painted');
    await briefOlderThanGuides();

    expect(await guide('--all')).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_GUIDE_NEWER_THAN_BRIEF');
    expect(errors.join('')).toContain(join('assets', 'fundo.story.guide.psd'));
    expect(await readdir(join(workspace, 'assets'))).toEqual(['fundo.story.guide.psd']);
    expect(rasterizers).toBe(0);

    expect(await guide('--all', '--force')).toBe(EXIT_OK);
    expect(await readFile(join(workspace, 'assets', 'fundo.story.guide.psd'), 'utf8')).not.toBe(
      'painted',
    );
  });

  it('writes over a guide older than the brief', async () => {
    await mkdir(join(workspace, 'assets'));
    const stale = join(workspace, 'assets', 'fundo.story.guide.psd');
    await writeFile(stale, 'stale');
    const past = new Date(Date.now() - 60_000);
    await utimes(stale, past, past);

    expect(await guide('--only', 'fundo.story.guide.psd')).toBe(EXIT_OK);
    expect(await readFile(stale, 'utf8')).not.toBe('stale');
    expect(out.join('')).toBe(`${join('assets', 'fundo.story.guide.psd')}\n`);
  });

  it('opens each guide it wrote through the environment, and refuses --open with no opener', async () => {
    expect(await guide('--open')).toBe(EXIT_OK);
    expect(opened).toEqual([
      join(workspace, 'assets', 'fundo.grid-1x1.guide.psd'),
      join(workspace, 'assets', 'fundo.story.guide.psd'),
    ]);

    const { openFile: _dropped, ...withoutOpener } = environment();
    const code = await run(['guide', 'arte.brief', '--all', '--open'], withoutOpener);
    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('--open is not available here');
  });

  it('writes the guide a brief cites by its layer with no decoder, which a render then names', async () => {
    // A home, so the decoded cache is composed and a cited `.psd` meets "no plugin decodes it".
    const home = await mkdtemp(join(tmpdir(), 'tyto-guide-home-'));
    try {
      const withHome = (): CliEnvironment => ({ ...environment(), home });
      await writeFile(
        join(workspace, 'arte.brief'),
        BRIEF.replace('fundo: fundo.png', 'fundo: fundo.guide.psd#arte'),
      );
      const words = ['arte.brief', '--no-google-fonts', '--formats', 'story'];
      expect(await run(['guide', ...words], withHome())).toBe(EXIT_OK);
      expect(await readdir(join(workspace, 'assets'))).toEqual(['fundo.guide.psd']);

      // The guide is there now and no plugin decodes it: writing it again still needs none.
      expect(await run(['guide', ...words, '--all', '--force'], withHome())).toBe(EXIT_OK);
      expect(errors.join('')).toBe('');

      const rendered = join(workspace, 'out');
      expect(await run(['render', ...words, '--out', rendered], withHome())).toBe(EXIT_DIAGNOSTICS);
      expect(errors.join('')).toContain(
        "arte.brief:4:1: error E_ASSET_DECODER_MISSING Asset 'fundo.guide.psd#arte' is a '.psd' file, which Tyto cannot draw by itself; install a plugin that decodes '.psd' files.",
      );
      // `imagem`, which the brief leaves uncited, is still art to paint; `fundo` is not.
      expect(errors.join('')).not.toContain("Slot 'fundo'");
      // The story's own copy is simply not there: the port has nothing to explain about it.
      expect(errors.join('')).not.toContain('fundo.guide.story.psd');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('refuses --only a file the brief does not cite', async () => {
    expect(await guide('--only', 'outro.png')).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain("the brief cites no external art named 'outro.png'");
  });

  it('refuses a template with no external art', async () => {
    await writeFile(join(workspace, 'arte.brief'), '---\ntemplate: promo-curso\n---\n');
    expect(await guide()).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_GUIDE_NO_EXTERNAL_ART');
  });
});
