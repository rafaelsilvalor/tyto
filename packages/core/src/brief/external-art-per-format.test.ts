import { describe, expect, it } from 'vitest';

import type { BriefAst } from './ast.js';
import { compile } from './compile.js';
import { externalArtVariant } from './external-art-files.js';
import { type ResolvedBrief, resolve } from './resolve.js';
import { formatCatalogue } from '../config/formats.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
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
