import type {
  AssetRef,
  DirectoryEntry,
  FileSystem,
  TemplateBuild,
  TemplateFiles,
  TemplateRegistry,
} from '@tyto/core';
import { formatCatalogue, loadTemplateRegistry } from '@tyto/core';
import { frame, image } from '@tyto/core/template';
import { svgExporterPlugin } from '@tyto/export-svg';
import { createPluginHost } from '@tyto/plugin-api';
import { describe, expect, it, vi } from 'vitest';

import type { Artifact } from './artifact.js';
import { bundledTemplateSource } from './bundled-template-source.js';
import { runJob } from './job.js';
import { markupTemplateSource } from './template-source.js';

/**
 * What these tests are for.
 *
 * The card's claim is narrow and worth holding to: a template whose body is code can be
 * drawn, **and nothing loads code from a folder**. So the cases below are about routing and
 * pairing — which body answers for a name, and what happens when two could — rather than
 * about anything drawn. `compile` is what executes a build, and it has its own tests.
 *
 * The folders are a file map, and directory listings are derived from it, so a fixture
 * cannot claim a file that is not there.
 */

const MANIFEST = `name: ficha
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text, required: true, max: 40 }
`;

/** Geometry and type in a <style>, because a <text> with neither is refused outright. */
const MARKUP = `<frame format="feed"><text slot="titulo" class="t" /></frame>
<style>
  .t { x: 40; y: 40; w: 1000; font: 400 40px/1.2 "Source Sans 3"; color: white; }
</style>`;

function fileSystemOf(files: Readonly<Record<string, string>>): FileSystem {
  const readDirectory = (path: string): readonly DirectoryEntry[] => {
    const prefix = `${path}/`;
    const found = new Map<string, boolean>();
    for (const file of Object.keys(files)) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf('/');
      found.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1);
    }
    if (found.size === 0) throw new Error(`ENOENT: no such directory '${path}'`);
    return [...found].map(([name, isDirectory]) => ({ name, isDirectory }));
  };

  return {
    join: (...segments) => segments.join('/'),
    readDirectory: (path) => Promise.resolve(readDirectory(path)),
    readFile: (path) => {
      const source = files[path];
      if (source === undefined) return Promise.reject(new Error(`ENOENT: no such file '${path}'`));
      return Promise.resolve(source);
    },
  };
}

async function registryOf(fileSystem: FileSystem): Promise<TemplateRegistry> {
  const loaded = await loadTemplateRegistry(fileSystem, 'templates');
  if (!loaded.ok) throw new Error(`fixture registry failed: ${JSON.stringify(loaded.error)}`);
  return loaded.value;
}

/** A build that records it was called and returns the emptiest legal frame. */
function spyBuild(): TemplateBuild & ReturnType<typeof vi.fn> {
  return vi.fn((context) =>
    frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      children: [],
    }),
  );
}

async function sourceFor(files: Readonly<Record<string, string>>, build: TemplateBuild) {
  const fileSystem = fileSystemOf(files);
  const registry = await registryOf(fileSystem);
  return bundledTemplateSource({
    registry,
    fileSystem,
    bundled: { ficha: build },
    markup: markupTemplateSource(fileSystem, registry),
  });
}

describe('a name the build ships', () => {
  it('pairs the shipped function with the manifest the registry parsed', async () => {
    const build = spyBuild();
    const source = await sourceFor({ 'templates/ficha/manifest.yaml': MANIFEST }, build);

    const loaded = await source.load('ficha');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.name).toBe('ficha');
    expect(loaded.value.manifest.slots['titulo']).toMatchObject({ required: true, max: 40 });
    // The same function, not a copy that happens to behave alike: `compile` calls this one.
    expect(loaded.value.build).toBe(build);
  });

  /**
   * Loading is not running. A picker lists templates nobody asked to draw, so a source that
   * called a build to find out anything about it would execute every template on the
   * machine at the moment somebody scrolled.
   */
  it('does not call the build while loading it', async () => {
    const build = spyBuild();
    const source = await sourceFor({ 'templates/ficha/manifest.yaml': MANIFEST }, build);

    await source.load('ficha');

    expect(build).not.toHaveBeenCalled();
  });
});

describe('a name it does not ship', () => {
  it('hands the name to the markup route untouched', async () => {
    const build = spyBuild();
    const source = await sourceFor(
      {
        'templates/promo/manifest.yaml': MANIFEST.replace('name: ficha', 'name: promo'),
        'templates/promo/template.html': MARKUP,
      },
      build,
    );

    const loaded = await source.load('promo');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.name).toBe('promo');
    expect(build).not.toHaveBeenCalled();
  });

  /**
   * The point of the card, asserted rather than assumed: a folder may hold a `template.ts`
   * and it is inert. Nothing imports it, nothing runs it, and the name resolves to whatever
   * the markup route makes of a folder with no markup in it.
   */
  it('leaves a template.ts in a folder inert', async () => {
    const build = spyBuild();
    const source = await sourceFor(
      {
        'templates/solta/manifest.yaml': MANIFEST.replace('name: ficha', 'name: solta'),
        'templates/solta/template.ts': 'export const build = () => { throw new Error("ran"); };',
      },
      build,
    );

    const loaded = await source.load('solta');

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    // It failed for the only honest reason: there is no body this pipeline can read.
    expect(loaded.error.map((problem) => problem.code)).toContain('E_TEMPLATE_READ');
  });
});

describe('a name with two bodies', () => {
  it('refuses rather than picking one', async () => {
    const build = spyBuild();
    const source = await sourceFor(
      {
        'templates/ficha/manifest.yaml': MANIFEST,
        'templates/ficha/template.html': MARKUP,
      },
      build,
    );

    const loaded = await source.load('ficha');

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error).toHaveLength(1);
    expect(loaded.error[0]?.code).toBe('E_TEMPLATE_AMBIGUOUS');
    expect(loaded.error[0]?.message).toContain('ficha');
    expect(loaded.error[0]?.message).toContain('template.html');
  });
});

describe('a name nothing declares', () => {
  /**
   * Shipped code for a manifest that is not there. Delegated so that "no such template"
   * reads the same way whichever route noticed, with the one "available" list.
   */
  it('lets the markup route word the refusal', async () => {
    const fileSystem = fileSystemOf({
      'templates/promo/manifest.yaml': MANIFEST.replace('name: ficha', 'name: promo'),
    });
    const registry = await registryOf(fileSystem);
    const source = bundledTemplateSource({
      registry,
      fileSystem,
      bundled: { ausente: spyBuild() },
      markup: markupTemplateSource(fileSystem, registry),
    });

    const loaded = await source.load('ausente');

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error[0]?.code).toBe('E_UNKNOWN_TEMPLATE');
  });
});

describe("its own folder's files (ADR 0062)", () => {
  /**
   * Two formats, so "one background per format" is a claim about two different files and
   * not one file drawn twice: TYTO-210's banner has three sizes and three backgrounds.
   */
  const BANNER = `name: faixa
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text, max: 40 }
`;
  const FOLDER = { 'templates/faixa/manifest.yaml': BANNER };

  const BACKGROUNDS: Readonly<Record<string, AssetRef>> = {
    'assets/bg-feed.png': {
      id: 'assets/bg-feed.png',
      source: 'file',
      path: '/abs/templates/faixa/assets/bg-feed.png',
      hash: 'sha256-feed',
    },
    'assets/bg-story.png': {
      id: 'assets/bg-story.png',
      source: 'file',
      path: '/abs/templates/faixa/assets/bg-story.png',
      hash: 'sha256-story',
    },
  };

  /** What `fileTemplateAssets` answers for that folder, without a disk. */
  const FILES: TemplateFiles = {
    svg: () => undefined,
    image: (path) => BACKGROUNDS[path],
  };

  /** The worked example in `docs/template-authoring.md`: the format picks the file. */
  const banner: TemplateBuild = (context) => {
    const background = context.files.image(`assets/bg-${context.format}.png`);
    return frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      children: background === undefined ? [] : [image({ asset: background, size: context.size })],
    });
  };

  async function bannerSource(
    files: Readonly<Record<string, string>>,
    readFiles?: (directory: string) => Promise<TemplateFiles>,
  ) {
    const fileSystem = fileSystemOf(files);
    const registry = await registryOf(fileSystem);
    const source = bundledTemplateSource({
      registry,
      fileSystem,
      bundled: { faixa: banner },
      markup: markupTemplateSource(fileSystem, registry),
      ...(readFiles === undefined ? {} : { readFiles }),
    });
    return { registry, source };
  }

  it('reads the folder the registry found, once, and hands the answer to the template', async () => {
    const readFiles = vi.fn(() => Promise.resolve(FILES));
    const { source } = await bannerSource(FOLDER, readFiles);

    const loaded = await source.load('faixa');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(readFiles.mock.calls).toEqual([['templates/faixa']]);
    expect(loaded.value.files).toBe(FILES);
  });

  it('draws each format its own background, end to end to svg', async () => {
    const { registry, source } = await bannerSource(FOLDER, () => Promise.resolve(FILES));
    const host = createPluginHost();
    // The composition root's half: the bytes behind a ref the reader minted (`resources`).
    host.activate(
      svgExporterPlugin({ resources: { asset: (ref) => `data:image/png;base64,${ref.hash}` } }),
    );
    const written: Artifact[] = [];

    const result = await runJob(
      {
        brief: '---\ntemplate: faixa\nformats: [feed, story]\n---\n\n::titulo Oferta\n',
        outputs: [{ kind: 'svg' }],
      },
      {
        registry,
        templates: source,
        assets: { base: 'briefs/', resolve: () => Promise.resolve(undefined) },
        formats: formatCatalogue({ feed: { w: 1200, h: 628 }, story: { w: 600, h: 600 } }),
        exporters: host.registry.exporters,
        sink: {
          write: (artifact) => {
            written.push(artifact);
            return Promise.resolve();
          },
        },
      },
    );

    if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
    expect(result.diagnostics).toEqual([]);
    const svgOf = (format: string): string =>
      new TextDecoder().decode(written.find((artifact) => artifact.format === format)?.bytes);
    expect(svgOf('feed')).toContain('data:image/png;base64,sha256-feed');
    expect(svgOf('feed')).not.toContain('sha256-story');
    expect(svgOf('story')).toContain('data:image/png;base64,sha256-story');
    expect(svgOf('story')).not.toContain('sha256-feed');
  });

  /** The card's "a code template with no folder behaves exactly as today". */
  it('hands a template no files when no reader is wired, as before', async () => {
    const { source } = await bannerSource(FOLDER);

    const loaded = await source.load('faixa');

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.files).toBeUndefined();
  });

  it('does not read a folder it refuses as ambiguous', async () => {
    const readFiles = vi.fn(() => Promise.resolve(FILES));
    const { source } = await bannerSource(
      { ...FOLDER, 'templates/faixa/template.html': MARKUP },
      readFiles,
    );

    const loaded = await source.load('faixa');

    expect(loaded.ok).toBe(false);
    expect(readFiles).not.toHaveBeenCalled();
  });

  /** A markup template's folder is the markup route's to read, through `src=`. */
  it('does not read for a name it hands to the markup route', async () => {
    const readFiles = vi.fn(() => Promise.resolve(FILES));
    const { source } = await bannerSource(
      {
        ...FOLDER,
        'templates/promo/manifest.yaml': MANIFEST.replace('name: ficha', 'name: promo'),
        'templates/promo/template.html': MARKUP,
      },
      readFiles,
    );

    const loaded = await source.load('promo');

    expect(loaded.ok).toBe(true);
    expect(readFiles).not.toHaveBeenCalled();
  });
});
