import {
  type AssetResolver,
  type Diagnostic,
  type PlacedSlot,
  type ResolvedBrief,
  type ResolvedSlot,
  type Scene,
  type TemplateManifest,
  type TemplateRegistry,
  compile,
  formatCatalogue,
  isOk,
  parseManifest,
  resolve,
} from '@tyto/core';
import { defineTemplate, frame, rect } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { parseBrief } from './parse-brief.js';

/**
 * TYTO-823 (ADR 0225): what is written outside a `::lamina` is the same on every artwork, and
 * what is written inside one is that slide's. A slot declared `per: lamina, shared: true` is
 * shared before the first slide and after `::comum`, and a slide's own anywhere else, where it
 * replaces the shared one for that slide alone. Real briefs, parsed, resolved and compiled.
 *
 * The template is a test template written here (ADR 0151): it draws one rectangle naming each
 * block of `context.order` and one with the `nota` it read, so the Scene spells both out.
 */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const COMPARTILHADO = manifestOf(`name: compartilhado
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  rodape: { type: rich-text }
  lamina: { type: rich-text, repeat: true, min: 1 }
  nota: { type: rich-text, per: lamina, shared: true }
  extra: { type: rich-text, per: lamina }
adjustments:
  destaque: { type: flag, applies: [lamina] }
`);

const OBRIGATORIO = manifestOf(`name: obrigatorio
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true, min: 1 }
  nota: { type: rich-text, per: lamina, shared: true, required: true }
`);

const SOLTO = manifestOf(`name: solto
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
`);

const MANIFESTS = [COMPARTILHADO, OBRIGATORIO, SOLTO];

const registry: TemplateRegistry = {
  list: () => MANIFESTS,
  get: (name) => MANIFESTS.find((manifest) => manifest.name === name),
  formatsOf: (name) => MANIFESTS.find((manifest) => manifest.name === name)?.formats,
  directoryOf: (name) => `templates/${name}`,
  failures: [],
};

const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };

function plain(slot: ResolvedSlot | undefined): string {
  if (slot?.value.kind !== 'rich-text') return '(none)';
  return slot.value.text.map((inline) => (inline.kind === 'text' ? inline.value : '')).join('');
}

const placed = (order: readonly PlacedSlot[] | undefined): string =>
  order === undefined ? '(no order)' : order.map((item) => `${item.name}/${item.place}`).join(' ');

const template = defineTemplate(COMPARTILHADO, (context) =>
  frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children: [
      rect({ name: `order: ${placed(context.order)}`, size: { w: 10, h: 10 } }),
      rect({ name: `nota: ${plain(context.slots.nota)}`, size: { w: 10, h: 10 } }),
    ],
  }),
);

const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 } });

function briefOf(name: string, body: string, frontmatter = ''): string {
  return `---\ntemplate: ${name}\n${frontmatter}---\n${body}`;
}

async function resolved(text: string): Promise<{
  readonly value: ResolvedBrief;
  readonly problems: readonly Diagnostic[];
}> {
  const parsed = parseBrief(text);
  if (!isOk(parsed)) throw new Error(parsed.error.map((item) => item.message).join('; '));
  expect(parsed.diagnostics).toEqual([]);
  const result = await resolve(parsed.value, { registry, assets });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { value: result.value, problems: result.diagnostics };
}

/** Each artwork's two rectangles: its order and the `nota` it read. */
async function drawn(body: string, frontmatter = ''): Promise<string[][]> {
  const { value, problems } = await resolved(briefOf('compartilhado', body, frontmatter));
  expect(problems).toEqual([]);
  const scene: ReturnType<typeof compile> = compile(value, template, { formats: FORMATS });
  if (!scene.ok) throw new Error(scene.error.map((item) => item.message).join('; '));
  return names(scene.value);
}

const names = (scene: Scene): string[][] =>
  scene.artworks.map((artwork) =>
    (artwork.frames[0]?.children ?? []).map((node) => node.name ?? node.id),
  );

/** The diagnostics of `body`, as `code: the text under its range`. */
async function problemsOf(body: string, name = 'compartilhado'): Promise<string[]> {
  const text = briefOf(name, body);
  const { problems } = await resolved(text);
  return problems.map(
    (problem) =>
      `${problem.code}: ${problem.range === undefined ? '' : text.slice(problem.range.start, problem.range.end)}`,
  );
}

describe('a slot that is shared or a slide’s own', () => {
  it('written before the first slide, is every slide’s, placed before', async () => {
    expect(await drawn('::nota Comum a todas\n::lamina Um\n::lamina Dois\n')).toEqual([
      ['order: nota/before', 'nota: Comum a todas'],
      ['order: nota/before', 'nota: Comum a todas'],
    ]);
  });

  it('written in the frontmatter, is every slide’s too', async () => {
    expect(await drawn('::lamina Um\n::lamina Dois\n', 'nota: Do topo\n')).toEqual([
      ['order: nota/before', 'nota: Do topo'],
      ['order: nota/before', 'nota: Do topo'],
    ]);
  });

  it('written after the first slide only, is that slide’s alone', async () => {
    expect(await drawn('::lamina Um\n::nota Só da um\n::lamina Dois\n')).toEqual([
      ['order: nota/own', 'nota: Só da um'],
      ['order: ', 'nota: (none)'],
    ]);
  });

  it('written after the last slide, is still that slide’s own', async () => {
    expect(await drawn('::lamina Um\n::lamina Dois\n::nota Da dois\n')).toEqual([
      ['order: ', 'nota: (none)'],
      ['order: nota/own', 'nota: Da dois'],
    ]);
  });

  it('written after ::comum, is every slide’s, placed after their own', async () => {
    expect(
      await drawn('::lamina Um\n::extra E1\n::lamina Dois\n::comum\n::nota Embaixo\n'),
    ).toEqual([
      ['order: extra/own nota/after', 'nota: Embaixo'],
      ['order: nota/after', 'nota: Embaixo'],
    ]);
  });

  // ADR 0227: a slide's own block adds to the shared one; `slots.nota` still reads the own one.
  it('written shared and inside slide 2, gives slide 2 both and slide 1 the shared', async () => {
    expect(await drawn('::nota Comum\n::lamina Um\n::lamina Dois\n::nota Própria\n')).toEqual([
      ['order: nota/before', 'nota: Comum'],
      ['order: nota/before nota/own', 'nota: Própria'],
    ]);
  });

  it('keeps the shared one in the ResolvedBrief and the slide’s own on its artwork', async () => {
    const { value } = await resolved(
      briefOf('compartilhado', '::nota Comum\n::lamina Um\n::lamina Dois\n::nota Própria\n'),
    );

    expect(plain(value.slots.nota)).toBe('Comum');
    expect(value.artworks.map((artwork) => plain(artwork.slots.nota))).toEqual([
      '(none)',
      'Própria',
    ]);
  });
});

describe('the order a template reads', () => {
  it('is shared-before by position, the slide’s own by position, then shared-after', async () => {
    expect(
      await drawn(
        '::titulo Título\n::lamina Um\n::extra E1\n::nota N1\n::rodape Rodapé\n' +
          '::lamina Dois\n::comum\n::nota Embaixo\n',
      ),
    ).toEqual([
      // The slide's own `nota` adds to the shared one written after `::comum` (ADR 0227).
      ['order: titulo/before extra/own nota/own rodape/after nota/after', 'nota: N1'],
      ['order: titulo/before rodape/after nota/after', 'nota: Embaixo'],
    ]);
  });

  it('lists a template without a repeatable slot’s slots as before', async () => {
    const { value } = await resolved(briefOf('solto', '::titulo Só\n'));
    const seen: (readonly PlacedSlot[] | undefined)[] = [];
    const solto = defineTemplate(SOLTO, (context) => {
      seen.push(context.order);
      return frame({ format: context.format, size: context.size, idPrefix: context.idPrefix });
    });
    compile(value, solto, { formats: FORMATS });

    expect(seen.map((order) => order?.map(({ name, place }) => ({ name, place })))).toEqual([
      [{ name: 'titulo', place: 'before' }],
    ]);
    // ADR 0227: each entry carries the value drawn there.
    expect(seen[0]?.[0]?.slot).toBe(value.slots.titulo);
  });
});

describe('what ::comum refuses', () => {
  it('a slide’s own slot after it, at that line', async () => {
    const problems = await problemsOf('::lamina Um\n::comum\n::extra Tarde\n');

    expect(problems).toEqual(['E_BAD_SLOT_VALUE: ::extra Tarde']);
  });

  it('a new slide after it, at that line, saying ::comum closes the slides', async () => {
    const text = briefOf('compartilhado', '::lamina Um\n::comum\n::lamina Dois\n');
    const { value, problems } = await resolved(text);

    expect(problems.map((problem) => problem.code)).toEqual(['E_BAD_SLOT_VALUE']);
    expect(problems[0]?.message).toContain("'::comum', which closes the slides");
    expect(value.artworks).toHaveLength(1);
  });

  it('being written twice, a shared slot set before and after it', async () => {
    expect(
      await problemsOf('::nota Antes\n::lamina Um\n::comum\n::nota Depois\n::comum\n'),
    ).toEqual(['E_BAD_SLOT_VALUE: ::nota Depois', 'E_BAD_COMUM: comum']);
  });

  it('text and adjustments on its line, each at its own range', async () => {
    expect(await problemsOf('::lamina Um\n::comum {destaque} sobra\n')).toEqual([
      'E_BAD_COMUM: sobra',
      'E_BAD_COMUM: destaque',
    ]);
  });

  it('a template with no repeatable slot, and a brief with no slide before it', async () => {
    expect(await problemsOf('::titulo T\n::comum\n', 'solto')).toEqual(['E_BAD_COMUM: comum']);
    expect(await problemsOf('::comum\n::lamina Um\n')).toEqual(['E_BAD_COMUM: comum']);
  });
});

describe('a required slot that is shared or a slide’s own', () => {
  it('is missing on no slide when a shared value stands in', async () => {
    expect(await problemsOf('::nota Comum\n::lamina Um\n::lamina Dois\n', 'obrigatorio')).toEqual(
      [],
    );
  });

  it('is missing on each slide without its own when there is no shared value', async () => {
    expect(await problemsOf('::lamina Um\n::nota Própria\n::lamina Dois\n', 'obrigatorio')).toEqual(
      ['E_MISSING_REQUIRED_SLOT: ::lamina Dois'],
    );
  });
});
