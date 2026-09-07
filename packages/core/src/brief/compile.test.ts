import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive, Frontmatter, RichText } from './ast.js';
import { compile } from './compile.js';
import { type ResolvedBrief, resolve } from './resolve.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import type { AssetRef } from '../scene/primitives.js';
import type { Frame, Scene } from '../scene/scene.js';
import { sourceRange } from '../source/range.js';
import { type Template, defineTemplate } from '../template/define.js';
import { TemplateError } from '../template/errors.js';
import { type TemplateManifest, parseManifest } from '../template/manifest.js';
import { frame, group, image, text } from '../template/nodes.js';
import type { TemplateRegistry } from '../template/registry.js';
import { runsOf } from '../template/runs.js';
import { font, imagePaint, run, solid } from '../template/values.js';

/**
 * The acceptance criterion is a whole pipeline, so the test is one: a real manifest, a
 * brief that satisfies it, a `promo-curso` written in the SDK, and the assertion that
 * three slides in two formats come out as three artworks of two frames each that
 * `parseScene` accepts. Anything short of that would be testing `compile`'s arithmetic
 * rather than its output.
 */

const MANIFEST_SOURCE = `name: promo-curso
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text, required: true }
  imagem: { type: image }
  cor: { type: enum, values: [azul, laranja], default: azul }
  slide: { type: rich-text, repeat: true, min: 1, max: 10 }
adjustments:
  destaque: { type: flag, applies: [slide] }
  tom: { type: enum, values: [claro, escuro], applies: [slide] }
`;

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const MANIFEST = manifestOf(MANIFEST_SOURCE);

const PHOTO: AssetRef = { id: 'prof-ana', source: 'file', path: './ana.png', hash: 'sha256-1f' };

const assets: AssetResolver = {
  base: 'briefs/',
  resolve: (reference) => Promise.resolve(reference === './ana.png' ? PHOTO : undefined),
};

const registry: TemplateRegistry = {
  list: () => [MANIFEST],
  get: (name) => (name === MANIFEST.name ? MANIFEST : undefined),
  formatsOf: (name) => (name === MANIFEST.name ? MANIFEST.formats : undefined),
  directoryOf: () => 'templates/promo-curso',
  failures: [],
};

const inter = font('Inter');
const SIZES: Readonly<Record<string, { w: number; h: number }>> = {
  feed: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

/** The palette the manifest's `cor` enum names; only the template knows what a name is. */
const PALETTE: Readonly<Record<string, string>> = { azul: '#0c2340', laranja: '#ff5900' };

/**
 * `promo-curso`, written the way `docs/template-authoring.md` shows a `template.ts`.
 *
 * It is a fixture, not the shipped template — that is E4.4 — but it exercises everything
 * `compile` has to hand a template: both formats, the repeat slot resolved to this slide,
 * an adjustment, an image asset, and rich text that carries bold and a mark.
 */
const promoCurso: Template = defineTemplate(MANIFEST, (context) => {
  const size = SIZES[context.format] ?? SIZES.feed;
  const cor = context.slots.cor?.value;
  const background = solid(PALETTE[cor?.kind === 'enum' ? cor.value : 'azul'] ?? '#000000');
  const foto = context.slots.imagem?.value;
  const slide = context.slots.slide?.value;
  const titulo = context.slots.titulo?.value;

  return frame({
    format: context.format,
    size: size ?? { w: 1080, h: 1080 },
    background,
    idPrefix: context.idPrefix,
    children: [
      ...(foto?.kind === 'image'
        ? [image({ asset: foto.asset, size: { w: size?.w ?? 1080, h: 620 } })]
        : []),
      group({
        id: `${context.idPrefix}.copy`,
        transform: { y: 660 },
        children: [
          text({
            box: { w: 920 },
            runs: [
              run(`${context.artwork.index + 1}/${context.artwork.count}`, {
                font: inter,
                size: 32,
                color: '#ffffff',
              }),
            ],
          }),
          text({
            box: { w: 920 },
            lineHeight: 1.05,
            runs: runsOf(
              titulo?.kind === 'rich-text' ? titulo.text : [],
              { font: inter, size: 96, color: '#ffffff' },
              { mark: (key, value) => (key === 'cor' ? { color: PALETTE[value] ?? '#fff' } : {}) },
            ) as [ReturnType<typeof run>, ...ReturnType<typeof run>[]],
          }),
          text({
            box: { w: 920 },
            runs: runsOf(slide?.kind === 'rich-text' ? slide.text : [], {
              font: inter,
              size: context.adjustments.destaque === true ? 64 : 48,
              color: '#ffffff',
            }) as [ReturnType<typeof run>, ...ReturnType<typeof run>[]],
          }),
        ],
      }),
    ],
  });
});

function frontmatter(data: Readonly<Record<string, unknown>>): Frontmatter {
  return { data, ranges: {}, range: sourceRange(0, 40) };
}

const AT = sourceRange(0, 1);

function textOf(value: string): RichText {
  return [{ kind: 'text', value, range: AT }];
}

function directive(name: string, body: RichText, extra: Partial<Directive> = {}): Directive {
  return { name, adjustments: [], body, range: AT, ...extra };
}

const BRIEF: BriefAst = {
  frontmatter: frontmatter({ template: 'promo-curso', imagem: './ana.png', cor: 'laranja' }),
  directives: [
    directive('titulo', [
      { kind: 'text', value: 'Direito ', range: AT },
      { kind: 'bold', children: textOf('Constitucional'), range: AT },
      { kind: 'break', range: AT },
      { kind: 'mark', key: 'cor', value: 'azul', children: textOf('Turma nova'), range: AT },
    ]),
    directive('slide', textOf('O que cai na prova')),
    directive('slide', textOf('Como estudar'), {
      adjustments: [{ name: 'destaque', range: AT }],
    }),
    directive('slide', textOf('Garanta sua vaga')),
  ],
  range: sourceRange(0, 300),
};

async function resolved(ast: BriefAst = BRIEF): Promise<ResolvedBrief> {
  const result = await resolve(ast, { registry, assets });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

async function compiled(template: Template = promoCurso): Promise<Scene> {
  const result = compile(await resolved(), template);
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

function framesOf(scene: Scene): readonly Frame[] {
  return scene.artworks.flatMap((artwork) => artwork.frames);
}

describe('three slides in two formats', () => {
  it('yields three artworks of two frames each, and parseScene accepts it', async () => {
    const scene = await compiled();

    expect(scene.artworks).toHaveLength(3);
    for (const artwork of scene.artworks) expect(artwork.frames).toHaveLength(2);
    expect(framesOf(scene).map((item) => item.format)).toEqual([
      'feed',
      'story',
      'feed',
      'story',
      'feed',
      'story',
    ]);
  });

  it('names each artwork after the repeatable slot and its position', async () => {
    expect((await compiled()).artworks.map((item) => item.id)).toEqual([
      'slide-1',
      'slide-2',
      'slide-3',
    ]);
  });

  it('gives each slide its own occurrence of the repeat slot, under the slot name', async () => {
    // The third text node of each frame is the slide; the template reads `slots.slide`
    // and gets this slide rather than the list.
    const scene = await compiled();
    const slideTexts = scene.artworks.map((artwork) => {
      const copy = artwork.frames[0]?.children[1];
      const node = copy?.kind === 'group' ? copy.children[2] : undefined;
      return node?.kind === 'text' && node.runs[0]?.kind === 'text' ? node.runs[0].text : '';
    });

    expect(slideTexts).toEqual(['O que cai na prova', 'Como estudar', 'Garanta sua vaga']);
  });

  it('hands the template the adjustments of this slide only', async () => {
    // `{destaque}` is on the second slide, and only its text is the larger size.
    const scene = await compiled();
    const sizes = scene.artworks.map((artwork) => {
      const copy = artwork.frames[0]?.children[1];
      const node = copy?.kind === 'group' ? copy.children[2] : undefined;
      return node?.kind === 'text' && node.runs[0]?.kind === 'text' ? node.runs[0].size : 0;
    });

    expect(sizes).toEqual([48, 64, 48]);
  });

  it('tells the template where it is, so a slide can number itself', async () => {
    const scene = await compiled();
    const counters = scene.artworks.map((artwork) => {
      const copy = artwork.frames[0]?.children[1];
      const node = copy?.kind === 'group' ? copy.children[0] : undefined;
      return node?.kind === 'text' && node.runs[0]?.kind === 'text' ? node.runs[0].text : '';
    });

    expect(counters).toEqual(['1/3', '2/3', '3/3']);
  });
});

describe('ids stay unique across a whole scene', () => {
  it('gives every node a distinct id, across artworks and across formats', async () => {
    const scene = await compiled();
    const ids: string[] = [];
    const walkNodes = (
      nodes: readonly Scene['artworks'][number]['frames'][number]['children'][number][],
    ): void => {
      for (const node of nodes) {
        ids.push(node.id);
        if (node.kind === 'group') walkNodes(node.children);
      }
    };
    for (const item of framesOf(scene)) walkNodes(item.children);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('slide-1.feed.0');
    expect(ids).toContain('slide-1.story.0');
  });

  it('catches a template that ignores idPrefix, rather than shipping the collision', async () => {
    // The prefix has to carry the artwork *and* the format: either alone collides. A
    // template that forgets it produces `feed.0` in every artwork, and E2.1 says so.
    const forgetful = defineTemplate(MANIFEST, (context) =>
      frame({
        format: context.format,
        size: { w: 100, h: 100 },
        children: [text({ runs: [run('x', { font: inter, size: 12, color: '#fff' })] })],
      }),
    );

    const result = compile(await resolved(), forgetful);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.code).toBe('E_SCENE_DUPLICATE_ID');
  });
});

describe('what compile collects', () => {
  it('declares every font the scene reached for, once', async () => {
    expect((await compiled()).fonts).toEqual([{ family: 'Inter', source: 'bundled' }]);
  });

  it('declares the assets the scene draws, and no others', async () => {
    const scene = await compiled();
    // Six frames all draw the same photo; it is declared once.
    expect(scene.assets).toEqual([PHOTO]);
  });

  it('leaves out an asset the brief resolved and the template chose not to draw', async () => {
    const ignoresPhoto = defineTemplate(MANIFEST, (context) =>
      frame({
        format: context.format,
        size: { w: 100, h: 100 },
        idPrefix: context.idPrefix,
        children: [text({ runs: [run('x', { font: inter, size: 12, color: '#fff' })] })],
      }),
    );

    const result = compile(await resolved(), ignoresPhoto);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assets).toEqual([]);
  });

  it('finds an asset used only as a paint, not only one on an image node', async () => {
    const painted = defineTemplate(MANIFEST, (context) =>
      frame({
        format: context.format,
        size: { w: 100, h: 100 },
        background: imagePaint(PHOTO),
        idPrefix: context.idPrefix,
        children: [text({ runs: [run('x', { font: inter, size: 12, color: '#fff' })] })],
      }),
    );

    const result = compile(await resolved(), painted);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assets).toEqual([PHOTO]);
  });
});

describe('a template that throws (ADR 0014)', () => {
  it('turns an unexpected exception into E_TEMPLATE_CRASH, never a throw', async () => {
    const broken = defineTemplate(MANIFEST, () => {
      throw new Error('cannot read properties of undefined');
    });

    const result = compile(await resolved(), broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.code).toBe('E_TEMPLATE_CRASH');
      expect(result.error[0]?.message).toContain('promo-curso');
      expect(result.error[0]?.message).toContain('cannot read properties of undefined');
    }
  });

  it('surfaces the diagnostic a TemplateError already carries, rather than wrapping it', async () => {
    // `color('#gggggg')` throws one of these; the message it built is better than
    // anything compile could invent from the outside.
    const badColour = defineTemplate(MANIFEST, () => {
      throw new TemplateError('color', "'#gggggg' is not a hex colour");
    });

    const result = compile(await resolved(), badColour);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.code).toBe('E_TEMPLATE_VALUE');
  });

  it('refuses a template that returns a frame for a format it was not asked for', async () => {
    const confused = defineTemplate(MANIFEST, () =>
      frame({
        format: 'feed',
        size: { w: 100, h: 100 },
        children: [text({ runs: [run('x', { font: inter, size: 12, color: '#fff' })] })],
      }),
    );

    const result = compile(await resolved(), confused);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.code).toBe('E_TEMPLATE_CRASH');
      expect(result.error[0]?.message).toContain("asked for format 'story' and returned 'feed'");
    }
  });
});

describe('a manifest with nothing repeatable', () => {
  it('still produces one artwork', async () => {
    const single = manifestOf(`name: cartao
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text, required: true }
`);
    const singleRegistry: TemplateRegistry = {
      list: () => [single],
      get: () => single,
      formatsOf: () => single.formats,
      directoryOf: () => 'templates/cartao',
      failures: [],
    };
    const ast: BriefAst = {
      frontmatter: frontmatter({ template: 'cartao' }),
      directives: [directive('titulo', textOf('Só um'))],
      range: sourceRange(0, 40),
    };
    const result = await resolve(ast, { registry: singleRegistry, assets });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const scene = compile(
      result.value,
      defineTemplate(single, (context) =>
        frame({
          format: context.format,
          size: { w: 100, h: 100 },
          idPrefix: context.idPrefix,
          children: [text({ runs: [run('x', { font: inter, size: 12, color: '#fff' })] })],
        }),
      ),
    );

    expect(scene.ok).toBe(true);
    if (scene.ok) {
      expect(scene.value.artworks).toHaveLength(1);
      expect(scene.value.artworks[0]?.id).toBe('artwork-1');
    }
  });
});
