import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive } from './ast.js';
import { compile } from './compile.js';
import { type ResolvedBrief, resolve } from './resolve.js';
import { formatCatalogue } from '../config/formats.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import { isExternalArtPlaceholder } from '../scene/external-art.js';
import type { SceneNode } from '../scene/nodes.js';
import type { AssetRef } from '../scene/primitives.js';
import type { Scene } from '../scene/scene.js';
import { sourceRange } from '../source/range.js';
import { defineTemplate } from '../template/define.js';
import { type TemplateManifest, parseManifest } from '../template/manifest.js';
import { frame, image } from '../template/nodes.js';
import type { TemplateRegistry } from '../template/registry.js';
import { imagePaint } from '../template/values.js';

/**
 * A slot whose art is painted outside Tyto (ADR 0220): the manifest declares its size per
 * format, a brief with no file for it yet renders, and the art's place is an outlined box in
 * the template's own position, size and stacking, never a blank.
 */

const MANIFEST = `name: arte
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text }
  fundo:
    type: image
    required: true
    external:
      kind: full
      sizes: { feed: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } }
  ilustracao:
    type: image
    external:
      kind: inline
      sizes: { feed: { width: 800, suggestedHeight: 300 }, story: { width: 800, suggestedHeight: 600 } }
`;

const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } });

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

function manifestProblems(source: string): (readonly [string, boolean])[] {
  const parsed = parseManifest(source, 'manifest.yaml');
  return parsed.ok ? [] : parsed.error.map((item) => [item.message, item.range !== undefined]);
}

const ARTE = manifestOf(MANIFEST);

const registry: TemplateRegistry = {
  list: () => [ARTE],
  get: (name) => (name === ARTE.name ? ARTE : undefined),
  formatsOf: (name) => (name === ARTE.name ? ARTE.formats : undefined),
  directoryOf: () => 'templates/arte',
  failures: [],
};

const ON_DISK = new Set(['./fundo.png']);
const assets: AssetResolver = {
  base: 'briefs/',
  resolve: (reference) =>
    Promise.resolve(
      ON_DISK.has(reference)
        ? {
            id: 'fundo',
            source: 'file',
            path: reference,
            hash: 'sha256-1',
            size: { w: 1080, h: 1080 },
          }
        : undefined,
    ),
};

const FRONT = sourceRange(0, 40);

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

function brief(directives: readonly Directive[]): BriefAst {
  return {
    frontmatter: { data: { template: 'arte' }, ranges: {}, range: FRONT },
    directives,
    range: sourceRange(0, 1_000),
  };
}

async function resolved(ast: BriefAst): Promise<{ value: ResolvedBrief; problems: Diagnostic[] }> {
  const result = await resolve(ast, { registry, assets });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { value: result.value, problems: [...result.diagnostics] };
}

const assetOf = (value: ResolvedBrief, name: string): AssetRef | undefined => {
  const slot = value.slots[name];
  return slot?.value.kind === 'image' ? slot.value.asset : undefined;
};

describe('the external declaration in a manifest', () => {
  it('parses, and a manifest without it parses as it did', () => {
    expect(ARTE.slots.fundo?.external).toEqual({
      kind: 'full',
      sizes: { feed: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } },
    });
    expect(
      manifestOf('name: a\nversion: 1.0.0\nformats: [feed]\nslots:\n  b: { type: image }\n').slots
        .b,
    ).toEqual({ type: 'image', required: false, repeat: false });
  });

  it.each([
    [
      'a rich-text slot',
      'type: rich-text, external: { kind: inline, sizes: { feed: { width: 10, suggestedHeight: 5 } } }',
      'only meaningful on an',
    ],
    [
      'a full slot with no height',
      'type: image, external: { kind: full, sizes: { feed: { width: 10 } } }',
      "height is required for each format of a 'full'",
    ],
    [
      'an inline slot with no suggested height',
      'type: image, external: { kind: inline, sizes: { feed: { width: 10 } } }',
      "suggestedHeight is required for each format of an? 'inline'",
    ],
    [
      'an inline slot with a height',
      'type: image, external: { kind: inline, sizes: { feed: { width: 10, suggestedHeight: 5, height: 5 } } }',
      'height is not meaningful',
    ],
    [
      'a format the manifest does not render',
      'type: image, external: { kind: full, sizes: { feed: { width: 10, height: 10 }, banner: { width: 10, height: 5 } } }',
      "names format 'banner'",
    ],
    [
      'a slot that belongs to each slide',
      'type: image, per: lamina, external: { kind: full, sizes: { feed: { width: 10, height: 10 } } }',
      'one picture per format',
    ],
  ])('refuses %s, at the key that says it', (_case, slot, message) => {
    const problems = manifestProblems(
      `name: a\nversion: 1.0.0\nformats: [feed]\nslots:\n  lamina: { type: rich-text, repeat: true }\n  b: { ${slot} }\n`,
    );
    expect(problems).toEqual([[expect.stringMatching(new RegExp(message, 'u')), true]]);
  });

  it('refuses a format the manifest renders and the declaration leaves out', () => {
    expect(
      manifestProblems(
        'name: a\nversion: 1.0.0\nformats: [feed, story]\nslots:\n  b: { type: image, external: { kind: full, sizes: { feed: { width: 10, height: 10 } } } }\n',
      ),
    ).toEqual([[expect.stringContaining("states no size for format 'story'"), true]]);
  });
});

describe('a brief with no file yet for an external slot', () => {
  it('warns at the frontmatter, and hands the template a placeholder rather than a hole', async () => {
    const { value, problems } = await resolved(brief([directive('titulo', 'Titulo', 100)]));

    expect(problems.map((item) => [item.code, item.range])).toEqual([
      ['W_EXTERNAL_ART_MISSING', FRONT],
      ['W_EXTERNAL_ART_MISSING', FRONT],
    ]);
    expect(problems[0]?.message).toBe(
      "Slot 'fundo' of template 'arte' has no art yet (the brief names no file); an outlined box is drawn where it goes.",
    );
    // Required, and still not missing: the art is late by design, not forgotten.
    expect(value.missingRequiredSlots).toEqual([]);
    expect(
      isExternalArtPlaceholder(assetOf(value, 'fundo') ?? { id: 'x', source: 'file', hash: 'x' }),
    ).toBe(true);
    // Nothing for the job to load bytes for.
    expect(value.assets).toEqual([]);
  });

  it('warns at the line that names a file that is not there', async () => {
    const missing = directive('ilustracao', './ilustracao.png', 200);
    const { problems } = await resolved(brief([directive('fundo', './fundo.png', 100), missing]));

    expect(problems.map((item) => [item.code, item.range])).toEqual([
      ['W_EXTERNAL_ART_MISSING', missing.range],
    ]);
    expect(problems[0]?.message).toContain("'./ilustracao.png' was not found in 'briefs/'");
  });

  it('reads a file that is there as any picture', async () => {
    const { value } = await resolved(brief([directive('fundo', './fundo.png', 100)]));
    expect(assetOf(value, 'fundo')?.path).toBe('./fundo.png');
    expect(value.assets.map((asset) => asset.path)).toEqual(['./fundo.png']);
  });
});

/** Every node of a frame, groups opened. */
function nodesOf(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) =>
    node.kind === 'group' ? [node, ...nodesOf(node.children)] : [node],
  );
}

/** A template that sizes the inline art by its ref, as a picture is sized (ADR 0158). */
const TEMPLATE = defineTemplate(ARTE, (context) => {
  const ilustracao = context.slots.ilustracao?.value;
  const fundo = context.slots.fundo?.value;
  return frame({
    format: context.format,
    size: context.size,
    ...(fundo?.kind === 'image' ? { background: imagePaint(fundo.asset) } : {}),
    children:
      ilustracao?.kind === 'image'
        ? [
            image({
              id: `${context.idPrefix}.ilustracao`,
              asset: ilustracao.asset,
              size: ilustracao.asset.size ?? { w: 1, h: 1 },
              transform: { x: 140, y: 100 },
            }),
          ]
        : [],
  });
});

function sceneOf(result: ReturnType<typeof compile>): Scene {
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

describe('compiling a placeholder', () => {
  it('draws an outlined box where the template placed it, at each format’s declared size', async () => {
    const { value } = await resolved(brief([]));
    const scene = sceneOf(
      compile({ ...value, formats: ['feed', 'story'] }, TEMPLATE, { formats: FORMATS }),
    );

    const boxes = scene.artworks[0]?.frames.map((built) =>
      nodesOf(built.children).map((node) => [
        node.kind,
        node.name,
        node.kind === 'rect' ? node.size : undefined,
      ]),
    );
    expect(boxes).toEqual([
      [
        ['rect', 'external-art:fundo', { w: 1080, h: 1080 }],
        ['rect', 'external-art:ilustracao', { w: 800, h: 300 }],
      ],
      [
        ['rect', 'external-art:fundo', { w: 1080, h: 1920 }],
        ['rect', 'external-art:ilustracao', { w: 800, h: 600 }],
      ],
    ]);
    const ilustracao = nodesOf(scene.artworks[0]?.frames[1]?.children ?? [])[1];
    expect(ilustracao?.transform).toMatchObject({ x: 140, y: 100 });
    expect(ilustracao?.kind === 'rect' ? ilustracao.stroke?.paint : undefined).toEqual({
      kind: 'solid',
      color: { r: 255, g: 0, b: 170, a: 1 },
    });
    expect(scene.artworks[0]?.frames[0]?.background).toBeUndefined();
    expect(scene.assets).toEqual([]);
  });

  it('refuses full art that does not keep a format’s proportion', async () => {
    const { value } = await resolved(brief([]));
    const wide = formatCatalogue({ feed: { w: 1080, h: 1080 }, story: { w: 1080, h: 1350 } });
    const result = compile({ ...value, formats: ['feed', 'story'] }, TEMPLATE, { formats: wide });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.error.map((item) => [item.code, item.message])).toEqual([
      [
        'E_EXTERNAL_ART_ASPECT',
        "Slot 'fundo' of template 'arte' declares full art of 1080×1920 for format 'story', which is 1080×1350: full art keeps the format's proportion, so its height there is 1350.",
      ],
    ]);
  });
});
