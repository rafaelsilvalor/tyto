import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import type { AssetRef, FileSystem, TemplateManifest, TemplateRegistry } from '@tyto/core';
import { fileTemplateAssets, nodeFileSystem } from '@tyto/io';
import { markupTemplateSource } from '@tyto/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ExportProgress, createExportService } from './export.js';
import { createPreviewService } from './preview.js';
import { createProjectSources } from './project.js';
import { briefThenTemplate, templateSourceOf } from './template-source.js';

/**
 * A markup template that draws from its own folder, in the window (TYTO-176).
 *
 * `tyto render` handed a template its folder's files and the window did not, so a
 * `<vector src="assets/…">` was `E_TEMPLATE_MARKUP` and an `<image src="assets/…">` was
 * `E_TEMPLATE_VALUE` in the preview and the export — no frame at all — while the CLI drew
 * the same template whole. Measured before the fix on main 78400d1.
 *
 * The brief lives in a folder of its own with no `assets/`, so nothing the brief-side
 * lookup does (ADR 0056) can find these files by accident: only the template's folder has
 * them. The fixture is built here, so no binary is checked in, and it is a template of its
 * own rather than a pack template that may be deleted.
 */

function solidPng(size: number, rgb: readonly [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from(rgb))]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BACKGROUND = solidPng(16, [224, 48, 48]);
/** A fill no font, no pack template and no default colour uses, so finding it means the vector. */
const MARK_FILL = '#30c060';
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${MARK_FILL}"/></svg>`;

const MANIFEST = [
  'name: selo-teste',
  'version: 1.0.0',
  'formats: [grid-1x1]',
  'slots:',
  '  titulo: { type: rich-text, required: true }',
  '',
].join('\n');

const MARKUP = [
  '<frame format="grid-1x1" bg="#000000">',
  '  <image src="assets/fundo.png" fit="cover" class="bg" />',
  '  <vector src="assets/selo.svg" class="mark" />',
  '  <text slot="titulo" class="title" />',
  '</frame>',
  '<style>',
  '  .bg { x: 0; y: 0; w: 100%; h: 50%; }',
  '  .mark { x: 540; y: 600; w: 400; h: 400; }',
  '  .title { x: 64; y: 640; w: 400; font: 700 72px/1.1 "Source Sans 3"; color: #ffffff; }',
  '</style>',
  '',
].join('\n');

const BRIEF = ['---', 'template: selo-teste', '---', '::titulo', '  Selo', ''].join('\n');

const require_ = createRequire(import.meta.url);
const packDirectory = join(dirname(require_.resolve('@tyto/templates/package.json')), 'templates');

let scratch: string;
let briefDirectory: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-template-assets-'));
  const template = join(scratch, 'mine', 'selo-teste');
  mkdirSync(join(template, 'assets'), { recursive: true });
  writeFileSync(join(template, 'manifest.yaml'), MANIFEST);
  writeFileSync(join(template, 'template.html'), MARKUP);
  writeFileSync(join(template, 'assets', 'fundo.png'), BACKGROUND);
  writeFileSync(join(template, 'assets', 'selo.svg'), MARK);
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

describe("a template's own folder, in the window (TYTO-176)", () => {
  it('previews the <vector> and the <image> its folder holds', async () => {
    const preview = await createPreviewService({
      fileSystem: nodeFileSystem(),
      sources: await sources(),
    });
    const result = await preview.preview(BRIEF, briefDirectory);

    expect(errors(result.diagnostics)).toEqual([]);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.html).toContain(BACKGROUND.toString('base64'));
    expect(result.frames[0]!.html).toContain(MARK_FILL);
  });

  it('previews them for a brief that has no folder yet', async () => {
    // The case that needs the template's own resources bound to the exporter. With a brief
    // folder, its reader also reads a ref that carries an absolute path, which every ref a
    // template mints does — so only an unsaved tab tells the two bindings apart (measured:
    // dropping the template's resources left the case above green).
    const preview = await createPreviewService({
      fileSystem: nodeFileSystem(),
      sources: await sources(),
    });
    const result = await preview.preview(BRIEF);

    expect(errors(result.diagnostics)).toEqual([]);
    expect(result.frames[0]!.html).toContain(BACKGROUND.toString('base64'));
  });

  it('exports them for a brief that has no folder yet', async () => {
    const out = join(scratch, 'out-unsaved');
    const service = await createExportService({
      fileSystem: nodeFileSystem(),
      sources: await sources(),
      version: '0.0.0-test',
    });
    const progress = await service.run({
      brief: BRIEF,
      directory: out,
      label: 'selo',
      outputs: [{ kind: 'svg' }],
    });

    expect(errors(progress.diagnostics)).toEqual([]);
    expect(readFileSync(join(out, 'grid-1x1-01.svg'), 'utf8')).toContain(
      BACKGROUND.toString('base64'),
    );
  }, 60_000);

  it('exports them into the artwork', async () => {
    const out = join(scratch, 'out');
    const service = await createExportService({
      fileSystem: nodeFileSystem(),
      sources: await sources(),
      version: '0.0.0-test',
    });
    const progress: ExportProgress = await service.run({
      brief: BRIEF,
      directory: out,
      briefDirectory,
      label: 'selo',
      outputs: [{ kind: 'svg' }],
    });

    expect(progress.failure).toBeUndefined();
    expect(errors(progress.diagnostics)).toEqual([]);
    const svg = readdirSync(out).filter((name) => name.endsWith('.svg'));
    expect(svg).toEqual(['grid-1x1-01.svg']);
    const text = readFileSync(join(out, svg[0]!), 'utf8');
    expect(text).toContain(BACKGROUND.toString('base64'));
    expect(text).toContain(MARK_FILL);
  }, 60_000);
});

describe('templateSourceOf', () => {
  it('answers a name with no folder exactly as the plain markup source does, reading nothing', async () => {
    // A registry that knows the manifest but has no folder for it. The template's own files
    // are a property of a folder, so with none there is nothing to read — and the answer must
    // be today's, not a new error.
    const manifest = { name: 'sem-pasta', version: '1.0.0', formats: ['grid-1x1'], slots: {} };
    const registry: TemplateRegistry = {
      list: () => [manifest as unknown as TemplateManifest],
      get: (name) => (name === 'sem-pasta' ? (manifest as unknown as TemplateManifest) : undefined),
      formatsOf: () => ['grid-1x1'],
      directoryOf: () => undefined,
      failures: [],
    };
    const touched: string[] = [];
    const fileSystem = new Proxy(nodeFileSystem(), {
      get(target, property, receiver) {
        touched.push(String(property));
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as FileSystem;

    const reads: string[] = [];
    const wiring = templateSourceOf(fileSystem, registry, [], (options) => {
      reads.push(options.base);
      return fileTemplateAssets(options);
    });
    const loaded = await wiring.source.load('sem-pasta');
    const plain = await markupTemplateSource(nodeFileSystem(), registry).load('sem-pasta');

    expect(loaded).toEqual(plain);
    expect(loaded.ok ? [] : loaded.error.map((item) => item.code)).toEqual(['E_UNKNOWN_TEMPLATE']);
    expect(touched).toEqual([]);
    expect(reads).toEqual([]);
    const ref: AssetRef = { id: 'assets/x.png', source: 'file', hash: 'sha256-0' };
    expect(wiring.resources.html?.asset?.(ref)).toBeUndefined();
  });
});

describe('briefThenTemplate', () => {
  const ref: AssetRef = { id: 'logo.png', source: 'file', hash: 'sha256-0' };
  const answering = (uri: string) => ({
    html: { asset: () => uri },
    svg: { asset: () => uri, assetSize: () => ({ w: 1, h: 1 }) },
  });

  it("asks the brief's files first, the CLI's order", () => {
    const both = briefThenTemplate(answering('brief'), answering('template'));

    expect(both.html?.asset?.(ref)).toBe('brief');
    expect(both.svg?.asset?.(ref)).toBe('brief');
  });

  it("falls back to the template's when the brief has none", () => {
    const fallback = briefThenTemplate(undefined, answering('template'));

    expect(fallback.html?.asset?.(ref)).toBe('template');
    expect(fallback.svg?.assetSize?.(ref)).toEqual({ w: 1, h: 1 });
  });
});
