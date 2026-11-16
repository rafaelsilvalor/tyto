import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive, Frontmatter } from './ast.js';
import { type ResolvedBrief, type ResolvedSlot, resolve } from './resolve.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import { sourceRange } from '../source/range.js';
import { type TemplateManifest, parseManifest, slotDepth } from '../template/manifest.js';
import type { TemplateRegistry } from '../template/registry.js';

/**
 * A slot whose `per` names another `per` slot, to any depth (ADR 0207, TYTO-709).
 *
 * `paragrafo: { per: bloco }` belongs to the nearest open `::bloco` above it, and `bloco` to
 * the slide. The parse is a flat list; this is where the tree is made, from the manifest.
 */

const MANIFEST = `name: aninhado
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  lamina: { type: rich-text, repeat: true, min: 1 }
  bloco: { type: rich-text, per: lamina }
  nota: { type: rich-text, per: lamina }
  paragrafo: { type: rich-text, per: bloco, required: true }
  rodape: { type: rich-text, per: paragrafo }
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

const ANINHADO = manifestOf(MANIFEST);

const registry: TemplateRegistry = {
  list: () => [ANINHADO],
  get: (name) => (name === ANINHADO.name ? ANINHADO : undefined),
  formatsOf: (name) => (name === ANINHADO.name ? ANINHADO.formats : undefined),
  directoryOf: () => 'templates/aninhado',
  failures: [],
};

const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };

let line = 0;
function directive(name: string, body: string): Directive {
  line += 1;
  const at = sourceRange(line * 100, line * 100 + 50);
  return {
    name,
    adjustments: [],
    body: [{ kind: 'text', value: body, range: at }],
    range: at,
    nameRange: at,
  };
}

function brief(directives: readonly Directive[]): BriefAst {
  const front: Frontmatter = {
    data: { template: 'aninhado' },
    ranges: {},
    range: sourceRange(0, 40),
  };
  return { frontmatter: front, directives, range: sourceRange(0, 100_000) };
}

async function resolved(ast: BriefAst): Promise<{
  readonly value: ResolvedBrief;
  readonly problems: readonly Diagnostic[];
}> {
  const result = await resolve(ast, { registry, assets });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { value: result.value, problems: result.diagnostics };
}

/** A slot and everything inside it, as `name=text{child …}`. */
function tree(slot: ResolvedSlot | undefined): string {
  if (slot === undefined) return '-';
  const text =
    slot.value.kind === 'rich-text'
      ? slot.value.text.map((inline) => (inline.kind === 'text' ? inline.value : '')).join('')
      : '';
  const inside = Object.values(slot.slots ?? {}).map(tree);
  return inside.length === 0 ? `${slot.name}=${text}` : `${slot.name}=${text}{${inside.join(' ')}}`;
}

function slides(value: ResolvedBrief): string[] {
  return value.artworks.map((artwork) =>
    [tree(artwork.slot), ...Object.values(artwork.slots).map(tree)].join(' '),
  );
}

describe('a slot that belongs to another per slot', () => {
  it('goes to the nearest open occurrence of its parent, three levels deep', async () => {
    const { value, problems } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('bloco', 'A'),
        directive('paragrafo', 'A1'),
        directive('rodape', 'nota de A1'),
        directive('lamina', 'Dois'),
        directive('bloco', 'B'),
        directive('paragrafo', 'B1'),
      ]),
    );

    expect(problems).toEqual([]);
    expect(slides(value)).toEqual([
      'lamina=Um bloco=A{paragrafo=A1{rodape=nota de A1}}',
      'lamina=Dois bloco=B{paragrafo=B1}',
    ]);
    // Nothing below the slide is brief-wide, and a slide's own slot stays flat where ADR 0160
    // put it: a template that reads `slots.bloco` reads what it read before nesting.
    expect(Object.keys(value.slots)).toEqual([]);
    expect(Object.keys(value.artworks[0]?.slots ?? {})).toEqual(['bloco']);
  });

  it('leaves a slot with nothing inside it without a slots key', async () => {
    const { value } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('nota', 'N'),
        directive('bloco', 'A'),
        directive('paragrafo', 'P'),
      ]),
    );
    expect(value.artworks[0]?.slots.nota).not.toHaveProperty('slots');
  });

  it('is refused at its own line when no occurrence of its parent is open', async () => {
    const early = directive('paragrafo', 'sem bloco');
    const closed = directive('paragrafo', 'bloco fechado');
    const { value, problems } = await resolved(
      brief([
        directive('lamina', 'Um'),
        early,
        directive('bloco', 'A'),
        directive('paragrafo', 'A1'),
        // A slide's own slot closes the block open inside the slide.
        directive('nota', 'N'),
        closed,
      ]),
    );

    expect(problems.map((problem) => [problem.code, problem.range, problem.message])).toEqual([
      [
        'E_BAD_SLOT_VALUE',
        early.range,
        expect.stringContaining(
          "belongs to a 'bloco' and is written inside one, and no 'bloco' is open above it",
        ),
      ],
      ['E_BAD_SLOT_VALUE', closed.range, expect.stringContaining("no 'bloco' is open above it")],
    ]);
    expect(slides(value)).toEqual(['lamina=Um bloco=A{paragrafo=A1} nota=N']);
  });

  it('does not reach a block of the slide before', async () => {
    const orphan = directive('paragrafo', 'P');
    const { problems } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('bloco', 'A'),
        directive('paragrafo', 'A1'),
        directive('lamina', 'Dois'),
        orphan,
      ]),
    );
    expect(problems.map((problem) => problem.range)).toEqual([orphan.range]);
  });

  it('is refused when set twice in the same parent', async () => {
    const second = directive('paragrafo', 'A2');
    const { value, problems } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('bloco', 'A'),
        directive('paragrafo', 'A1'),
        second,
      ]),
    );
    expect(problems.map((problem) => [problem.range, problem.message])).toEqual([
      [
        second.range,
        expect.stringContaining(
          "is set more than once for this 'bloco', and each 'bloco' takes one",
        ),
      ],
    ]);
    expect(slides(value)).toEqual(['lamina=Um bloco=A{paragrafo=A1}']);
  });

  it('is required inside every occurrence of its parent, and reported at that parent', async () => {
    const empty = directive('bloco', 'vazio');
    const { value, problems } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('bloco', 'A'),
        directive('paragrafo', 'A1'),
        directive('lamina', 'Dois'),
        empty,
        directive('lamina', 'Tres'),
      ]),
    );
    expect(problems.map((problem) => [problem.code, problem.range])).toEqual([
      ['E_MISSING_REQUIRED_SLOT', empty.range],
    ]);
    expect(value.artworks.map((artwork) => artwork.missingRequiredSlots)).toEqual([
      [],
      ['paragrafo'],
      [],
    ]);
  });

  it('leaves a brief-wide slot written among them out of the tree', async () => {
    const { value, problems } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('bloco', 'A'),
        directive('titulo', 'T'),
        directive('paragrafo', 'A1'),
      ]),
    );
    expect(problems).toEqual([]);
    expect(tree(value.slots.titulo)).toBe('titulo=T');
    expect(slides(value)).toEqual(['lamina=Um bloco=A{paragrafo=A1}']);
  });
});

describe('a manifest whose per names another per slot', () => {
  it('accepts a chain that ends at the repeatable slot, and measures each depth', () => {
    expect(manifestProblems(MANIFEST)).toEqual([]);
    expect(
      ['titulo', 'lamina', 'bloco', 'paragrafo', 'rodape'].map((name) => slotDepth(ANINHADO, name)),
    ).toEqual([0, 0, 1, 2, 3]);
  });

  it('refuses a cycle, a dead end and a multiple slot below the slide', () => {
    expect(
      manifestProblems(`name: x
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true }
  titulo: { type: rich-text }
  a: { type: rich-text, per: b }
  b: { type: rich-text, per: a }
  c: { type: rich-text, per: titulo }
  d: { type: rich-text, per: nada }
  bloco: { type: rich-text, per: lamina }
  foto: { type: image, per: bloco, multiple: true }
`),
    ).toEqual([
      expect.stringContaining('per makes a cycle: a → b → a'),
      expect.stringContaining('per makes a cycle: b → a → b'),
      expect.stringContaining(
        "per names 'titulo', which is not the manifest's repeatable slot nor a slot that belongs to it",
      ),
      expect.stringContaining("per names 'nada'"),
      expect.stringContaining(
        "multiple is only built for a slot whose per names the repeatable slot, and 'bloco' is not it",
      ),
    ]);
  });
});
