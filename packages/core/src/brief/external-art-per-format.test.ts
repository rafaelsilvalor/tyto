import { describe, expect, it } from 'vitest';

import type { BriefAst } from './ast.js';
import { compile } from './compile.js';
import { externalArtVariant } from './external-art-files.js';
import { type ResolvedBrief, resolve } from './resolve.js';
import { formatCatalogue } from '../config/formats.js';
import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import type { SceneNode } from '../scene/nodes.js';
import type { Scene } from '../scene/scene.js';
import { sourceRange } from '../source/range.js';
import { defineTemplate } from '../template/define.js';
import { type TemplateManifest, parseManifest } from '../template/manifest.js';
import { frame, image } from '../template/nodes.js';
import type { TemplateRegistry } from '../template/registry.js';
import { imagePaint } from '../template/values.js';

/**
 * A format's own copy of a slot's external art (ADR 0222): the brief cites `fundo.png`, and
 * `fundo.story.png` beside it is what the story draws. Only external slots are looked for.
 */

const MANIFEST = `name: arte
version: 1.0.0
formats: [feed, story]
slots:
  foto: { type: image }
  fundo:
    type: image
    external:
      kind: full
      sizes: { feed: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } }
`;

const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } });

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const ARTE = manifestOf(MANIFEST);

const registry: TemplateRegistry = {
  list: () => [ARTE],
  get: (name) => (name === ARTE.name ? ARTE : undefined),
  formatsOf: (name) => (name === ARTE.name ? ARTE.formats : undefined),
  directoryOf: () => 'templates/arte',
  failures: [],
};

/** A folder holding `files`, which records every reference it was asked for. */
function folder(files: readonly string[]): { assets: AssetResolver; asked: string[] } {
  const asked: string[] = [];
  const assets: AssetResolver = {
    base: 'briefs/',
    resolve: (reference) => {
      asked.push(reference);
      return Promise.resolve(
        files.includes(reference)
          ? { id: reference, source: 'file', path: reference, hash: `sha256-${reference}` }
          : undefined,
      );
    },
  };
  return { assets, asked };
}

const FRONT = sourceRange(0, 40);

function brief(data: Readonly<Record<string, string>>): BriefAst {
  const ranges = Object.fromEntries(Object.keys(data).map((key) => [key, FRONT]));
  return {
    frontmatter: { data: { template: 'arte', ...data }, ranges, range: FRONT },
    directives: [],
    range: sourceRange(0, 1_000),
  };
}

async function resolved(
  data: Readonly<Record<string, string>>,
  files: readonly string[],
): Promise<{ value: ResolvedBrief; problems: Diagnostic[]; asked: string[] }> {
  const { assets, asked } = folder(files);
  const result = await resolve(brief(data), { registry, assets });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { value: result.value, problems: [...result.diagnostics], asked };
}

const TEMPLATE = defineTemplate(ARTE, (context) => {
  const fundo = context.slots.fundo?.value;
  const foto = context.slots.foto?.value;
  return frame({
    format: context.format,
    size: context.size,
    ...(fundo?.kind === 'image' ? { background: imagePaint(fundo.asset) } : {}),
    children:
      foto?.kind === 'image'
        ? [image({ id: `${context.idPrefix}.foto`, asset: foto.asset, size: { w: 10, h: 10 } })]
        : [],
  });
});

function sceneOf(value: ResolvedBrief, guide = false): Scene {
  const result = compile(value, TEMPLATE, { formats: FORMATS, guide });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

/** What each frame draws for the art, by format: the background's asset, or a box. */
function artOf(scene: Scene): (readonly [string, string])[] {
  return (scene.artworks[0]?.frames ?? []).map((built) => {
    const background = built.background;
    if (background?.kind === 'image') return [built.format, background.asset.id];
    const box = built.children.find((node: SceneNode) => node.name === 'external-art:fundo');
    return [built.format, box === undefined ? 'nothing' : 'box'];
  });
}

describe('the reference of a format’s own copy', () => {
  it.each([
    ['fundo.png', 'story', 'fundo.story.png'],
    ['./assets/fundo.png', 'feed', './assets/fundo.feed.png'],
    ['C:\\arte\\fundo.final.png', 'story', 'C:\\arte\\fundo.final.story.png'],
    ['./arte.v2/fundo', 'story', './arte.v2/fundo.story'],
    ['./.fundo', 'story', './.fundo.story'],
  ])('%s in %s is %s', (reference, format, expected) => {
    expect(externalArtVariant(reference, format)).toBe(expected);
  });

  it('is nothing for a reference a plugin’s source answers', () => {
    expect(externalArtVariant('drive:abc123', 'story')).toBeUndefined();
  });

  it.each([
    ['x.guide.psd', 'story', 'x.story.guide.psd'],
    ['assets/capa.Guide.PSD', 'feed', 'assets/capa.feed.Guide.PSD'],
    ['x.guide.png', 'story', 'x.guide.story.png'],
  ])(
    'reads a guide as one extension: %s in %s is %s (ADR 0223, decision 7)',
    (reference, format, expected) => {
      expect(externalArtVariant(reference, format)).toBe(expected);
    },
  );

  it('puts the format before the fragment the port split off (ADR 0223)', () => {
    const layer = { file: 'capa.psd', layer: 'grupo/arte.v2' };
    expect(externalArtVariant('capa.psd#grupo/arte.v2', 'story', layer)).toBe(
      'capa.story.psd#grupo/arte.v2',
    );
    const guide = { file: 'x.guide.psd', layer: 'arte' };
    expect(externalArtVariant('x.guide.psd#arte', 'feed', guide)).toBe('x.feed.guide.psd#arte');
  });

  it('keeps a `#` the port did not split off as part of the file’s name', () => {
    expect(externalArtVariant('post#1.png', 'story')).toBe('post#1.story.png');
  });
});

describe('a layer of external art (ADR 0223)', () => {
  it('asks for each format’s copy with the format before the fragment', async () => {
    const asked: string[] = [];
    const assets: AssetResolver = {
      base: 'briefs/',
      resolve: (reference) => {
        asked.push(reference);
        return Promise.resolve(
          reference === 'capa.story.psd#arte'
            ? { id: reference, source: 'url', path: 'cache/x.png', hash: 'sha256-x' }
            : undefined,
        );
      },
      layerOf: (reference) =>
        reference === 'capa.psd#arte' ? { file: 'capa.psd', layer: 'arte' } : undefined,
    };
    const result = await resolve(brief({ fundo: 'capa.psd#arte' }), { registry, assets });
    if (!result.ok) throw new Error('resolve failed');
    expect(asked).toEqual(['capa.psd#arte', 'capa.feed.psd#arte', 'capa.story.psd#arte']);
    expect(result.value.externalArt?.fundo?.story?.id).toBe('capa.story.psd#arte');
  });
});

describe('a format’s own copy of external art', () => {
  it('is drawn in its format, and the other format falls back to the cited file', async () => {
    const { value, problems, asked } = await resolved({ fundo: 'fundo.png' }, [
      'fundo.png',
      'fundo.story.png',
    ]);

    expect(problems).toEqual([]);
    // The cited file, then one question per rendered format, and nothing else.
    expect(asked).toEqual(['fundo.png', 'fundo.feed.png', 'fundo.story.png']);
    expect(value.assets.map((asset) => asset.id)).toEqual(['fundo.png', 'fundo.story.png']);
    const scene = sceneOf(value);
    expect(artOf(scene)).toEqual([
      ['feed', 'fundo.png'],
      ['story', 'fundo.story.png'],
    ]);
    expect(scene.assets.map((asset) => asset.id).sort()).toEqual(['fundo.png', 'fundo.story.png']);
  });

  it('leaves a brief with no copy as it was', async () => {
    const { value, problems } = await resolved({ fundo: 'fundo.png' }, ['fundo.png']);

    expect(problems).toEqual([]);
    expect(value).not.toHaveProperty('externalArt');
    expect(artOf(sceneOf(value))).toEqual([
      ['feed', 'fundo.png'],
      ['story', 'fundo.png'],
    ]);
  });

  it('stands in for a cited file that is missing, and the box stays where no copy is', async () => {
    const { value, problems } = await resolved({ fundo: 'fundo.png' }, ['fundo.story.png']);

    expect(problems.map((item) => item.message)).toEqual([
      "Slot 'fundo' of template 'arte' has no art yet ('fundo.png' was not found in 'briefs/' for format 'feed'); an outlined box is drawn where it goes.",
    ]);
    expect(artOf(sceneOf(value))).toEqual([
      ['feed', 'box'],
      ['story', 'fundo.story.png'],
    ]);
  });

  it('warns about nothing when every format has its copy', async () => {
    const { value, problems } = await resolved({ fundo: 'fundo.png' }, [
      'fundo.feed.png',
      'fundo.story.png',
    ]);

    expect(problems).toEqual([]);
    expect(artOf(sceneOf(value))).toEqual([
      ['feed', 'fundo.feed.png'],
      ['story', 'fundo.story.png'],
    ]);
  });

  it('warns as before when neither a copy nor the cited file is there', async () => {
    const { value, problems } = await resolved({ fundo: 'fundo.png' }, []);

    expect(problems.map((item) => item.message)).toEqual([
      "Slot 'fundo' of template 'arte' has no art yet ('fundo.png' was not found in 'briefs/'); an outlined box is drawn where it goes.",
    ]);
    expect(artOf(sceneOf(value))).toEqual([
      ['feed', 'box'],
      ['story', 'box'],
    ]);
  });

  it('is never looked for beside a picture that is not external art', async () => {
    const { value, asked } = await resolved({ foto: 'foto.png' }, ['foto.png', 'foto.story.png']);

    expect(asked).toEqual(['foto.png']);
    expect(value).not.toHaveProperty('externalArt');
  });

  it('is left out of a guide, where the art is empty', async () => {
    const { value } = await resolved({ fundo: 'fundo.png' }, ['fundo.png', 'fundo.story.png']);

    expect(artOf(sceneOf(value, true))).toEqual([
      ['feed', 'box'],
      ['story', 'box'],
    ]);
  });
});

/**
 * Why an external slot's file did not resolve, when the asset port knows (ADR 0223, TYTO-742):
 * a `.psd` that is there and no plugin decodes, or one whose decode failed, says so as a plain
 * slot does, and the box still stands in for the art.
 */
describe('external art the asset port can explain', () => {
  const NO_DECODER = diagnostic('E_ASSET_DECODER_MISSING', {
    path: 'fundo.guide.psd#arte',
    extension: '.psd',
  });
  const NO_LAYER = diagnostic('E_ASSET_DECODE_FAILED', {
    path: 'fundo.guide.psd#arte',
    plugin: 'psd-decoder',
    problem: "fundo.guide.psd: no layer is named 'nada'",
  });

  /** A folder holding `files`, whose port explains the references in `reasons`. */
  async function explained(
    data: Readonly<Record<string, string>>,
    files: readonly string[],
    reasons: Readonly<Record<string, Diagnostic>>,
    guide = false,
  ): Promise<{ value: ResolvedBrief; problems: Diagnostic[] }> {
    const { assets } = folder(files);
    const result = await resolve(brief(data), {
      registry,
      assets: { ...assets, explain: (reference) => reasons[reference] },
      ...(guide ? { guide: true } : {}),
    });
    if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
    return { value: result.value, problems: [...result.diagnostics] };
  }

  it('says which plugin is missing at the slot, and draws the box', async () => {
    const { value, problems } = await explained({ fundo: 'fundo.guide.psd#arte' }, [], {
      'fundo.guide.psd#arte': NO_DECODER,
    });

    expect(problems.map(({ code, message, range }) => ({ code, message, range }))).toEqual([
      {
        code: 'E_ASSET_DECODER_MISSING',
        message:
          "Asset 'fundo.guide.psd#arte' is a '.psd' file, which Tyto cannot draw by itself; install a plugin that decodes '.psd' files.",
        range: FRONT,
      },
    ]);
    expect(artOf(sceneOf(value))).toEqual([
      ['feed', 'box'],
      ['story', 'box'],
    ]);
  });

  it("carries the decoder's own message when the decode failed", async () => {
    const { value, problems } = await explained({ fundo: 'fundo.guide.psd#arte' }, [], {
      'fundo.guide.psd#arte': NO_LAYER,
    });

    expect(problems.map(({ code, message, range }) => ({ code, message, range }))).toEqual([
      {
        code: 'E_ASSET_DECODE_FAILED',
        message:
          "Asset 'fundo.guide.psd#arte' could not be decoded by plugin 'psd-decoder': fundo.guide.psd: no layer is named 'nada'.",
        range: FRONT,
      },
    ]);
    expect(artOf(sceneOf(value))).toEqual([
      ['feed', 'box'],
      ['story', 'box'],
    ]);
  });

  it('explains a format’s own copy that is there and could not be decoded', async () => {
    const copy = diagnostic('E_ASSET_DECODE_FAILED', {
      path: 'capa.story.psd',
      plugin: 'psd-decoder',
      problem: 'capa.story.psd: the composite is transparent',
    });
    const { value, problems } = await explained({ fundo: 'capa.psd' }, ['capa.psd'], {
      'capa.story.psd': copy,
    });

    expect(problems.map(({ code, message, range }) => ({ code, message, range }))).toEqual([
      {
        code: 'E_ASSET_DECODE_FAILED',
        message:
          "Asset 'capa.story.psd' could not be decoded by plugin 'psd-decoder': capa.story.psd: the composite is transparent.",
        range: FRONT,
      },
    ]);
    // The story falls back to the cited file, as for a copy that is not there.
    expect(artOf(sceneOf(value))).toEqual([
      ['feed', 'capa.psd'],
      ['story', 'capa.psd'],
    ]);
  });

  it('warns as before when the port has nothing to say: the file is not there', async () => {
    const { value, problems } = await explained({ fundo: 'fundo.png' }, [], {});

    expect(problems.map((item) => item.code)).toEqual(['W_EXTERNAL_ART_MISSING']);
    expect(artOf(sceneOf(value))).toEqual([
      ['feed', 'box'],
      ['story', 'box'],
    ]);
  });

  it('says nothing of the cited file when every format has its own copy', async () => {
    const { problems } = await explained(
      { fundo: 'fundo.guide.psd#arte' },
      ['fundo.guide.feed.psd#arte', 'fundo.guide.story.psd#arte'],
      { 'fundo.guide.psd#arte': NO_DECODER },
    );

    expect(problems).toEqual([]);
  });

  it('asks nothing in a guide, which is written for a file no plugin decodes yet', async () => {
    const { value, problems } = await explained(
      { fundo: 'fundo.guide.psd#arte' },
      [],
      { 'fundo.guide.psd#arte': NO_DECODER },
      true,
    );

    expect(problems.map((item) => item.code)).toEqual(['W_EXTERNAL_ART_MISSING']);
    expect(artOf(sceneOf(value, true))).toEqual([
      ['feed', 'box'],
      ['story', 'box'],
    ]);
  });
});
