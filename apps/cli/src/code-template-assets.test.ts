import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import type { TemplateBuild } from '@tyto/core';
import type * as Templates from '@tyto/templates';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * A bundled code template draws the files in its own folder in `tyto render` (TYTO-214,
 * ADR 0062).
 *
 * The template is `faixa`, a fixture written here: a banner with one background per format,
 * as TYTO-210 needs. It is "bundled" by adding it to the build's own list, which is the only
 * way a code template reaches a render, and its folder is a temp copy beside the brief's.
 * The brief's folder has no `assets/`, so ADR 0056's brief-side lookup cannot reach the
 * pictures: whatever is drawn came through `context.files`.
 *
 * Each picture is drawn `cover` into a frame of another shape, so the SVG has to crop it,
 * which it does itself only when it knows the picture's size (TYTO-60, TYTO-215).
 */

// Inside the factory, because `vi.mock` is hoisted above every import and declaration.
vi.mock('@tyto/templates', async (original) => {
  const actual = await original<typeof Templates>();
  const { frame, image } = await import('@tyto/core/template');
  /** The background the format asks for, or nothing; the worked example in the guide. */
  const faixa: TemplateBuild = (context) => {
    const background = context.files.image(`assets/bg-${context.format}.png`);
    return frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      children:
        background === undefined
          ? []
          : [image({ asset: background, size: context.size, fit: 'cover' })],
    });
  };
  return { ...actual, BUILT_IN_TEMPLATE_BUILDS: { ...actual.BUILT_IN_TEMPLATE_BUILDS, faixa } };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, '..', '..', '..', 'packages', 'templates', 'templates');

/** One PNG chunk: length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A PNG of one colour, written here so no binary is checked in. */
function solidPng(width: number, height: number, [red, green, blue]: readonly number[]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const pixel = [red ?? 0, green ?? 0, blue ?? 0];
  const row = Buffer.from([0, ...Array.from({ length: width }, () => pixel).flat()]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Two different pictures, so a frame that drew the other format's file is caught. */
const FEED_PICTURE = solidPng(2, 2, [12, 35, 64]);
const STORY_PICTURE = solidPng(4, 2, [255, 89, 0]);

const MANIFEST = `name: faixa
version: 1.0.0
brand: estrategia-saude
description: A banner drawn over a fixed background, one per format.
formats: [grid, grid-1x1]
slots:
  titulo: { type: rich-text, max: 40 }
`;

let workspace: string;
let out: string[];

function environment(): CliEnvironment {
  return {
    console: { out: (text) => out.push(text), err: (text) => out.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    rasterizer: () => {
      throw new Error('an SVG render must never build a rasterizer');
    },
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-code-assets-'));
  out = [];
  const folder = join(workspace, 'templates', 'faixa');
  await mkdir(join(folder, 'assets'), { recursive: true });
  await writeFile(join(folder, 'manifest.yaml'), MANIFEST);
  await writeFile(join(folder, 'assets', 'bg-grid.png'), FEED_PICTURE);
  await writeFile(join(folder, 'assets', 'bg-grid-1x1.png'), STORY_PICTURE);
  await cp(join(PACK, 'formats.yaml'), join(workspace, 'formats.yaml'));
  await mkdir(join(workspace, 'brief'));
  await writeFile(
    join(workspace, 'brief', 'faixa.brief'),
    '---\ntemplate: faixa\nformats: [grid, grid-1x1]\n---\n\n::titulo\n  Oferta\n',
  );
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function render(): Promise<number> {
  return run(
    [
      'render',
      join('brief', 'faixa.brief'),
      '--out',
      'out',
      '--types',
      'svg',
      '--templates',
      'templates',
      '--json',
    ],
    environment(),
  );
}

describe('tyto render on a bundled code template with files in its folder', () => {
  it('draws each format its own background, from the template folder', async () => {
    const code = await render();

    const document = JSON.parse(out.join('')) as { diagnostics: { code: string }[] };
    expect(document.diagnostics.map((item) => item.code)).toEqual([]);
    expect(code).toBe(EXIT_OK);

    const files = await readdir(join(workspace, 'out'));
    const svgOf = async (format: string): Promise<string> => {
      const name = files.find((file) => file.startsWith(`${format}-`) && file.endsWith('.svg'));
      if (name === undefined) throw new Error(`no ${format} svg in ${files.join(', ')}`);
      return readFile(join(workspace, 'out', name), 'utf8');
    };
    const feed = FEED_PICTURE.toString('base64');
    const story = STORY_PICTURE.toString('base64');

    expect((await svgOf('grid')).includes(feed)).toBe(true);
    expect((await svgOf('grid')).includes(story)).toBe(false);
    expect((await svgOf('grid-1x1')).includes(story)).toBe(true);
    expect((await svgOf('grid-1x1')).includes(feed)).toBe(false);
  });

  it('crops a template picture drawn cover in the SVG itself, rather than leaving it to the reader', async () => {
    expect(await render()).toBe(EXIT_OK);

    for (const name of await readdir(join(workspace, 'out'))) {
      if (!name.endsWith('.svg')) continue;
      const svg = await readFile(join(workspace, 'out', name), 'utf8');
      expect(svg, name).toContain('<clipPath');
      expect(svg, name).not.toContain('slice');
    }
  });
});
