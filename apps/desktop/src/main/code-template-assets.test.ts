import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import type { TemplateBuild } from '@tyto/core';
import { nodeFileSystem } from '@tyto/io';
import type * as Templates from '@tyto/templates';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createExportService } from './export.js';
import { createPreviewService } from './preview.js';
import { createProjectSources } from './project.js';

/**
 * A bundled code template draws the files in its own folder, in the window (TYTO-214,
 * ADR 0062) — the CLI half is `apps/cli/src/code-template-assets.test.ts`, with the same
 * fixture shape.
 *
 * `faixa` is written here and added to the build's own list, which is the only way a code
 * template reaches the window. It keeps one background per format and asks for the one its
 * format names, as TYTO-210's banner will. The brief's folder has no `assets/`, so ADR
 * 0056's brief-side lookup cannot reach the pictures.
 */

// Inside the factory, because `vi.mock` is hoisted above every import and declaration.
vi.mock('@tyto/templates', async (original) => {
  const actual = await original<typeof Templates>();
  const { frame, image } = await import('@tyto/core/template');
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

/** A PNG of one colour, written here so no binary is checked in. */
function solidPng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from(rgb))]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Two different pictures, so a frame that drew the other format's file is caught. */
const PICTURES: Readonly<Record<string, Buffer>> = {
  grid: solidPng(2, 2, [12, 35, 64]),
  'grid-1x1': solidPng(4, 2, [255, 89, 0]),
};

const MANIFEST = [
  'name: faixa',
  'version: 1.0.0',
  'brand: azul',
  'description: A banner drawn over a fixed background, one per format.',
  'formats: [grid, grid-1x1]',
  'slots:',
  '  titulo: { type: rich-text, max: 40 }',
  '',
].join('\n');

const BRIEF = [
  '---',
  'template: faixa',
  'formats: [grid, grid-1x1]',
  '---',
  '::titulo',
  '  Oferta',
  '',
].join('\n');

const require_ = createRequire(import.meta.url);
const packDirectory = join(dirname(require_.resolve('@tyto/templates/package.json')), 'templates');

let scratch: string;
let briefDirectory: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-code-template-assets-'));
  const template = join(scratch, 'mine', 'faixa');
  mkdirSync(join(template, 'assets'), { recursive: true });
  writeFileSync(join(template, 'manifest.yaml'), MANIFEST);
  for (const [format, bytes] of Object.entries(PICTURES)) {
    writeFileSync(join(template, 'assets', `bg-${format}.png`), bytes);
  }
  briefDirectory = join(scratch, 'work');
  mkdirSync(briefDirectory, { recursive: true });
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const sources = () =>
  createProjectSources({
    fileSystem: nodeFileSystem(),
    builtIn: packDirectory,
    folder: join(scratch, 'mine'),
  });

const errors = (diagnostics: readonly { severity: string; code: string }[]): string[] =>
  diagnostics.filter((item) => item.severity === 'error').map((item) => item.code);

/** Each format's own picture is in its output, and the other format's is not. */
function expectOwnBackground(format: string, output: string): void {
  for (const [other, bytes] of Object.entries(PICTURES)) {
    expect(output.includes(bytes.toString('base64')), `${format} has ${other}'s picture`).toBe(
      other === format,
    );
  }
}

describe('a bundled code template’s own folder, in the window (TYTO-214)', () => {
  for (const saved of [true, false]) {
    const which = saved ? 'a saved brief' : 'a brief with no folder yet';

    it(`previews each format with its own background, for ${which}`, async () => {
      const preview = await createPreviewService({
        fileSystem: nodeFileSystem(),
        sources: await sources(),
      });
      const result = saved
        ? await preview.preview(BRIEF, briefDirectory)
        : await preview.preview(BRIEF);

      expect(errors(result.diagnostics)).toEqual([]);
      expect(result.frames.map((frame) => frame.format)).toEqual(['grid', 'grid-1x1']);
      for (const frame of result.frames) expectOwnBackground(frame.format, frame.html);
    });

    it(`exports each format with its own background, cropped, for ${which}`, async () => {
      const out = join(scratch, saved ? 'out-saved' : 'out-unsaved');
      const service = await createExportService({
        fileSystem: nodeFileSystem(),
        sources: await sources(),
        version: '0.0.0-test',
      });
      const progress = await service.run({
        brief: BRIEF,
        directory: out,
        ...(saved ? { briefDirectory } : {}),
        label: 'faixa',
        outputs: [{ kind: 'svg' }],
      });

      expect(progress.failure).toBeUndefined();
      expect(errors(progress.diagnostics)).toEqual([]);
      for (const format of Object.keys(PICTURES)) {
        const svg = readFileSync(join(out, `${format}-01.svg`), 'utf8');
        expectOwnBackground(format, svg);
        // `cover` into a frame of another shape: the exporter crops it itself (TYTO-60).
        expect(svg).toContain('<clipPath');
      }
    }, 60_000);
  }
});
