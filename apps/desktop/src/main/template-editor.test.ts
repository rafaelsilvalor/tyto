import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeFileSystem } from '@tyto/io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ProjectSources, createProjectSources } from './project.js';
import { type TemplateEditorService, createTemplateEditor } from './template-editor.js';

/**
 * The template mode's main half, against real folders (TYTO-44).
 *
 * Real folders for `project.test.ts`'s reason: what a save means is what the next registry read
 * finds, and that is `loadTemplateRegistry`'s answer, not a fake's.
 *
 * Two roots, the way the app has them: a stand-in for the built-in pack that holds nothing but
 * the `formats.yaml`, and a chosen folder holding `cartaz`, a two-format markup template.
 */

const MANIFEST = [
  'name: cartaz',
  'version: 1.0.0',
  'formats: [feed, story]',
  'slots:',
  '  titulo: { type: rich-text, required: true }',
  '',
].join('\n');

const markupWith = (colour: string): string =>
  [
    '<frame format="feed" bg="#000000">',
    '  <text slot="titulo" class="title" />',
    '</frame>',
    '<frame format="story" extends="feed" />',
    '<style>',
    `  .title { x: 64; y: 64; w: 900; font: 700 72px/1.1 "Source Sans 3"; color: ${colour}; }`,
    '</style>',
    '',
  ].join('\n');

/** Only the feed format: the grid must show the story anyway. */
const EXAMPLE = ['---', 'template: cartaz', 'formats: [feed]', '---', '::titulo', '  Olá', ''].join(
  '\n',
);

let scratch: string;
let chosen: string;
let folder: string;
let sources: ProjectSources;
let editor: TemplateEditorService;

beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-template-editor-'));

  const builtIn = join(scratch, 'built-in');
  mkdirSync(builtIn, { recursive: true });
  writeFileSync(
    join(builtIn, 'formats.yaml'),
    'feed: { w: 1080, h: 1080 }\nstory: { w: 1080, h: 1920 }\n',
  );

  chosen = join(scratch, 'mine');
  folder = join(chosen, 'cartaz');
  mkdirSync(join(folder, 'examples'), { recursive: true });
  writeFileSync(join(folder, 'manifest.yaml'), MANIFEST);
  writeFileSync(join(folder, 'template.html'), markupWith('#ffffff'));
  writeFileSync(join(folder, 'examples', 'cartaz.brief'), EXAMPLE);

  sources = await createProjectSources({ fileSystem: nodeFileSystem(), builtIn, folder: chosen });
  editor = createTemplateEditor({ sources });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('open', () => {
  it('reads both buffers and every example brief', async () => {
    const opened = await editor.open(folder);

    expect(opened.kind).toBe('markup');
    if (opened.kind !== 'markup') return;
    expect(opened.manifest).toBe(MANIFEST);
    expect(opened.markup).toBe(markupWith('#ffffff'));
    expect(opened.examples.map((example) => example.name)).toEqual(['cartaz.brief']);
    expect(opened.examples[0]?.text).toBe(EXAMPLE);
  });

  it('recognises a code template and does not read it', async () => {
    rmSync(join(folder, 'template.html'));
    writeFileSync(join(folder, 'template.ts'), 'throw new Error("never imported");\n');

    expect(await editor.open(folder)).toEqual({ kind: 'code', directory: folder });
  });

  it('refuses a folder with no manifest', async () => {
    expect(await editor.open(scratch)).toEqual({
      kind: 'refused',
      directory: scratch,
      missing: 'manifest.yaml',
    });
  });
});

describe('preview', () => {
  const previewOf = (markup: string, manifest = MANIFEST) =>
    editor.preview({
      directory: folder,
      manifest,
      markup,
      brief: EXAMPLE,
      briefPath: join(folder, 'examples', 'cartaz.brief'),
    });

  it('draws every format the manifest declares, whatever the sample asks for', async () => {
    const result = await previewOf(markupWith('#ffffff'));

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.frames.map((frame) => [frame.format, frame.width, frame.height])).toEqual([
      ['feed', 1080, 1080],
      ['story', 1080, 1920],
    ]);
  });

  it('draws the buffer and not the file: a colour edited in the markup reaches every format', async () => {
    // The first acceptance criterion at the service: the CSS changes in an unsaved buffer, and
    // both documents that come back carry it.
    const before = await previewOf(markupWith('#ffffff'));
    const after = await previewOf(markupWith('#ff5900'));

    expect(after.frames).toHaveLength(2);
    for (const [index, frame] of after.frames.entries()) {
      expect(frame.html).not.toBe(before.frames[index]?.html);
      expect(frame.html.toLowerCase()).toContain('#ff5900');
    }
    // Nothing was written: the file is still the white one.
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(markupWith('#ffffff'));
  });

  it('stops at a manifest that does not parse, and says which file', async () => {
    const result = await previewOf(markupWith('#ffffff'), 'name: cartaz\nslots: [nope]\n');

    expect(result.frames).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((item) => item.file === 'manifest')).toBe(true);
  });

  it('tags a markup error as the markup and draws nothing', async () => {
    const result = await previewOf(markupWith('#ffffff').replace('color:', 'colour:'));

    expect(result.frames).toEqual([]);
    expect(result.diagnostics.map((item) => [item.file, item.code])).toContainEqual([
      'markup',
      'E_UNSUPPORTED_CSS',
    ]);
  });
});

describe('save', () => {
  it('writes both files and re-registers the template', async () => {
    const grown = `${MANIFEST}  selo: { type: rich-text }\n`;

    const result = await editor.save({
      directory: folder,
      manifest: grown,
      markup: markupWith('red'),
    });

    expect(result).toMatchObject({ saved: true, registered: true, name: 'cartaz' });
    expect(readFileSync(join(folder, 'manifest.yaml'), 'utf8')).toBe(grown);
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(markupWith('red'));
    // The registry every brief is resolved against has read the new manifest.
    expect(Object.keys(sources.current().registry?.get('cartaz')?.slots ?? {})).toContain('selo');
  });

  it('refuses a manifest error: nothing is written and the diagnostic comes back', async () => {
    // The second acceptance criterion at the service.
    const result = await editor.save({
      directory: folder,
      manifest: 'name: cartaz\nslots: [nope]\n',
      markup: markupWith('red'),
    });

    expect(result.saved).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.file).toBe('manifest');
    expect(readFileSync(join(folder, 'manifest.yaml'), 'utf8')).toBe(MANIFEST);
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(markupWith('#ffffff'));
  });

  it('saves a markup error, because that breaks only the template being written', async () => {
    const broken = markupWith('#ffffff').replace('color:', 'colour:');

    const result = await editor.save({ directory: folder, manifest: MANIFEST, markup: broken });

    expect(result.saved).toBe(true);
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(broken);
  });

  it('says so when the folder is not one briefs are rendered from', async () => {
    const elsewhere = join(scratch, 'elsewhere', 'cartaz');
    mkdirSync(elsewhere, { recursive: true });

    const result = await editor.save({
      directory: elsewhere,
      manifest: MANIFEST,
      markup: markupWith('red'),
    });

    // Written, and not what the registry holds under that name — `mine/cartaz` still is.
    expect(result).toMatchObject({ saved: true, registered: false });
    expect(existsSync(join(elsewhere, 'manifest.yaml'))).toBe(true);
  });
});

describe('scaffold', () => {
  it('writes the CLI scaffold for every format the project defines, and registers it', async () => {
    const result = await editor.scaffold(chosen, 'novo');

    expect(result).toEqual({ ok: true, directory: join(chosen, 'novo') });
    expect(readFileSync(join(chosen, 'novo', 'manifest.yaml'), 'utf8')).toContain(
      'formats: [feed, story]',
    );
    expect(existsSync(join(chosen, 'novo', 'examples', 'novo.brief'))).toBe(true);
    expect(sources.current().registry?.get('novo')).toBeDefined();

    // And it previews at once, which is what a New that opens the editor promises.
    const opened = await editor.open(join(chosen, 'novo'));
    if (opened.kind !== 'markup') throw new Error(`opened as ${opened.kind}`);
    const drawn = await editor.preview({
      directory: opened.directory,
      manifest: opened.manifest,
      markup: opened.markup,
      brief: opened.examples[0]?.text ?? '',
    });
    expect(drawn.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(drawn.frames.map((frame) => frame.format)).toEqual(['feed', 'story']);
  });

  it('never overwrites a folder that is there', async () => {
    expect(await editor.scaffold(chosen, 'cartaz')).toMatchObject({ ok: false, problem: 'exists' });
    expect(readFileSync(join(folder, 'manifest.yaml'), 'utf8')).toBe(MANIFEST);
  });

  it('refuses a name no brief could write, before creating anything', async () => {
    expect(await editor.scaffold(chosen, 'nome com espaço')).toMatchObject({
      ok: false,
      problem: 'name',
    });
    expect(existsSync(join(chosen, 'nome com espaço'))).toBe(false);
  });
});
