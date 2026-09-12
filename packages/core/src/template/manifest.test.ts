import { describe, expect, it } from 'vitest';

import { type TemplateManifest, parseManifest } from './manifest.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import { sliceRange } from '../source/range.js';

/**
 * The manifest is validated before anything runs, so a broken one has to say where it is
 * broken: the card's acceptance criterion is the YAML path of the offending key, and the
 * tests below assert the path *and* that the range under it covers the value the path
 * names. A path with no position is a message an editor cannot draw.
 */

const PATH = 'templates/promo-curso/manifest.yaml';

/** The manifest `docs/template-authoring.md` prints, which has to parse unchanged. */
const DOC_EXAMPLE = `name: promo-curso
version: 1.0.0
description: Course promotion with teacher photo
formats: [feed, story, banner-wide]
slots:
  titulo: { type: rich-text, required: true, max: 60 }
  subtitulo: { type: rich-text }
  imagem: { type: image }
  cor: { type: enum, values: [azul-escuro, laranja, verde], default: azul-escuro }
  slide: { type: rich-text, repeat: true, min: 1, max: 10 }
adjustments:
  destaque: { type: flag, applies: [slide] }
  cor: { type: enum, values: [azul-escuro, laranja, verde], applies: [slide] }
`;

const MINIMAL = `name: bare
version: 0.1.0
formats: [feed]
slots:
  titulo: { type: rich-text }
`;

function accepted(source: string): TemplateManifest {
  const result = parseManifest(source, PATH);
  if (!result.ok) {
    throw new Error(`should parse: ${result.error.map((item) => item.message).join('; ')}`);
  }
  return result.value;
}

function rejected(source: string): readonly Diagnostic[] {
  const result = parseManifest(source, PATH);
  if (result.ok) throw new Error('should not parse');
  return result.error;
}

/** `Manifest is invalid at 'slots.titulo.max': …` → `slots.titulo.max`. */
function pathsOf(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((item) => /at '([^']*)'/u.exec(item.message)?.[1] ?? '(none)');
}

describe('the manifest the doc prints', () => {
  it('parses exactly as written', () => {
    const manifest = accepted(DOC_EXAMPLE);
    expect(manifest.name).toBe('promo-curso');
    expect(manifest.formats).toEqual(['feed', 'story', 'banner-wide']);
    expect(Object.keys(manifest.slots)).toEqual(['titulo', 'subtitulo', 'imagem', 'cor', 'slide']);
    expect(Object.keys(manifest.adjustments)).toEqual(['destaque', 'cor']);
  });

  it('fills the flags a slot leaves out, so no consumer writes ?? false', () => {
    const manifest = accepted(DOC_EXAMPLE);
    expect(manifest.slots.subtitulo).toEqual({ type: 'rich-text', required: false, repeat: false });
    expect(manifest.slots.titulo?.required).toBe(true);
    expect(manifest.slots.slide?.repeat).toBe(true);
  });

  it('reads min and max as occurrences on a repeatable slot and characters elsewhere', () => {
    // The same two keys, two meanings — the overload the doc writes and the schema keeps.
    const manifest = accepted(DOC_EXAMPLE);
    expect(manifest.slots.titulo?.max).toBe(60);
    expect(manifest.slots.slide).toMatchObject({ repeat: true, min: 1, max: 10 });
  });

  it('defaults adjustments to an empty object when a manifest declares none', () => {
    expect(accepted(MINIMAL).adjustments).toEqual({});
  });
});

describe('where a broken manifest is blamed', () => {
  it('names the YAML path of the offending key', () => {
    const source = MINIMAL.replace('{ type: rich-text }', '{ type: caligrafia }');
    expect(pathsOf(rejected(source))).toEqual(['slots.titulo.type']);
  });

  it('puts a range on the value the path names', () => {
    const source = MINIMAL.replace('{ type: rich-text }', '{ type: caligrafia }');
    const [problem] = rejected(source);
    expect(problem?.range).toBeDefined();
    expect(problem?.range && sliceRange(source, problem.range)).toBe('caligrafia');
  });

  it('blames the enclosing mapping when the key is the thing that is missing', () => {
    // There is no `version` node to point at, so the closest true answer is the object
    // that should have contained one.
    const source = MINIMAL.split('\n')
      .filter((line) => !line.startsWith('version:'))
      .join('\n');
    const [problem] = rejected(source);
    expect(pathsOf(rejected(source))).toEqual(['version']);
    expect(problem?.range?.start).toBe(0);
  });

  it('gives every unknown key its own squiggle instead of one on the object', () => {
    const source = `${MINIMAL}colour: blue\nauthor: ana\n`;
    expect(pathsOf(rejected(source))).toEqual(['colour', 'author']);
  });

  it('reports every problem in one pass', () => {
    const source = `name: ''
version: nope
formats: []
slots: {}
`;
    expect(pathsOf(rejected(source)).sort()).toEqual(['formats', 'name', 'version']);
  });

  it('says a manifest is not YAML rather than that it is the wrong shape', () => {
    const problems = rejected('name: [unclosed\n');
    expect(problems[0]?.code).toBe('E_MANIFEST_SYNTAX');
    expect(problems[0]?.message).toContain(PATH);
  });
});

describe('the rules a shape alone cannot state', () => {
  it('refuses an enum slot with no values', () => {
    const source = MINIMAL.replace('{ type: rich-text }', '{ type: enum }');
    expect(pathsOf(rejected(source))).toEqual(['slots.titulo.values']);
  });

  it('refuses a default that is not one of the values', () => {
    const source = MINIMAL.replace(
      '{ type: rich-text }',
      '{ type: enum, values: [a, b], default: c }',
    );
    expect(pathsOf(rejected(source))).toEqual(['slots.titulo.default']);
  });

  it('refuses values on a slot that is not an enum', () => {
    const source = MINIMAL.replace('{ type: rich-text }', '{ type: image, values: [a] }');
    expect(pathsOf(rejected(source))).toEqual(['slots.titulo.values']);
  });

  it('refuses a min above its max', () => {
    const source = MINIMAL.replace('{ type: rich-text }', '{ type: rich-text, min: 9, max: 2 }');
    expect(pathsOf(rejected(source))).toEqual(['slots.titulo.min']);
  });

  it.each(['image', 'enum, values: [a]'])(
    'refuses a max on a non-repeatable %s slot, which has no characters to count',
    (type) => {
      const source = MINIMAL.replace('{ type: rich-text }', `{ type: ${type}, max: 60 }`);
      expect(pathsOf(rejected(source))).toEqual(['slots.titulo.max']);
    },
  );

  it('blames both bounds when a non-repeatable image slot carries both', () => {
    const source = MINIMAL.replace('{ type: rich-text }', '{ type: image, min: 1, max: 60 }');
    expect(pathsOf(rejected(source))).toEqual(['slots.titulo.min', 'slots.titulo.max']);
  });

  it('allows the same bounds once the slot repeats, where they count occurrences', () => {
    const source = MINIMAL.replace(
      '{ type: rich-text }',
      '{ type: image, repeat: true, min: 1, max: 10 }',
    );
    expect(accepted(source).slots.titulo).toMatchObject({ repeat: true, min: 1, max: 10 });
  });

  it('refuses an adjustment that applies to a slot nobody declared', () => {
    const source = `${MINIMAL}adjustments:\n  destaque: { type: flag, applies: [slide] }\n`;
    expect(pathsOf(rejected(source))).toEqual(['adjustments.destaque.applies.0']);
  });

  it('refuses a second repeatable slot, because each repeat is an Artwork', () => {
    const source = `${MINIMAL}  slide: { type: rich-text, repeat: true }
  passo: { type: rich-text, repeat: true }
`;
    expect(pathsOf(rejected(source))).toEqual(['slots.passo.repeat']);
  });

  it('refuses a slot name the brief language cannot write', () => {
    // `::2-colunas` is not a directive the grammar accepts, so the slot could never be set.
    const source = MINIMAL.replace('titulo:', '2-colunas:');
    expect(rejected(source)[0]?.message).toContain('is not a name a brief can write');
  });

  it('refuses a template name with a separator in it', () => {
    expect(pathsOf(rejected(MINIMAL.replace('name: bare', 'name: ../evil')))).toEqual(['name']);
  });
});
