import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive, Inline, RichText } from './ast.js';
import { compile } from './compile.js';
import { type ResolvedBrief, type SlideBlock, resolve } from './resolve.js';
import { formatCatalogue } from '../config/formats.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import type { AssetRef } from '../scene/primitives.js';
import { sourceRange } from '../source/range.js';
import { defineTemplate } from '../template/define.js';
import { type TemplateManifest, parseManifest } from '../template/manifest.js';
import { frame, image, rect } from '../template/nodes.js';
import type { TemplateRegistry } from '../template/registry.js';

/**
 * Several pictures on one slide, each where its body says (ADR 0160, amended 2026-10-31):
 * `imagem: { type: image, per: lamina, multiple: true }`, and the lines under an `::imagem`
 * continue the slide's body.
 */

const BASE = `name: questao
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true, min: 1 }
`;

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

function manifestProblems(source: string): string[] {
  const parsed = parseManifest(source, 'manifest.yaml');
  return parsed.ok ? [] : parsed.error.map((item) => item.message);
}

const MULTIPLE = manifestOf(`${BASE}  imagem: { type: image, per: lamina, multiple: true }\n`);
const SINGLE = manifestOf(`${BASE}  imagem: { type: image, per: lamina }\n`);

function registryOf(manifest: TemplateManifest): TemplateRegistry {
  return {
    list: () => [manifest],
    get: (name) => (name === manifest.name ? manifest : undefined),
    formatsOf: (name) => (name === manifest.name ? manifest.formats : undefined),
    directoryOf: () => 'templates/questao',
    failures: [],
  };
}

const refOf = (path: string): AssetRef => ({
  id: path.replace(/\W/gu, ''),
  source: 'file',
  path,
  hash: `sha256-${path.length}`,
});

const ON_DISK = new Set(['./a.png', './b.png']);

const assets: AssetResolver = {
  base: 'briefs/',
  resolve: (reference) => Promise.resolve(ON_DISK.has(reference) ? refOf(reference) : undefined),
};

/**
 * A directive as the parser builds it: its lines joined by a `Break`, none before the first,
 * each line at its own offsets, so a range names one line.
 */
let line = 0;
function directive(name: string, head: string, ...lines: string[]): Directive {
  line += 1;
  const start = line * 1000;
  const body: Inline[] = [];
  let at = start + name.length + 3;
  const written = head === '' ? lines : [head, ...lines];
  written.forEach((value, index) => {
    if (index > 0) {
      body.push({ kind: 'break', range: sourceRange(at, at + 1) });
      at += 3;
    }
    body.push({ kind: 'text', value, range: sourceRange(at, at + value.length) });
    at += value.length;
  });
  return {
    name,
    adjustments: [],
    body,
    range: sourceRange(start, at),
    nameRange: sourceRange(start + 2, start + 2 + name.length),
  };
}

function brief(directives: readonly Directive[]): BriefAst {
  return {
    frontmatter: { data: { template: 'questao' }, ranges: {}, range: sourceRange(0, 40) },
    directives,
    range: sourceRange(0, 100_000),
  };
}

async function resolved(
  ast: BriefAst,
  manifest: TemplateManifest = MULTIPLE,
): Promise<{ readonly value: ResolvedBrief; readonly problems: readonly Diagnostic[] }> {
  const result = await resolve(ast, { registry: registryOf(manifest), assets });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { value: result.value, problems: result.diagnostics };
}

/** A slide's blocks as words: the text of a run, the path of a picture. */
function wordsOf(blocks: readonly SlideBlock[] | undefined): string[] | undefined {
  return blocks?.map((block) => {
    if (block.kind === 'slot') {
      return block.slot.value.kind === 'image' ? (block.slot.value.asset.path ?? '?') : '?';
    }
    return block.text.map((inline) => (inline.kind === 'text' ? inline.value : '/')).join('');
  });
}

describe('pictures placed among a slide lines', () => {
  it('keeps text, picture, text, picture in the order the slide wrote them', async () => {
    const { value, problems } = await resolved(
      brief([
        directive('lamina', '', 'Paragrafo 1'),
        directive('imagem', './a.png', 'Paragrafo 2', 'Paragrafo 3'),
        directive('imagem', './b.png'),
        directive('lamina', 'Dois'),
      ]),
    );

    expect(problems).toEqual([]);
    expect(value.artworks.map((artwork) => wordsOf(artwork.slot.blocks))).toEqual([
      ['Paragrafo 1', './a.png', 'Paragrafo 2/Paragrafo 3', './b.png'],
      ['Dois'],
    ]);
    // What a template written for one picture reads is unchanged: the opening text, the first.
    const first = value.artworks[0];
    expect(wordsOf([{ kind: 'text', text: textOf(first), range: sourceRange(0, 0) }])).toEqual([
      'Paragrafo 1',
    ]);
    expect(first?.slots.imagem?.value).toMatchObject({ asset: { path: './a.png' } });
    expect(value.assets.map((asset) => asset.path)).toEqual(['./a.png', './b.png']);
  });

  it('reads the path on the first indented line when the directive line has none', async () => {
    const { value, problems } = await resolved(
      brief([directive('lamina', 'Um'), directive('imagem', '', './a.png', 'Depois')]),
    );

    expect(problems).toEqual([]);
    expect(wordsOf(value.artworks[0]?.slot.blocks)).toEqual(['Um', './a.png', 'Depois']);
  });

  it('reports a missing second picture at its own line and keeps the text under it', async () => {
    const second = directive('imagem', './nao-existe.png', 'Depois');
    const { value, problems } = await resolved(
      brief([directive('lamina', 'Um'), directive('imagem', './a.png'), second]),
    );

    const pathEnd = second.range.start + 'imagem'.length + 3 + './nao-existe.png'.length;
    expect(problems.map((item) => [item.code, item.range])).toEqual([
      ['E_ASSET_NOT_FOUND', sourceRange(second.range.start, pathEnd)],
    ]);
    expect(wordsOf(value.artworks[0]?.slot.blocks)).toEqual(['Um', './a.png', 'Depois']);
  });

  it('still refuses one written before any slide', async () => {
    const early = directive('imagem', './a.png');
    const { problems } = await resolved(brief([early, directive('lamina', 'Um')]));

    expect(problems.map((item) => item.code)).toEqual(['E_BAD_SLOT_VALUE']);
    expect(problems[0]?.message).toContain("no 'lamina' comes before it");
  });
});

/** The value a template written for one picture reads as the slide's text. */
function textOf(artwork: ResolvedBrief['artworks'][number] | undefined): RichText {
  const value = artwork?.slot.value;
  return value?.kind === 'rich-text' ? value.text : [];
}

describe('a slot without multiple', () => {
  it('takes the lines under an ::imagem as part of its path, as before', async () => {
    const written = directive('imagem', './a.png', 'Paragrafo 2');
    const { value, problems } = await resolved(brief([directive('lamina', 'Um'), written]), SINGLE);

    expect(problems.map((item) => [item.code, item.range])).toEqual([
      ['E_ASSET_NOT_FOUND', written.range],
    ]);
    expect(problems[0]?.message).toContain("'./a.png\nParagrafo 2'");
    expect(value.artworks[0]?.slot.blocks).toBeUndefined();
  });

  it('still refuses a second one for the same slide', async () => {
    const { problems } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('imagem', './a.png'),
        directive('imagem', './b.png'),
      ]),
      SINGLE,
    );

    expect(problems.map((item) => item.code)).toEqual(['E_BAD_SLOT_VALUE']);
  });
});

describe('compiling pictures among the lines', () => {
  const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 } });

  /** Draws a slide's blocks top to bottom: a run of text as a box, a picture as itself. */
  function templateOf(manifest: TemplateManifest): ReturnType<typeof defineTemplate> {
    return defineTemplate(manifest, (context) => {
      const slide = context.slots.lamina;
      const picture = context.slots.imagem?.value;
      const blocks: readonly SlideBlock[] =
        slide?.blocks ??
        (picture?.kind === 'image' ? [{ kind: 'slot', slot: context.slots.imagem! }] : []);
      return frame({
        format: context.format,
        size: context.size,
        idPrefix: context.idPrefix,
        children: blocks.map((block, index) =>
          block.kind === 'slot' && block.slot.value.kind === 'image'
            ? image({
                asset: block.slot.value.asset,
                size: { w: 1080, h: 100 },
                transform: { y: index * 100 },
              })
            : rect({ size: { w: 1080, h: 100 }, transform: { y: index * 100 } }),
        ),
      });
    });
  }

  it('draws both pictures where the body put them', async () => {
    const { value } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('imagem', './a.png', 'Dois'),
        directive('imagem', './b.png'),
      ]),
    );
    const scene = compile(value, templateOf(MULTIPLE), { formats: FORMATS });
    if (!scene.ok) throw new Error(scene.error.map((item) => item.message).join('; '));

    const drawn = scene.value.artworks[0]?.frames[0]?.children.map((node) =>
      node.kind === 'image' ? node.asset.path : node.kind,
    );
    expect(drawn).toEqual(['rect', './a.png', 'rect', './b.png']);
  });

  it('gives a brief written for one picture the same scene with or without multiple', async () => {
    const written = brief([
      directive('lamina', 'Um'),
      directive('imagem', './a.png'),
      directive('lamina', 'Dois'),
      directive('imagem', './b.png'),
    ]);
    const reader = (manifest: TemplateManifest) =>
      defineTemplate(manifest, (context) => {
        const picture = context.slots.imagem?.value;
        return frame({
          format: context.format,
          size: context.size,
          idPrefix: context.idPrefix,
          children:
            picture?.kind === 'image'
              ? [image({ asset: picture.asset, size: { w: 1080, h: 600 } })]
              : [],
        });
      });

    const before = compile((await resolved(written, SINGLE)).value, reader(SINGLE), {
      formats: FORMATS,
    });
    const after = compile((await resolved(written, MULTIPLE)).value, reader(MULTIPLE), {
      formats: FORMATS,
    });
    if (!before.ok || !after.ok) throw new Error('did not compile');
    expect(JSON.stringify(after.value)).toBe(JSON.stringify(before.value));
  });
});

describe('a manifest that declares multiple', () => {
  it('accepts it on a per image slot only', () => {
    expect(
      manifestProblems(`${BASE}  imagem: { type: image, per: lamina, multiple: true }
  foto: { type: image, multiple: true }
  texto: { type: rich-text, per: lamina, multiple: true }
`),
    ).toEqual([
      expect.stringContaining('multiple is only meaningful on an image slot that declares per'),
      expect.stringContaining('multiple is only meaningful on an image slot that declares per'),
    ]);
  });
});
