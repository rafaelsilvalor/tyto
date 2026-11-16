import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive, Frontmatter } from './ast.js';
import { type ResolvedBrief, type ResolvedSlot, resolve } from './resolve.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import { sourceRange } from '../source/range.js';
import { type TemplateManifest, listsOccurrences, parseManifest } from '../template/manifest.js';
import type { TemplateRegistry } from '../template/registry.js';

/**
 * Several values of a nested slot inside one parent (ADR 0207, note of 2026-11-16, TYTO-746).
 *
 * `bloco: { per: lamina, multiple: true }` takes every `::bloco` written inside the same slide,
 * in brief order. The slide still holds the first under `slots.bloco`, so it reads as one value,
 * and that first one lists them all under `occurrences`, each with its own nested `slots`.
 */

const LISTS = `name: listas
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true, min: 1 }
  bloco: { type: rich-text, per: lamina, multiple: true, max: 2 }
  nota: { type: rich-text, per: lamina }
  paragrafo: { type: rich-text, per: bloco, multiple: true, required: true }
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

async function resolved(
  manifest: TemplateManifest,
  directives: readonly Directive[],
): Promise<{ readonly value: ResolvedBrief; readonly problems: readonly Diagnostic[] }> {
  const registry: TemplateRegistry = {
    list: () => [manifest],
    get: (name) => (name === manifest.name ? manifest : undefined),
    formatsOf: (name) => (name === manifest.name ? manifest.formats : undefined),
    directoryOf: () => `templates/${manifest.name}`,
    failures: [],
  };
  const front: Frontmatter = {
    data: { template: manifest.name },
    ranges: {},
    range: sourceRange(0, 40),
  };
  const ast: BriefAst = { frontmatter: front, directives, range: sourceRange(0, 100_000) };
  const result = await resolve(ast, { registry, assets });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { value: result.value, problems: result.diagnostics };
}

function textOf(slot: ResolvedSlot): string {
  return slot.value.kind === 'rich-text'
    ? slot.value.text.map((inline) => (inline.kind === 'text' ? inline.value : '')).join('')
    : '';
}

/** A slot as a template that iterates `occurrences` reads it: `[A{A1 A2} B{B1}]`. */
function listed(slot: ResolvedSlot | undefined): string {
  if (slot === undefined) return '-';
  const one = (each: ResolvedSlot): string => {
    const inside = Object.values(each.slots ?? {}).map(listed);
    return inside.length === 0 ? textOf(each) : `${textOf(each)}{${inside.join(' ')}}`;
  };
  return slot.occurrences === undefined ? one(slot) : `[${slot.occurrences.map(one).join(' ')}]`;
}

const LISTAS = manifestOf(LISTS);

describe('a multiple slot below the slide', () => {
  it('takes every occurrence inside the same parent, in brief order, to two levels', async () => {
    const { value, problems } = await resolved(LISTAS, [
      directive('lamina', 'Um'),
      directive('bloco', 'A'),
      directive('paragrafo', 'A1'),
      directive('paragrafo', 'A2'),
      directive('bloco', 'B'),
      directive('paragrafo', 'B1'),
      directive('paragrafo', 'B2'),
      directive('lamina', 'Dois'),
      directive('bloco', 'C'),
      directive('paragrafo', 'C1'),
    ]);

    expect(problems).toEqual([]);
    expect(value.artworks.map((artwork) => listed(artwork.slots.bloco))).toEqual([
      '[A{[A1 A2]} B{[B1 B2]}]',
      '[C{[C1]}]',
    ]);
  });

  it('keeps the first occurrence readable as the single value it was', async () => {
    const { value } = await resolved(LISTAS, [
      directive('lamina', 'Um'),
      directive('bloco', 'A'),
      directive('paragrafo', 'A1'),
      directive('bloco', 'B'),
      directive('paragrafo', 'B1'),
    ]);
    const bloco = value.artworks[0]?.slots.bloco;

    expect(bloco === undefined ? '-' : textOf(bloco)).toBe('A');
    expect(bloco?.slots?.paragrafo === undefined ? '-' : textOf(bloco.slots.paragrafo)).toBe('A1');
    // Each entry is one occurrence: the list lives on the first and nowhere inside itself.
    expect(bloco?.occurrences?.map((each) => 'occurrences' in each)).toEqual([false, false]);
  });

  it('is refused past its max at its own line, counted per parent', async () => {
    const third = directive('bloco', 'C');
    const { value, problems } = await resolved(LISTAS, [
      directive('lamina', 'Um'),
      directive('bloco', 'A'),
      directive('paragrafo', 'A1'),
      directive('bloco', 'B'),
      directive('paragrafo', 'B1'),
      third,
      directive('lamina', 'Dois'),
      directive('bloco', 'D'),
      directive('paragrafo', 'D1'),
      directive('bloco', 'E'),
      directive('paragrafo', 'E1'),
    ]);

    expect(problems.map((problem) => [problem.code, problem.range, problem.message])).toEqual([
      [
        'E_BAD_SLOT_VALUE',
        third.range,
        expect.stringContaining('appears more than 2 times in lamina 1, and the manifest allows 2'),
      ],
    ]);
    expect(value.artworks.map((artwork) => listed(artwork.slots.bloco))).toEqual([
      '[A{[A1]} B{[B1]}]',
      '[D{[D1]} E{[E1]}]',
    ]);
  });

  it('is required inside every occurrence of its parent, sibling by sibling', async () => {
    const empty = directive('bloco', 'vazio');
    const { value, problems } = await resolved(LISTAS, [
      directive('lamina', 'Um'),
      directive('bloco', 'A'),
      directive('paragrafo', 'A1'),
      empty,
    ]);

    expect(problems.map((problem) => [problem.code, problem.range])).toEqual([
      ['E_MISSING_REQUIRED_SLOT', empty.range],
    ]);
    expect(value.artworks[0]?.missingRequiredSlots).toEqual(['paragrafo']);
  });

  it('leaves a slot without multiple set once per parent', async () => {
    const second = directive('nota', 'N2');
    const { problems } = await resolved(LISTAS, [
      directive('lamina', 'Um'),
      directive('nota', 'N1'),
      second,
    ]);
    expect(problems.map((problem) => [problem.range, problem.message])).toEqual([
      [second.range, expect.stringContaining('is set more than once for lamina 1')],
    ]);
  });

  it('counts occurrences with max, not characters', async () => {
    const { problems } = await resolved(LISTAS, [
      directive('lamina', 'Um'),
      directive('bloco', 'a block much longer than two characters'),
      directive('paragrafo', 'P'),
    ]);
    expect(problems).toEqual([]);
  });
});

describe('a manifest that declares multiple', () => {
  it('reads it as a list everywhere but on a picture per slide', () => {
    const manifest = manifestOf(`name: x
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true }
  imagem: { type: image, per: lamina, multiple: true }
  bloco: { type: rich-text, per: lamina, multiple: true }
  foto: { type: image, per: bloco, multiple: true, max: 3 }
`);
    expect(
      ['lamina', 'imagem', 'bloco', 'foto'].map((name) => listsOccurrences(manifest, name)),
    ).toEqual([false, false, true, true]);
  });

  it('refuses min on it and multiple without per', () => {
    expect(
      manifestProblems(`name: x
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true }
  bloco: { type: rich-text, per: lamina, multiple: true, min: 1 }
  solto: { type: rich-text, multiple: true }
`),
    ).toEqual([
      expect.stringContaining('min is not built on a multiple slot'),
      expect.stringContaining('multiple is only meaningful on a slot that declares per'),
    ]);
  });
});
