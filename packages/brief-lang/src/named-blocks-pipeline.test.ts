import {
  type AssetResolver,
  type Diagnostic,
  type PlacedSlot,
  type ResolvedBrief,
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
 * TYTO-838 (ADR 0227): a slide's own block adds to the shared ones; several shared blocks of one
 * kind are a list; `{nome}` names a shared block and an empty directive inside a slide places it
 * there. Real briefs, parsed, resolved and compiled against a test template (ADR 0151) that
 * draws one rectangle per entry of `context.order`, naming its place, its text and its `peso`.
 */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const BLOCOS = manifestOf(`name: blocos
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text, per: lamina, shared: true }
  corpo: { type: rich-text, per: lamina, shared: true, multiple: true, max: 3 }
  lamina: { type: rich-text, repeat: true, min: 1 }
  apelo: { type: rich-text, per: lamina }
  nota: { type: rich-text, per: lamina, shared: true }
adjustments:
  peso: { type: enum, values: ['1', '2', '3', '4', '5'], applies: [corpo, titulo] }
`);

const registry: TemplateRegistry = {
  list: () => [BLOCOS],
  get: (name) => (name === BLOCOS.name ? BLOCOS : undefined),
  formatsOf: (name) => (name === BLOCOS.name ? BLOCOS.formats : undefined),
  directoryOf: (name) => `templates/${name}`,
  failures: [],
};

const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };

/** `name/place:text`, with `{peso}` when the block carries one. */
function entry(item: PlacedSlot): string {
  const value = item.slot?.value;
  const text =
    value?.kind === 'rich-text'
      ? value.text.map((inline) => (inline.kind === 'text' ? inline.value : '')).join('')
      : '';
  const peso = item.slot?.adjustments.find((adjustment) => adjustment.name === 'peso')?.value;
  return `${item.name}/${item.place}:${text}${peso === undefined ? '' : `{${peso}}`}`;
}

const template = defineTemplate(BLOCOS, (context) =>
  frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children: (context.order ?? []).map((item) =>
      rect({ name: entry(item), size: { w: 1, h: 1 } }),
    ),
  }),
);

const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 } });

const briefOf = (body: string): string => `---\ntemplate: blocos\n---\n${body}`;

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

const names = (scene: Scene): string[][] =>
  scene.artworks.map((artwork) =>
    (artwork.frames[0]?.children ?? []).map((node) => node.name ?? node.id),
  );

/** Each artwork's order, as the template drew it; the brief must resolve without a problem. */
async function drawn(body: string): Promise<string[][]> {
  const { value, problems } = await resolved(briefOf(body));
  expect(problems.map((problem) => problem.message)).toEqual([]);
  const scene = compile(value, template, { formats: FORMATS });
  if (!scene.ok) throw new Error(scene.error.map((item) => item.message).join('; '));
  return names(scene.value);
}

/** The diagnostics of `body`, as `code: the text under its range`. */
async function problemsOf(body: string): Promise<string[]> {
  const text = briefOf(body);
  const { problems } = await resolved(text);
  return problems.map(
    (problem) =>
      `${problem.code}: ${problem.range === undefined ? '' : text.slice(problem.range.start, problem.range.end)}`,
  );
}

describe('blocks that add up', () => {
  it('draws a shared title and a slide’s own title both, shared first', async () => {
    expect(await drawn('::titulo Concurso\n::lamina Um\n::titulo Edital\n::lamina Dois\n')).toEqual(
      [['titulo/before:Concurso', 'titulo/own:Edital'], ['titulo/before:Concurso']],
    );
  });
});

describe('several shared blocks of one kind', () => {
  it('are each an entry, in written order, each with its own peso', async () => {
    expect(
      await drawn('::corpo {peso: 2}\n  Vagas\n::corpo {peso: 4}\n  Salário\n::lamina Um\n'),
    ).toEqual([['corpo/before:Vagas{2}', 'corpo/before:Salário{4}']]);
  });

  it('count against the manifest’s max', async () => {
    expect(await problemsOf('::corpo A\n::corpo B\n::corpo C\n::corpo D\n::lamina Um\n')).toEqual([
      'E_BAD_SLOT_VALUE: ::corpo D',
    ]);
  });

  it('keep the first under the slot’s name, with every one in occurrences', async () => {
    const { value } = await resolved(briefOf('::corpo A\n::corpo B\n::lamina Um\n'));

    expect(value.slots.corpo?.occurrences?.length).toBe(2);
  });
});

describe('a named shared block placed by an empty directive', () => {
  const SHARED = '::corpo {nome: vagas}\n  Vagas\n::corpo {nome: salario, peso: 4}\n  Salário\n';

  it('is drawn where the slide places it, and nowhere else on that slide', async () => {
    expect(
      await drawn(
        `${SHARED}::lamina Um\n::corpo {nome: vagas}\n::apelo Oferta\n::corpo {nome: salario}\n` +
          '::lamina Dois\n::corpo {nome: salario}\n::apelo Garantia\n::corpo {nome: vagas}\n',
      ),
    ).toEqual([
      ['corpo/anchored:Vagas', 'apelo/own:Oferta', 'corpo/anchored:Salário{4}'],
      ['corpo/anchored:Salário{4}', 'apelo/own:Garantia', 'corpo/anchored:Vagas'],
    ]);
  });

  it('keeps its shared place on a slide that does not place it', async () => {
    expect(await drawn(`${SHARED}::lamina Um\n::apelo Oferta\n::corpo {nome: vagas}\n`)).toEqual([
      ['corpo/before:Salário{4}', 'apelo/own:Oferta', 'corpo/anchored:Vagas'],
    ]);
  });

  it('without a name, places the next shared block of that slot not placed yet', async () => {
    expect(await drawn(`${SHARED}::lamina Um\n::apelo Oferta\n::corpo\n::corpo\n`)).toEqual([
      ['apelo/own:Oferta', 'corpo/anchored:Vagas', 'corpo/anchored:Salário{4}'],
    ]);
  });

  it('may be written after ::comum, below the anchor that names it', async () => {
    expect(
      await drawn(
        '::lamina Um\n::nota {nome: prova}\n::apelo Oferta\n::comum\n::nota {nome: prova}\n  Prova\n',
      ),
    ).toEqual([['nota/anchored:Prova', 'apelo/own:Oferta']]);
  });
});

describe('what a block name refuses, at its own line', () => {
  it('an anchor naming no shared block, listing the names there are', async () => {
    const text = briefOf('::corpo {nome: vagas}\n  Vagas\n::lamina Um\n::corpo {nome: salrio}\n');
    const { problems } = await resolved(text);

    expect(problems.map((problem) => problem.code)).toEqual(['E_BAD_BLOCK_NAME']);
    expect(problems[0]?.message).toContain("'salrio'");
    expect(problems[0]?.message).toContain('named: vagas');
  });

  it('a name given to two shared blocks', async () => {
    expect(
      await problemsOf('::corpo {nome: vagas}\n  A\n::corpo {nome: vagas}\n  B\n::lamina Um\n'),
    ).toEqual(['E_BAD_BLOCK_NAME: nome: vagas']);
  });

  it('a block placed twice on one slide', async () => {
    expect(
      await problemsOf(
        '::corpo {nome: vagas}\n  A\n::lamina Um\n::corpo {nome: vagas}\n::corpo {nome: vagas}\n',
      ),
    ).toEqual(['E_BAD_BLOCK_NAME: ::corpo {nome: vagas}']);
  });

  it('an unnamed anchor with no shared block left to place', async () => {
    expect(await problemsOf('::lamina Um\n::corpo\n')).toEqual(['E_BAD_BLOCK_NAME: ::corpo']);
  });

  it('a name on a slot that is not shared, and a weight on an anchor', async () => {
    expect(
      await problemsOf(
        '::corpo {nome: vagas}\n  A\n::lamina Um\n::apelo {nome: x} Oferta\n::corpo {nome: vagas, peso: 2}\n',
      ),
    ).toEqual(['E_BAD_BLOCK_NAME: nome: x', 'E_BAD_BLOCK_NAME: peso: 2']);
  });
});
