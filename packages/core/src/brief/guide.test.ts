import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive } from './ast.js';
import { compile } from './compile.js';
import { type ResolvedBrief, resolve } from './resolve.js';
import { formatCatalogue } from '../config/formats.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import { type Scene, parseScene } from '../scene/scene.js';
import { sourceRange } from '../source/range.js';
import { defineTemplate } from '../template/define.js';
import { type TemplateManifest, parseManifest } from '../template/manifest.js';
import { frame, image, rect, text } from '../template/nodes.js';
import type { TemplateRegistry } from '../template/registry.js';
import { runsOf } from '../template/runs.js';
import { solid } from '../template/values.js';

/**
 * The guide's Scene (ADR 0220): one layout path, each frame cut into `texto`, `areas`, `arte`
 * and `decoracao`, and one canvas per `inline` slot.
 */

const ARTE: TemplateManifest = (() => {
  const parsed = parseManifest(
    `name: arte
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text }
  fundo:
    type: image
    external:
      kind: full
      sizes: { feed: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } }
  ilustracao:
    type: image
    external:
      kind: inline
      sizes: { feed: { width: 800, suggestedHeight: 300 }, story: { width: 800, suggestedHeight: 600 } }
`,
    'manifest.yaml',
  );
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
})();

const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } });

const registry: TemplateRegistry = {
  list: () => [ARTE],
  get: (name) => (name === ARTE.name ? ARTE : undefined),
  formatsOf: (name) => (name === ARTE.name ? ARTE.formats : undefined),
  directoryOf: () => 'templates/arte',
  failures: [],
};

const assets: AssetResolver = {
  base: 'briefs/',
  resolve: (reference) =>
    Promise.resolve(
      reference === './fundo.png'
        ? { id: 'fundo', source: 'file', path: reference, hash: 'sha256-1' }
        : undefined,
    ),
};

function directive(name: string, body: string, at: number): Directive {
  const range = sourceRange(at, at + 20);
  return {
    name,
    adjustments: [],
    body: [{ kind: 'text', value: body, range }],
    range,
    nameRange: range,
  };
}

async function resolved(directives: readonly Directive[]): Promise<ResolvedBrief> {
  const ast: BriefAst = {
    frontmatter: { data: { template: 'arte' }, ranges: {}, range: sourceRange(0, 40) },
    directives,
    range: sourceRange(0, 1_000),
  };
  const result = await resolve(ast, { registry, assets });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { ...result.value, formats: ['feed', 'story'] };
}

/**
 * A shape under the art, the art, the title, the inline picture and a band over everything:
 * every layer has something in it.
 */
const TEMPLATE = defineTemplate(ARTE, (context) => {
  const { fundo, titulo, ilustracao } = context.slots;
  const runs =
    titulo?.value.kind === 'rich-text'
      ? runsOf(titulo.value.text, {
          font: { family: 'Sans', source: 'bundled' },
          size: 40,
          color: '#111111',
        })
      : [];
  const [first, ...rest] = runs;
  return frame({
    format: context.format,
    size: context.size,
    children: [
      rect({ id: `${context.idPrefix}.sombra`, size: { w: 100, h: 100 }, fill: solid('#333333') }),
      ...(fundo?.value.kind === 'image'
        ? [image({ id: `${context.idPrefix}.fundo`, asset: fundo.value.asset, size: context.size })]
        : []),
      ...(first === undefined
        ? []
        : [
            text({
              id: `${context.idPrefix}.titulo`,
              runs: [first, ...rest],
              box: { w: 900, h: 120 },
              transform: { x: 90, y: 60 },
            }),
          ]),
      ...(ilustracao?.value.kind === 'image'
        ? [
            image({
              id: `${context.idPrefix}.ilustracao`,
              asset: ilustracao.value.asset,
              size: ilustracao.value.asset.size ?? { w: 1, h: 1 },
              transform: { x: 140, y: 300 },
            }),
          ]
        : []),
      rect({
        id: `${context.idPrefix}.faixa`,
        size: { w: 1080, h: 40 },
        fill: solid('#ffcc00'),
        transform: { y: 900 },
      }),
    ],
  });
});

function sceneOf(result: ReturnType<typeof compile>): Scene {
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

const TITLE = [directive('titulo', 'Titulo', 100)];

describe('compile without a guide', () => {
  it('writes the Scene it wrote before: no guide key, no canvas', async () => {
    const value = await resolved(TITLE);
    const plain = sceneOf(compile(value, TEMPLATE, { formats: FORMATS }));
    const off = sceneOf(compile(value, TEMPLATE, { formats: FORMATS, guide: false }));

    expect(JSON.stringify(off)).toBe(JSON.stringify(plain));
    expect(plain.artworks.map((artwork) => artwork.id)).toEqual(['artwork-1']);
    expect(plain.artworks[0]?.frames.some((built) => 'guide' in built)).toBe(false);
  });

  it('drops a guide a template sent with its frame', async () => {
    const sending = defineTemplate(ARTE, (context) => ({
      ...frame({ format: context.format, size: context.size, children: [] }),
      guide: { layers: [] },
    }));
    const scene = sceneOf(compile(await resolved([]), sending, { formats: FORMATS }));
    expect(scene.artworks[0]?.frames.some((built) => 'guide' in built)).toBe(false);
  });
});

describe('compile with a guide', () => {
  it('cuts each frame into texto, areas, arte and decoracao around the full art', async () => {
    const scene = sceneOf(
      compile(await resolved(TITLE), TEMPLATE, { formats: FORMATS, guide: true }),
    );
    const feed = scene.artworks[0]?.frames[0];

    expect(feed?.guide).toEqual({
      art: { slot: 'fundo', kind: 'full', box: { x: 0, y: 0, w: 1080, h: 1080 } },
      layers: [
        {
          name: 'texto',
          label: 'texto',
          nodes: ['artwork-1.feed.titulo', 'artwork-1.feed.faixa'],
          locked: true,
          visible: true,
          opacity: 1,
        },
        {
          name: 'areas',
          label: 'areas',
          nodes: [
            'artwork-1.feed.fundo',
            'artwork-1.feed.ilustracao',
            'artwork-1.feed.titulo.area',
            'artwork-1.feed.titulo.area-label',
          ],
          locked: true,
          visible: true,
          opacity: 0.5,
        },
        { name: 'arte', label: 'arte', nodes: [], locked: false, visible: true, opacity: 1 },
        {
          name: 'decoracao',
          label: 'decoracao',
          nodes: ['artwork-1.feed.sombra'],
          locked: true,
          visible: false,
          opacity: 1,
        },
      ],
    });
    expect(scene.artworks[0]?.frames[1]?.guide?.art?.box).toEqual({
      x: 0,
      y: 0,
      w: 1080,
      h: 1920,
    });
  });

  it('outlines each slot node at its real layout box, named by the slot', async () => {
    const scene = sceneOf(
      compile(await resolved(TITLE), TEMPLATE, { formats: FORMATS, guide: true }),
    );
    const children = scene.artworks[0]?.frames[0]?.children ?? [];
    const area = children.find((node) => node.id === 'artwork-1.feed.titulo.area');
    const label = children.find((node) => node.id === 'artwork-1.feed.titulo.area-label');

    expect(area).toMatchObject({
      kind: 'rect',
      name: 'titulo',
      size: { w: 900, h: 120 },
      transform: { x: 90, y: 60 },
    });
    expect(area?.kind === 'rect' ? area.fill : 'filled').toBeUndefined();
    expect(label?.kind === 'text' ? label.runs : []).toMatchObject([
      { kind: 'text', text: 'titulo', font: { family: 'Sans' } },
    ]);
    // Appended over everything the template drew.
    expect(children.slice(-2).map((node) => node.id)).toEqual([
      'artwork-1.feed.titulo.area',
      'artwork-1.feed.titulo.area-label',
    ]);
  });

  it('adds one canvas per inline slot, a frame per format, only the arte layer', async () => {
    const scene = sceneOf(
      compile(await resolved(TITLE), TEMPLATE, { formats: FORMATS, guide: true }),
    );
    const canvas = scene.artworks[1];

    expect(scene.artworks.map((artwork) => artwork.id)).toEqual([
      'artwork-1',
      'external-art-ilustracao',
    ]);
    expect(
      canvas?.frames.map((built) => [built.format, built.size, built.children, built.guide]),
    ).toEqual([
      [
        'feed',
        { w: 800, h: 300 },
        [],
        {
          art: { slot: 'ilustracao', kind: 'inline', box: { x: 0, y: 0, w: 800, h: 300 } },
          layers: [
            {
              name: 'arte',
              label: 'arte 800px',
              nodes: [],
              locked: false,
              visible: true,
              opacity: 1,
            },
          ],
        },
      ],
      [
        'story',
        { w: 800, h: 600 },
        [],
        {
          art: { slot: 'ilustracao', kind: 'inline', box: { x: 0, y: 0, w: 800, h: 600 } },
          layers: [
            {
              name: 'arte',
              label: 'arte 800px',
              nodes: [],
              locked: false,
              visible: true,
              opacity: 1,
            },
          ],
        },
      ],
    ]);
  });

  it('leaves the art empty even when the brief names a file that is there', async () => {
    const scene = sceneOf(
      compile(await resolved([...TITLE, directive('fundo', './fundo.png', 200)]), TEMPLATE, {
        formats: FORMATS,
        guide: true,
      }),
    );
    const fundo = scene.artworks[0]?.frames[0]?.children.find(
      (node) => node.id === 'artwork-1.feed.fundo',
    );
    expect(fundo).toMatchObject({ kind: 'rect', name: 'external-art:fundo' });
    expect(scene.assets).toEqual([]);
  });
});

describe('a guide that does not cut its frame exactly', () => {
  async function guided(): Promise<Scene> {
    return sceneOf(compile(await resolved(TITLE), TEMPLATE, { formats: FORMATS, guide: true }));
  }

  function codesOf(scene: Scene): string[] {
    const parsed = parseScene(scene);
    return parsed.ok ? [] : parsed.error.map((item) => `${item.code} ${item.message}`);
  }

  it('is refused when a node is in two layers', async () => {
    const scene = await guided();
    const feed = scene.artworks[0]?.frames[0];
    feed?.guide?.layers[2]?.nodes.push('artwork-1.feed.faixa');

    expect(codesOf(scene)).toEqual([
      "E_SCENE_GUIDE_LAYERING Node 'artwork-1.feed.faixa' of the guide for 'artwork-1:feed' is in 2 layers; every top-level node is in exactly one.",
    ]);
  });

  it('is refused when a node is in no layer, or a layer names a node that is not there', async () => {
    const scene = await guided();
    const layers = scene.artworks[0]?.frames[0]?.guide?.layers ?? [];
    layers[3]?.nodes.splice(0, 1, 'artwork-1.feed.nada');

    expect(codesOf(scene)).toEqual([
      "E_SCENE_GUIDE_NODE_NOT_FOUND Layer 'decoracao' of the guide for 'artwork-1:feed' names node 'artwork-1.feed.nada', which is not one of the frame's top-level children.",
      "E_SCENE_GUIDE_LAYERING Node 'artwork-1.feed.sombra' of the guide for 'artwork-1:feed' is in 0 layers; every top-level node is in exactly one.",
    ]);
  });
});
