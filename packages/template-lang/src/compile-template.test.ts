import {
  type AssetResolver,
  type AssetRef,
  type BriefAst,
  type Diagnostic,
  type Directive,
  type Frontmatter,
  type RichText,
  type Scene,
  type Template,
  type TemplateManifest,
  type TemplateRegistry,
  compile,
  formatCatalogue,
  lineColumnAt,
  parseManifest,
  resolve,
  sourceRange,
} from '@tyto/core';
import {
  defineTemplate,
  font,
  frame,
  group,
  image,
  type run,
  runsOf,
  solid,
  text,
} from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import promoCursoMarkup from './__fixtures__/promo-curso.html?raw';
import { compileTemplate } from './compile-template.js';

/**
 * The acceptance criterion is one comparison, so the first block is one test: `promo-curso`
 * written in markup and `promo-curso` written with the SDK produce the same `Scene`, for
 * three slides in two formats, through the real `resolve` and the real `compile`.
 *
 * The one thing the markup twin leaves out is the `2/3` counter the E4.2 fixture draws.
 * Numbering a slide is arithmetic on `context.artwork`, and the markup path draws slots —
 * `docs/template-authoring.md` already sends computation to `template.ts`, and TYTO-24 did
 * not invent a spelling for it. The TS twin below therefore omits it too, and the omission
 * is the difference between the two fixtures rather than a difference in their output.
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

const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } });

const PALETTE: Readonly<Record<string, string>> = { azul: '#0c2340', laranja: '#ff5900' };

const inter = font('Inter');

/** `promo-curso` as a `template.ts`, node for node with the markup fixture. */
const promoCursoInCode: Template = defineTemplate(MANIFEST, (context) => {
  const cor = context.slots.cor?.value;
  const foto = context.slots.imagem?.value;
  const slide = context.slots.slide?.value;
  const titulo = context.slots.titulo?.value;

  return frame({
    format: context.format,
    size: context.size,
    background: solid(PALETTE[cor?.kind === 'enum' ? cor.value : 'azul'] ?? '#000000'),
    idPrefix: context.idPrefix,
    children: [
      ...(foto?.kind === 'image'
        ? [image({ asset: foto.asset, size: { w: context.size.w, h: 620 } })]
        : []),
      group({
        id: `${context.idPrefix}.copy`,
        transform: { y: 660 },
        children: [
          text({
            box: { w: 920 },
            lineHeight: 1.05,
            runs: runsOf(
              titulo?.kind === 'rich-text' ? titulo.text : [],
              { font: inter, size: 96, weight: 400, color: '#ffffff' },
              { mark: (key, value) => (key === 'cor' ? { color: PALETTE[value] ?? '#fff' } : {}) },
            ) as [ReturnType<typeof run>, ...ReturnType<typeof run>[]],
          }),
          text({
            box: { w: 920 },
            lineHeight: 1.2,
            runs: runsOf(slide?.kind === 'rich-text' ? slide.text : [], {
              font: inter,
              size: context.adjustments.destaque === true ? 64 : 48,
              weight: 400,
              color: '#ffffff',
            }) as [ReturnType<typeof run>, ...ReturnType<typeof run>[]],
          }),
        ],
      }),
    ],
  });
});

const AT = sourceRange(0, 1);

function frontmatter(data: Readonly<Record<string, unknown>>): Frontmatter {
  return { data, ranges: {}, range: sourceRange(0, 40) };
}

function textOf(value: string): RichText {
  return [{ kind: 'text', value, range: AT }];
}

function directive(name: string, body: RichText, extra: Partial<Directive> = {}): Directive {
  return { name, adjustments: [], body, range: AT, nameRange: AT, ...extra };
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
    directive('slide', textOf('Como estudar'), { adjustments: [{ name: 'destaque', range: AT }] }),
    directive('slide', textOf('Garanta sua vaga')),
  ],
  range: sourceRange(0, 300),
};

async function sceneOf(template: Template, ast: BriefAst = BRIEF): Promise<Scene> {
  const resolved = await resolve(ast, { registry, assets });
  if (!resolved.ok) throw new Error(resolved.error.map((item) => item.message).join('; '));
  const built = compile(resolved.value, template, { formats: FORMATS });
  if (!built.ok) throw new Error(built.error.map((item) => item.message).join('; '));
  return built.value;
}

function compiledOrThrow(source: string, manifest: TemplateManifest = MANIFEST): Template {
  const result = compileTemplate(source, { manifest });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

function problemsOf(source: string, manifest: TemplateManifest = MANIFEST): readonly Diagnostic[] {
  const result = compileTemplate(source, { manifest });
  return result.ok ? [] : result.error;
}

describe('promo-curso in markup and promo-curso in TypeScript', () => {
  it('produce the same Scene, three slides in two formats', async () => {
    const fromMarkup = await sceneOf(compiledOrThrow(promoCursoMarkup));
    const fromCode = await sceneOf(promoCursoInCode);

    expect(fromMarkup).toEqual(fromCode);
  });

  it('produce a scene with the artworks, frames and ids compile promises', async () => {
    const scene = await sceneOf(compiledOrThrow(promoCursoMarkup));

    expect(scene.artworks.map((artwork) => artwork.id)).toEqual(['slide-1', 'slide-2', 'slide-3']);
    expect(scene.artworks[0]?.frames.map((item) => item.format)).toEqual(['feed', 'story']);
    expect(scene.artworks[0]?.frames[0]?.children[1]?.id).toBe('slide-1.feed.copy');
  });

  it('reads the enum through a variable the @if block overrode', async () => {
    // `cor: laranja` in the frontmatter turns on `@if slot(cor) is laranja`, whose :root
    // sets --bg; `bg="var(--bg)"` is what the frame paints.
    const scene = await sceneOf(compiledOrThrow(promoCursoMarkup));
    expect(scene.artworks[0]?.frames[0]?.background).toEqual(solid('#ff5900'));
  });

  it('gives a mark the run style of the class that spells it out', async () => {
    const scene = await sceneOf(compiledOrThrow(promoCursoMarkup));
    const copy = scene.artworks[0]?.frames[0]?.children[1];
    const title = copy?.kind === 'group' ? copy.children[0] : undefined;
    const marked = title?.kind === 'text' ? title.runs.at(-1) : undefined;

    expect(marked?.kind === 'text' ? marked.color : undefined).toEqual(solid('#0c2340'));
  });

  it('applies an adjustment class only to the slide that carries it', async () => {
    const scene = await sceneOf(compiledOrThrow(promoCursoMarkup));
    const sizes = scene.artworks.map((artwork) => {
      const copy = artwork.frames[0]?.children[1];
      const node = copy?.kind === 'group' ? copy.children[1] : undefined;
      return node?.kind === 'text' && node.runs[0]?.kind === 'text' ? node.runs[0].size : 0;
    });

    expect(sizes).toEqual([48, 64, 48]);
  });

  it('reports every slot the template reads, which is what W_UNUSED_SLOT needs', async () => {
    const template = compileTemplate(promoCursoMarkup, { manifest: MANIFEST });
    expect(template.ok).toBe(true);
    if (!template.ok) return;

    // `cor` is in the list without being drawn anywhere: the stylesheet branches on it —
    // `@if slot(cor) is laranja { :root { --bg: #ff5900 } }` — and that branch is what
    // decides the background. Until TYTO-63 it was missing, and this brief was told to
    // delete the line that colours the artwork.
    expect([...template.value.renderedSlots].sort()).toEqual(['cor', 'imagem', 'slide', 'titulo']);

    const resolved = await resolve(BRIEF, {
      registry,
      assets,
      renderedSlots: template.value.renderedSlots,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.warnings.map((item) => item.code)).toEqual([]);
  });
});

/* ----------------------------------------------------- which slots count as read -- */

const READS = manifestOf(`name: leitura
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text }
  imagem: { type: image }
  cor: { type: enum, values: [azul, laranja], default: azul }
  fundo: { type: enum, values: [claro, escuro], default: claro }
  slide: { type: rich-text, repeat: true, min: 1, max: 10 }
`);

/** A template that draws nothing but one text, so a case adds exactly one reference. */
function readsIn(body: string, markup = ''): readonly string[] {
  const source =
    `<frame format="feed"><text slot="titulo" class="t" />${markup}</frame>` +
    `<frame format="story" extends="feed" />` +
    `<style>.t { w: 100; font: 400 32px "Inter"; color: white } .i { w: 100; h: 100 } ${body}</style>`;
  const compiled = compileTemplate(source, { manifest: READS });
  if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
  return [...compiled.value.renderedSlots].sort();
}

const readsRegistry: TemplateRegistry = {
  list: () => [READS],
  get: (name) => (name === READS.name ? READS : undefined),
  formatsOf: (name) => (name === READS.name ? READS.formats : undefined),
  directoryOf: () => 'templates/leitura',
  failures: [],
};

describe('the sources a slot reference can come from', () => {
  it('the slot attribute on a drawable', () => {
    expect(readsIn('', '<image slot="imagem" class="i" />')).toEqual(['imagem', 'titulo']);
  });

  it('a slot spliced into a src', () => {
    // `docs/template-authoring.md`: `src="assets/{cor}.png"` splices an enum's word into a
    // path, so the file that gets drawn depends on what the brief set.
    expect(readsIn('', '<image src="assets/{cor}.png" class="i" />')).toEqual(['cor', 'titulo']);
  });

  it('a stylesheet condition on an enum — the case TYTO-63 was written for', () => {
    expect(readsIn('@if slot(cor) is laranja { :root { --bg: #ff5900 } }')).toEqual([
      'cor',
      'titulo',
    ]);
  });

  it('a stylesheet condition on emptiness', () => {
    // Never drawn, and still decides the layout: an author who sets `imagem` moved the
    // title, which is exactly what "this brief used the slot" means.
    expect(readsIn('@if slot(imagem) is empty { .t { w: 400 } }')).toEqual(['imagem', 'titulo']);
  });

  it('an @each scope, which names the repeatable slot', () => {
    expect(readsIn('@each slide { .t { w: 400 } }')).toEqual(['slide', 'titulo']);
  });

  it('the seeded variable a slot becomes', () => {
    // `--slot-cor` holds the word the brief wrote. A template whose enum lists CSS colour
    // names can use it directly, and then the brief picked the colour.
    expect(readsIn(':root { --bg: var(--slot-cor) }')).toEqual(['cor', 'titulo']);
  });

  it('that variable however deeply a call nests it', () => {
    expect(readsIn(':root { --bg: linear-gradient(180deg, var(--slot-cor) 0, #000 1) }')).toEqual([
      'cor',
      'titulo',
    ]);
  });

  it('and a fallback inside another var()', () => {
    expect(readsIn(':root { --bg: var(--nope, var(--slot-fundo)) }')).toEqual(['fundo', 'titulo']);
  });

  it('collects each source once, and every source at once', () => {
    const reads = readsIn(
      '@if slot(cor) is laranja { :root { --bg: #ff5900 } } ' +
        '@if slot(imagem) is empty { .t { w: 400 } } ' +
        '@each slide { .t { h: 40 } } ' +
        ':root { --fg: var(--slot-fundo) }',
      '<image slot="imagem" class="i" />',
    );

    expect(reads).toEqual(['cor', 'fundo', 'imagem', 'slide', 'titulo']);
  });
});

describe('what the warning still has to catch', () => {
  it('a slot the template mentions nowhere is still unused', async () => {
    // The half a fix like this can quietly trade away. `fundo` is declared, set by the
    // brief below, and appears in no attribute, no src and no condition — so it must still
    // warn, or the false positive was traded for silence.
    const compiled = compileTemplate(
      '<frame format="feed"><text slot="titulo" class="t" /></frame>' +
        '<frame format="story" extends="feed" />' +
        '<style>.t { w: 100; font: 400 32px "Inter"; color: white }' +
        ' @if slot(cor) is laranja { .t { w: 200 } }</style>',
      { manifest: READS },
    );
    if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
    expect([...compiled.value.renderedSlots].sort()).toEqual(['cor', 'titulo']);

    const resolved = await resolve(
      {
        frontmatter: frontmatter({ template: 'leitura', cor: 'laranja', fundo: 'escuro' }),
        directives: [directive('titulo', textOf('Oi')), directive('slide', textOf('Um'))],
        range: sourceRange(0, 300),
      },
      { registry: readsRegistry, assets, renderedSlots: compiled.value.renderedSlots },
    );

    if (!resolved.ok) throw new Error(resolved.error.map((item) => item.message).join('; '));
    expect(resolved.warnings.map((item) => item.code)).toEqual(['W_UNUSED_SLOT']);
    expect(resolved.warnings[0]?.message).toContain("Slot 'fundo'");
  });

  it('an empty conditional block reads nothing, because it changes nothing', () => {
    // Deliberate. The set is read from what reaches the cascade, and a block with no
    // declarations reaches none of it — so the slot in its prelude really is used by
    // nothing, and saying otherwise would silence a warning that is correct.
    expect(readsIn('@if slot(cor) is laranja { }')).toEqual(['titulo']);
  });

  it('a custom property that merely starts with --slot- is not a slot reference', () => {
    expect(readsIn(':root { --slot-machine: #fff; --bg: var(--slot-machine) }')).toEqual([
      'titulo',
    ]);
  });
});

const MINIMAL = manifestOf(`name: cartao
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
`);

function sheet(body: string, markup = '<text slot="titulo" class="t" />'): string {
  return `<frame format="feed">${markup}</frame><style>${body}</style>`;
}

const BASE = '.t { w: 100; font: 400 32px "Inter"; color: white }';

describe('what the language refuses, and where', () => {
  it('names an unsupported tag and suggests the one it means', () => {
    const source = sheet(BASE, '<div class="t" />');
    const [problem] = problemsOf(source, MINIMAL);

    expect(problem?.code).toBe('E_UNSUPPORTED_TAG');
    expect(problem?.message).toBe("Tag '<div>' is not part of the template language. Try 'group'.");
    expect(lineColumnAt(source, problem?.range?.start ?? 0)).toEqual({ line: 1, column: 23 });
  });

  it('names an unsupported attribute against the tag it sits on', () => {
    const [problem] = problemsOf(sheet(BASE, '<text slot="titulo" class="t" href="x" />'), MINIMAL);

    expect(problem?.code).toBe('E_UNSUPPORTED_ATTRIBUTE');
    expect(problem?.message).toBe("Attribute 'href' is not accepted on '<text>'. Try 'src'.");
  });

  it('names an unsupported CSS property and suggests the one it means', () => {
    const source = sheet(`${BASE} .t { width: 100 }`);
    const [problem] = problemsOf(source, MINIMAL);

    expect(problem?.code).toBe('E_UNSUPPORTED_CSS');
    expect(problem?.message).toBe(
      "CSS property 'width' is not supported by the template language. Try 'w'.",
    );
  });

  it('gives an unsupported property a line and a column, not only an offset', () => {
    const source = `<frame format="feed">
  <text slot="titulo" class="t" />
</frame>
<style>
  .t { w: 100; font: 400 32px "Inter"; color: white }
  .t { z-index: 3 }
</style>`;
    const [problem] = problemsOf(source, MINIMAL);

    expect(problem?.code).toBe('E_UNSUPPORTED_CSS');
    expect(lineColumnAt(source, problem?.range?.start ?? 0)).toEqual({ line: 6, column: 8 });
  });

  it('reports the syntax it could not read rather than guessing at meaning', () => {
    const [problem] = problemsOf('<frame format="feed">hello</frame>', MINIMAL);
    expect(problem?.code).toBe('E_SYNTAX');
  });

  it('catches a closing tag that names a different element', () => {
    const [problem] = problemsOf('<frame format="feed"><group class="t"></frame></group>', MINIMAL);
    expect(problem?.code).toBe('E_SYNTAX');
    expect(problem?.message).toContain('<group> is closed by </frame>');
  });

  it('refuses a slot the manifest does not declare', () => {
    const [problem] = problemsOf(sheet(BASE, '<text slot="titluo" class="t" />'), MINIMAL);
    expect(problem?.code).toBe('E_TEMPLATE_MARKUP');
    expect(problem?.message).toContain("slot 'titluo' is not declared");
  });

  it('refuses a text drawing a slot that is not rich text', () => {
    const manifest = manifestOf(`name: cartao
version: 1.0.0
formats: [feed]
slots:
  foto: { type: image }
`);
    const [problem] = problemsOf(
      sheet('.t { w: 10; font: 400 12px "Inter"; color: white }', '<text slot="foto" class="t" />'),
      manifest,
    );
    expect(problem?.message).toContain('<text> draws a rich-text slot');
  });

  it('refuses a format no frame declares', () => {
    const manifest = manifestOf(`name: cartao
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text }
`);
    const messages = problemsOf(sheet(BASE), manifest).map((item) => item.message);
    expect(
      messages.some((message) => message.includes("format 'story' and no frame declares it")),
    ).toBe(true);
  });

  it('refuses an extends that runs in a circle', () => {
    const manifest = manifestOf(`name: cartao
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text }
`);
    const source = `<frame format="feed" extends="story" /><frame format="story" extends="feed" /><style>${BASE}</style>`;
    const messages = problemsOf(source, manifest).map((item) => item.message);
    expect(messages.some((message) => message.includes('runs in a circle'))).toBe(true);
  });

  it('refuses a custom property outside :root', () => {
    const [problem] = problemsOf(sheet(`${BASE} .t { --brand: #fff }`), MINIMAL);
    expect(problem?.message).toContain("custom property '--brand' is only read inside ':root'");
  });

  it('refuses an at-rule the language does not have', () => {
    const [problem] = problemsOf(sheet(`${BASE} @media print { .t { w: 10 } }`), MINIMAL);
    expect(problem?.message).toContain("'@media' is not an at-rule");
  });

  it('refuses @each naming anything but the repeatable slot', () => {
    const [problem] = problemsOf(sheet(`${BASE} @each titulo { .t { w: 10 } }`), MINIMAL);
    expect(problem?.message).toContain('the manifest declares no repeatable slot');
  });

  it('refuses a text no font declaration reaches, before any brief exists', () => {
    const [problem] = problemsOf(sheet('.t { w: 100; color: white }'), MINIMAL);
    expect(problem?.message).toContain('reached by no font declaration');
  });

  it('refuses a value the property cannot read, with the range of the value', () => {
    const source = sheet(`${BASE} .t { w: 10em }`);
    const [problem] = problemsOf(source, MINIMAL);
    expect(problem?.code).toBe('E_TEMPLATE_VALUE');
    expect(problem?.message).toContain('units are px, %, vw and vh');
    expect(source.slice(problem?.range?.start ?? 0, problem?.range?.end ?? 0)).toBe('10em');
  });
});

/** One artwork, one format: enough to read a property's effect off the IR. */
async function frameOf(styles: string, markup: string, manifest = MINIMAL) {
  const template = compiledOrThrow(
    `<frame format="feed">${markup}</frame><style>${styles}</style>`,
    manifest,
  );
  const ast: BriefAst = {
    frontmatter: frontmatter({ template: manifest.name }),
    directives: [directive('titulo', textOf('Oi'))],
    range: sourceRange(0, 40),
  };
  const singles: TemplateRegistry = {
    list: () => [manifest],
    get: () => manifest,
    formatsOf: () => manifest.formats,
    directoryOf: () => 'templates/cartao',
    failures: [],
  };
  const resolved = await resolve(ast, { registry: singles, assets });
  if (!resolved.ok) throw new Error(resolved.error.map((item) => item.message).join('; '));
  const built = compile(resolved.value, template, {
    formats: formatCatalogue({ feed: { w: 1000, h: 500 } }),
  });
  if (!built.ok) throw new Error(built.error.map((item) => item.message).join('; '));
  return built.value.artworks[0]?.frames[0];
}

async function nodeOf(styles: string, markup: string, manifest = MINIMAL) {
  return (await frameOf(styles, markup, manifest))?.children[0];
}

describe('the CSS subset, read off the IR', () => {
  it('resolves % against the parent box and vw/vh against the frame', async () => {
    const node = await nodeOf(
      '.g { w: 50%; h: 100% } .r { w: 50%; h: 10vh }',
      '<group class="g"><rect class="r" /></group>',
    );
    const child = node?.kind === 'group' ? node.children[0] : undefined;

    // The group is 500×500 of a 1000×500 frame; the rect is half of that width and a
    // tenth of the frame's height, not of the group's.
    expect(child?.kind === 'rect' ? child.size : undefined).toEqual({ w: 250, h: 50 });
  });

  it('reads a gradient, a radius and a stroke', async () => {
    const node = await nodeOf(
      '.r { w: 10; h: 10; radius: 8 8 0 0; stroke: 2px #ffffff inside; fill: linear-gradient(180deg, #000000 0, #ffffff 1) }',
      '<rect class="r" />',
    );

    expect(node?.kind === 'rect' ? node.radius : undefined).toEqual([8, 8, 0, 0]);
    expect(node?.kind === 'rect' ? node.stroke?.align : undefined).toBe('inside');
    expect(node?.kind === 'rect' ? node.fill?.kind : undefined).toBe('linear-gradient');
  });

  it('reads a shadow and a blur into the effect list', async () => {
    const node = await nodeOf(
      '.r { w: 10; h: 10; shadow: 0 4 12 #00000088; blur: 3 }',
      '<rect class="r" />',
    );

    expect(node?.effects).toEqual([
      { kind: 'shadow', x: 0, y: 4, blur: 12, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.533 } },
      { kind: 'blur', radius: 3 },
    ]);
  });

  it('lets the stylesheet override an attribute of the same name', async () => {
    const node = await nodeOf(
      '.r { w: 10; h: 10; opacity: 0.25 }',
      '<rect class="r" opacity="0.9" />',
    );
    expect(node?.opacity).toBe(0.25);
  });

  it('namespaces an explicit id, and the mask that points at it, with the id prefix', async () => {
    // The mask names a sibling, not a child: `E_SCENE_MASK_DESCENDANT` forbids masking a
    // node by one of its own descendants, which the example in the doc used to do.
    const built = await frameOf(
      '.g { w: 10; h: 10 } .r { w: 10; h: 10 }',
      '<rect id="grad" class="r" /><group class="g" mask="#grad"><rect class="r" /></group>',
    );

    expect(built?.children[0]?.id).toBe('artwork-1.feed.grad');
    expect(built?.children[1]?.mask).toEqual({ nodeId: 'artwork-1.feed.grad', mode: 'alpha' });
  });

  it('applies a later declaration over an earlier one, with no specificity involved', async () => {
    const node = await nodeOf('#r { w: 10; h: 10 } .r { w: 40 }', '<rect id="r" class="r" />');
    expect(node?.kind === 'rect' ? node.size.w : undefined).toBe(40);
  });
});

describe('the conditional blocks', () => {
  const SLIDES = manifestOf(`name: carrossel
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text }
  slide: { type: rich-text, repeat: true }
`);

  const slidesRegistry: TemplateRegistry = {
    list: () => [SLIDES],
    get: () => SLIDES,
    formatsOf: () => SLIDES.formats,
    directoryOf: () => 'templates/carrossel',
    failures: [],
  };

  const MARKUP = `<frame format="feed"><text slot="slide" class="s" /></frame>
<frame format="story" extends="feed" />
<style>
  .s { w: 100; y: 10; font: 400 20px "Inter"; color: white }
  @if slot(titulo) is empty { .s { y: 20 } }
  @format story { .s { y: 900 } }
  @each slide { .s { overflow: shrink } }
</style>`;

  async function scene(markup: string, directives: readonly Directive[]): Promise<Scene> {
    const template = compiledOrThrow(markup, SLIDES);
    const ast: BriefAst = {
      frontmatter: frontmatter({ template: 'carrossel' }),
      directives: [...directives],
      range: sourceRange(0, 40),
    };
    const resolved = await resolve(ast, { registry: slidesRegistry, assets });
    if (!resolved.ok) throw new Error(resolved.error.map((item) => item.message).join('; '));
    const built = compile(resolved.value, template, { formats: FORMATS });
    if (!built.ok) throw new Error(built.error.map((item) => item.message).join('; '));
    return built.value;
  }

  // Source order and nothing else: the @format block is written last, so it wins over the
  // @if above it in the format it names. Swapping the two swaps the answer, which is the
  // whole rule.
  it('lets @format override the base rules, one format at a time', async () => {
    const built = await scene(MARKUP, [directive('slide', textOf('Um'))]);
    const ys = built.artworks[0]?.frames.map((item) => item.children[0]?.transform.y);

    expect(ys).toEqual([20, 900]);
  });

  it('turns @if slot(x) is empty on only while the brief leaves x unset', async () => {
    const withTitle = await scene(MARKUP, [
      directive('titulo', textOf('Oi')),
      directive('slide', textOf('Um')),
    ]);

    expect(withTitle.artworks[0]?.frames[0]?.children[0]?.transform.y).toBe(10);
  });

  it('applies @each while the artwork comes from the repeatable slot', async () => {
    const built = await scene(MARKUP, [directive('slide', textOf('Um'))]);
    const node = built.artworks[0]?.frames[0]?.children[0];

    expect(node?.kind === 'text' ? node.overflow : undefined).toBe('shrink');
  });

  it('leaves @each off for the single artwork a brief with no occurrence produces', async () => {
    // No `::slide` at all: `compile` still makes one artwork, and it came from no slide.
    const built = await scene(
      `<frame format="feed"><text slot="titulo" class="s" /></frame>
<frame format="story" extends="feed" />
<style>
  .s { w: 100; font: 400 20px "Inter"; color: white }
  @each slide { .s { overflow: shrink } }
</style>`,
      [directive('titulo', textOf('Oi'))],
    );
    const node = built.artworks[0]?.frames[0]?.children[0];

    expect(node?.kind === 'text' ? node.overflow : undefined).toBe('clip');
  });
});

describe('slots the brief did not fill, and files beside the template', () => {
  it('leaves a node out rather than drawing it empty', async () => {
    const manifest = manifestOf(`name: cartao
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  rodape: { type: rich-text }
`);
    const built = await frameOf(
      '.t { w: 100; font: 400 20px "Inter"; color: white }',
      '<text slot="titulo" class="t" /><text slot="rodape" class="t" />',
      manifest,
    );

    expect(built?.children).toHaveLength(1);
  });

  it('draws a vector from the SVG the loader handed in', () => {
    const manifest = manifestOf(`name: cartao
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
`);
    const result = compileTemplate(
      '<frame format="feed"><vector src="assets/logo.svg" class="v" /></frame>' +
        '<style>.v { w: 200; h: 60 }</style>',
      {
        manifest,
        assets: { svg: (path) => (path === 'assets/logo.svg' ? '<path d="M0 0" />' : undefined) },
      },
    );

    expect(result.ok).toBe(true);
  });

  it('says which SVG is missing, before any brief is written', () => {
    const manifest = manifestOf(`name: cartao
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
`);
    const result = compileTemplate(
      '<frame format="feed"><vector src="assets/logo.svg" class="v" /></frame>' +
        '<style>.v { w: 200; h: 60 }</style>',
      { manifest },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.message).toContain("no SVG file at 'assets/logo.svg'");
  });
});
