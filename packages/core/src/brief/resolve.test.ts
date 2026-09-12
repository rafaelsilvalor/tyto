import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive, Frontmatter, RichText } from './ast.js';
import { type ResolveOptions, type ResolvedBrief, resolve } from './resolve.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import type { AssetRef } from '../scene/primitives.js';
import { sourceRange } from '../source/range.js';
import { type TemplateManifest, parseManifest } from '../template/manifest.js';
import type { TemplateRegistry } from '../template/registry.js';

/**
 * `resolve` is where a brief meets the template it was written for, so the tests are
 * written as pairs: a manifest that declares something, and a brief that gets it right or
 * gets it wrong. The card asks for one test per diagnostic code and for every diagnostic
 * to carry the range of the directive or frontmatter key that caused it, so both are
 * asserted rather than only the first.
 *
 * The AST is built by hand instead of by parsing. `core` cannot import `brief-lang` — that
 * is why these types live here — and a fixture that had to round-trip through a parser
 * would be testing the parser again.
 */

const MANIFEST = `name: promo-curso
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text, required: true, max: 20 }
  subtitulo: { type: rich-text }
  imagem: { type: image }
  cor: { type: enum, values: [azul, laranja], default: azul }
  slide: { type: rich-text, repeat: true, min: 1, max: 3 }
adjustments:
  destaque: { type: flag, applies: [slide] }
  tom: { type: enum, values: [claro, escuro], applies: [slide] }
`;

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

function registryOf(...manifests: readonly TemplateManifest[]): TemplateRegistry {
  const byName = new Map(manifests.map((entry) => [entry.name, entry]));
  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
    formatsOf: (name) => byName.get(name)?.formats,
    directoryOf: (name) => (byName.has(name) ? `templates/${name}` : undefined),
    failures: [],
  };
}

const PRESENT: AssetRef = {
  id: 'prof-ana',
  source: 'file',
  path: './prof-ana.png',
  hash: 'sha256-1f0a',
};

/** Only `./prof-ana.png` is on disk; everything else is the miss `E_ASSET_NOT_FOUND` names. */
const assets: AssetResolver = {
  base: 'briefs/',
  resolve: (reference) => Promise.resolve(reference === './prof-ana.png' ? PRESENT : undefined),
};

/** A range nobody asserts on, for a node whose position is not what a test is about. */
const ANY = sourceRange(0, 1);

function text(value: string, at = ANY): RichText {
  return [{ kind: 'text', value, range: at }];
}

function directive(
  name: string,
  body: string,
  extra: Partial<Directive> = {},
  at = ANY,
): Directive {
  return { name, adjustments: [], body: text(body), range: at, nameRange: at, ...extra };
}

function frontmatter(
  data: Readonly<Record<string, unknown>>,
  ranges: Readonly<Record<string, ReturnType<typeof sourceRange>>> = {},
): Frontmatter {
  return { data, ranges, range: sourceRange(0, 40) };
}

function brief(front: Frontmatter, directives: readonly Directive[]): BriefAst {
  return { frontmatter: front, directives, range: sourceRange(0, 200) };
}

/** A brief that satisfies the manifest, for a test that wants to break one thing. */
function valid(
  overrides: {
    readonly data?: Readonly<Record<string, unknown>>;
    readonly directives?: readonly Directive[];
  } = {},
): BriefAst {
  return brief(frontmatter({ template: 'promo-curso', ...overrides.data }), [
    directive('titulo', 'Direito'),
    ...(overrides.directives ?? [directive('slide', 'Primeiro')]),
  ]);
}

function optionsFor(extra: Partial<ResolveOptions> = {}): ResolveOptions {
  return { registry: registryOf(manifestOf(MANIFEST)), assets, ...extra };
}

async function accepted(
  ast: BriefAst,
  extra: Partial<ResolveOptions> = {},
): Promise<ResolvedBrief> {
  const result = await resolve(ast, optionsFor(extra));
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

async function problems(
  ast: BriefAst,
  extra: Partial<ResolveOptions> = {},
): Promise<readonly Diagnostic[]> {
  const result = await resolve(ast, optionsFor(extra));
  return result.ok ? result.warnings : result.error;
}

async function codes(ast: BriefAst, extra: Partial<ResolveOptions> = {}): Promise<string[]> {
  return (await problems(ast, extra)).map((item) => item.code);
}

describe('what a brief resolves to', () => {
  it('types each slot by what the manifest declared it to be', async () => {
    const resolved = await accepted(valid({ data: { cor: 'laranja', imagem: './prof-ana.png' } }));
    expect(resolved.slots.titulo?.value).toEqual({ kind: 'rich-text', text: text('Direito') });
    expect(resolved.slots.cor?.value).toEqual({ kind: 'enum', value: 'laranja' });
    expect(resolved.slots.imagem?.value).toEqual({ kind: 'image', asset: PRESENT });
  });

  it('makes one artwork per occurrence of the repeatable slot, in order', async () => {
    const resolved = await accepted(
      valid({
        directives: [
          directive('slide', 'Primeiro'),
          directive('slide', 'Segundo'),
          directive('slide', 'Terceiro'),
        ],
      }),
    );
    expect(resolved.artworks.map((artwork) => artwork.index)).toEqual([0, 1, 2]);
    expect(resolved.artworks.map((artwork) => artwork.slot.name)).toEqual([
      'slide',
      'slide',
      'slide',
    ]);
  });

  it("takes the manifest's formats when the brief asks for none", async () => {
    expect((await accepted(valid())).formats).toEqual(['feed', 'story']);
  });

  it('narrows to the formats the frontmatter asked for', async () => {
    expect((await accepted(valid({ data: { formats: ['story'] } }))).formats).toEqual(['story']);
  });

  it("takes the caller's formats when the frontmatter lists none", async () => {
    // `--formats` on the CLI. A brief that says nothing about formats is a brief the
    // command line may answer for.
    expect((await accepted(valid(), { formats: ['story'] })).formats).toEqual(['story']);
  });

  it('lets the frontmatter win over the caller, exactly as it does for the template', async () => {
    // One rule for a reader: what the brief says about itself beats what this run says
    // about the brief. `--template` has worked this way since E3.3.
    const resolved = await accepted(valid({ data: { formats: ['feed'] } }), { formats: ['story'] });
    expect(resolved.formats).toEqual(['feed']);
  });

  it('checks the caller’s formats against the manifest, with no range to point at', async () => {
    const [problem] = (await problems(valid(), { formats: ['banner'] })).filter(
      (item) => item.code === 'E_UNKNOWN_FORMAT',
    );
    expect(problem?.message).toContain("Format 'banner' is not rendered by template 'promo-curso'");
    // No range: a flag is not a position in the file, and underlining a line the author
    // did not write is worse than underlining nothing.
    expect(problem).not.toHaveProperty('range');
  });

  it('fills a slot the brief left unset from the manifest default', async () => {
    const resolved = await accepted(valid());
    expect(resolved.slots.cor?.value).toEqual({ kind: 'enum', value: 'azul' });
    // A defaulted slot has no position in the brief, because the brief never wrote it.
    expect(resolved.slots.cor).not.toHaveProperty('range');
  });

  it('collects every asset once, which is what Scene.assets wants', async () => {
    // Two slots, one file: `Scene.assets` is a set of what the scene needs, and a second
    // entry with the same id would fail `E_SCENE_DUPLICATE_ID` downstream.
    const twoImages = manifestOf(`name: duas-fotos
version: 1.0.0
formats: [feed]
slots:
  capa: { type: image }
  rodape: { type: image }
`);
    const ast = brief(frontmatter({ template: 'duas-fotos' }), [
      directive('capa', './prof-ana.png'),
      directive('rodape', './prof-ana.png'),
    ]);

    const result = await resolve(ast, { registry: registryOf(twoImages), assets });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assets).toEqual([PRESENT]);
  });

  it('takes the template from the caller when the frontmatter names none', async () => {
    const ast = brief(frontmatter({}), [directive('titulo', 'Direito'), directive('slide', 'Um')]);
    expect((await accepted(ast, { template: 'promo-curso' })).template).toBe('promo-curso');
  });
});

describe('one test per diagnostic code', () => {
  it('E_UNKNOWN_SLOT — a directive names a slot the manifest does not declare', async () => {
    // `::rodape` over a three-line body: the whole directive is 10..64, the name is 12..18.
    // A wrong name is a problem with the name, so the narrow span is the one reported —
    // an editor underlining all four lines says where the directive is, not what is wrong.
    const at = sourceRange(10, 64);
    const nameRange = sourceRange(12, 18);
    const ast = valid({
      directives: [directive('slide', 'Um'), directive('rodape', 'x', { nameRange }, at)],
    });
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_UNKNOWN_SLOT');
    expect(problem?.message).toContain("Unknown slot 'rodape'");
    expect(problem?.message).toContain('titulo, subtitulo, imagem, cor, slide');
    expect(problem?.range).toEqual(nameRange);
  });

  it('E_UNKNOWN_DIRECTIVE — a namespaced directive with no plugin behind it', async () => {
    const at = sourceRange(30, 50);
    const nameRange = sourceRange(32, 42);
    const ast = valid({
      directives: [
        directive('slide', 'Um'),
        directive('caption', 'x', { namespace: 'ai', nameRange }, at),
      ],
    });
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_UNKNOWN_DIRECTIVE');
    expect(problem?.message).toContain("'::ai/caption'");
    expect(problem?.range).toEqual(nameRange);
  });

  it('leaves every other diagnostic on the span of the whole directive', async () => {
    // The name is right and the value is wrong on all three, so the body is what an author
    // has to look at. Only the two diagnostics above moved.
    const at = sourceRange(10, 64);
    const nameRange = sourceRange(12, 18);
    const ast = valid({
      directives: [
        directive('slide', 'Um', { nameRange }, at),
        directive('titulo', 'Direito Constitucional e Administrativo', { nameRange }, at),
      ],
    });
    const reported = (await problems(ast)).filter((item) => item.code === 'E_BAD_SLOT_VALUE');
    expect(reported).not.toHaveLength(0);
    for (const problem of reported) expect(problem.range).toEqual(at);
  });

  it('E_MISSING_REQUIRED_SLOT — a required slot nobody set', async () => {
    const ast = brief(frontmatter({ template: 'promo-curso' }), [directive('slide', 'Um')]);
    const [problem] = (await problems(ast)).filter(
      (item) => item.code === 'E_MISSING_REQUIRED_SLOT',
    );
    expect(problem?.message).toContain("requires slot 'titulo'");
    expect(problem?.range).toBeDefined();
  });

  it('E_BAD_ADJUSTMENT — an adjustment that does not apply to this slot', async () => {
    const at = sourceRange(5, 13);
    const ast = valid({
      directives: [
        directive('slide', 'Um'),
        directive('subtitulo', 'x', {
          adjustments: [{ name: 'destaque', range: at }],
        }),
      ],
    });
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_BAD_ADJUSTMENT');
    expect(problem?.message).toContain(
      "Adjustment 'destaque' is not declared for slot 'subtitulo'",
    );
    expect(problem?.message).toContain('Declared: none');
    expect(problem?.range).toEqual(at);
  });

  it('E_ASSET_NOT_FOUND — an image slot pointing at nothing', async () => {
    const at = sourceRange(60, 80);
    const ast = valid({ directives: [directive('imagem', './sumiu.png', {}, at)] });
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_ASSET_NOT_FOUND');
    expect(problem?.message).toBe(
      "Asset './sumiu.png' was not found relative to the brief at 'briefs/'.",
    );
    expect(problem?.range).toEqual(at);
  });

  it('W_UNUSED_SLOT — a slot the brief set that the template does not render', async () => {
    // Only a caller that has read the template body knows what it renders, so the warning
    // fires only when one passes the set.
    const ast = valid({
      directives: [directive('slide', 'Um'), directive('subtitulo', 'Nunca desenhado')],
    });
    const found = (await problems(ast, { renderedSlots: ['titulo', 'cor', 'slide'] })).filter(
      (item) => item.code === 'W_UNUSED_SLOT',
    );
    expect(found.map((item) => item.message)).toEqual([
      "Slot 'subtitulo' is set in the brief but template 'promo-curso' does not use it.",
    ]);
    expect(found[0]?.severity).toBe('warning');
  });

  it('stays silent about unused slots when the caller has not read the template', async () => {
    expect(
      await codes(valid({ directives: [directive('subtitulo', 'x'), directive('slide', 'Um')] })),
    ).not.toContain('W_UNUSED_SLOT');
  });
});

describe('the did-you-mean hint', () => {
  it('suggests the declared slot a typo is closest to', async () => {
    const ast = valid({ directives: [directive('slide', 'Um'), directive('titlo', 'x')] });
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_UNKNOWN_SLOT');
    expect(problem?.hint).toBe("Did you mean 'titulo'?");
  });

  it('says nothing when nothing declared is close enough to be a typo', async () => {
    const ast = valid({ directives: [directive('slide', 'Um'), directive('bibliografia', 'x')] });
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_UNKNOWN_SLOT');
    expect(problem).toBeDefined();
    expect(problem?.hint).toBeUndefined();
  });

  it('suggests a template name too, since a typo there is the same mistake', async () => {
    const ast = brief(frontmatter({ template: 'promo-curs' }), []);
    const [problem] = await problems(ast);
    expect(problem?.code).toBe('E_UNKNOWN_TEMPLATE');
    expect(problem?.hint).toBe("Did you mean 'promo-curso'?");
  });
});

describe('the two questions that stop everything else', () => {
  it('E_NO_TEMPLATE — nothing names a template', async () => {
    const ast = brief(frontmatter({}), [directive('nao-existe', 'x')]);
    const found = await problems(ast);
    // Only this one: with no manifest there is nothing to check the directive against.
    expect(found.map((item) => item.code)).toEqual(['E_NO_TEMPLATE']);
    expect(found[0]?.range).toEqual(sourceRange(0, 40));
  });

  it('treats a template that is not a name as no template at all', async () => {
    expect(await codes(brief(frontmatter({ template: 7 }), []))).toEqual(['E_NO_TEMPLATE']);
  });

  it('E_UNKNOWN_TEMPLATE — a name the registry does not have', async () => {
    const at = sourceRange(4, 12);
    const ast = brief(frontmatter({ template: 'inexistente' }, { template: at }), []);
    const [problem] = await problems(ast);
    expect(problem?.code).toBe('E_UNKNOWN_TEMPLATE');
    expect(problem?.message).toContain('Available: promo-curso');
    expect(problem?.range).toEqual(at);
  });
});

describe('the values a manifest constrains', () => {
  it('E_UNKNOWN_FORMAT — a format the template does not render', async () => {
    const at = sourceRange(20, 27);
    const ast = brief(
      frontmatter({ template: 'promo-curso', formats: ['feed', 'banner'] }, { formats: at }),
      [directive('titulo', 'Direito'), directive('slide', 'Um')],
    );
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_UNKNOWN_FORMAT');
    expect(problem?.message).toContain("Format 'banner' is not rendered by template 'promo-curso'");
    expect(problem?.range).toEqual(at);
  });

  it('refuses an enum value the manifest does not list', async () => {
    const at = sourceRange(4, 7);
    const ast = brief(frontmatter({ template: 'promo-curso', cor: 'roxo' }, { cor: at }), [
      directive('titulo', 'Direito'),
      directive('slide', 'Um'),
    ]);
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_BAD_SLOT_VALUE');
    expect(problem?.message).toBe("Slot 'cor' is invalid: 'roxo' is not one of azul, laranja.");
    expect(problem?.range).toEqual(at);
  });

  it('refuses rich text longer than the manifest allows', async () => {
    const ast = valid({
      directives: [
        directive('slide', 'Um'),
        directive('titulo', 'Direito Constitucional e Administrativo'),
      ],
    });
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_BAD_SLOT_VALUE');
    expect(problem?.message).toContain('is 39 characters and the manifest allows 20');
  });

  it('refuses too few occurrences of the repeatable slot', async () => {
    const ast = brief(frontmatter({ template: 'promo-curso' }), [directive('titulo', 'Direito')]);
    const messages = (await problems(ast)).map((item) => item.message);
    expect(messages).toContain(
      "Slot 'slide' is invalid: appears 0 times and the manifest needs 1.",
    );
  });

  it('refuses too many, and blames the first one over the limit', async () => {
    const fourth = sourceRange(90, 100);
    const ast = valid({
      directives: [
        directive('slide', 'Um'),
        directive('slide', 'Dois'),
        directive('slide', 'Tres'),
        directive('slide', 'Quatro', {}, fourth),
      ],
    });
    const [problem] = (await problems(ast)).filter((item) => item.code === 'E_BAD_SLOT_VALUE');
    expect(problem?.message).toContain('appears 4 times and the manifest allows 3');
    expect(problem?.range).toEqual(fourth);
  });

  it('refuses a flag adjustment given a value, and an enum one given none', async () => {
    const ast = valid({
      directives: [
        directive('slide', 'Um', {
          adjustments: [
            { name: 'destaque', value: 'muito', range: ANY },
            { name: 'tom', range: ANY },
          ],
        }),
      ],
    });
    const messages = (await problems(ast)).map((item) => item.message);
    expect(messages).toContain(
      "Slot 'slide' is invalid: adjustment 'destaque' is a flag and takes no value.",
    );
    expect(messages).toContain(
      "Slot 'slide' is invalid: adjustment 'tom' needs a value, as in {tom: claro}.",
    );
  });

  it('refuses an enum adjustment set to a value it does not accept', async () => {
    const ast = valid({
      directives: [
        directive('slide', 'Um', { adjustments: [{ name: 'tom', value: 'roxo', range: ANY }] }),
      ],
    });
    const messages = (await problems(ast)).map((item) => item.message);
    expect(messages).toContain(
      "Slot 'slide' is invalid: adjustment 'tom' does not accept 'roxo'; it accepts claro, escuro.",
    );
  });

  it('keeps the adjustments that are fine on a directive that also has a bad one', async () => {
    const ast = valid({
      directives: [
        directive('slide', 'Um', {
          adjustments: [
            { name: 'destaque', range: ANY },
            { name: 'inventado', range: ANY },
          ],
        }),
      ],
    });
    const result = await resolve(ast, optionsFor());
    expect(result.ok).toBe(false);
    // The good one survives into the value even though the brief as a whole is refused,
    // which is what lets an editor show the slot while the author fixes the other.
    expect(await codes(ast)).toEqual(['E_BAD_ADJUSTMENT']);
  });
});

describe('how the problems arrive', () => {
  it('reports every problem in one pass rather than the first one repeatedly', async () => {
    const ast = brief(frontmatter({ template: 'promo-curso', cor: 'roxo', nada: 'x' }), [
      directive('rodape', 'y'),
    ]);
    expect((await codes(ast)).sort()).toEqual([
      'E_BAD_SLOT_VALUE',
      'E_BAD_SLOT_VALUE',
      'E_MISSING_REQUIRED_SLOT',
      'E_UNKNOWN_SLOT',
      'E_UNKNOWN_SLOT',
    ]);
  });

  it('refuses a slot set twice when the manifest does not let it repeat', async () => {
    const ast = valid({
      directives: [directive('slide', 'Um'), directive('titulo', 'Outra vez')],
    });
    const messages = (await problems(ast)).map((item) => item.message);
    expect(messages).toContain(
      "Slot 'titulo' is invalid: is set more than once, and only a repeatable slot may be.",
    );
  });

  it('refuses the repeatable slot written in the frontmatter', async () => {
    const ast = valid({ data: { slide: 'Um' } });
    const messages = (await problems(ast)).map((item) => item.message);
    expect(messages).toContain(
      "Slot 'slide' is invalid: a repeatable slot is set with a ::directive, not in the frontmatter.",
    );
  });

  it('carries a warning on the ok branch rather than failing the brief (ADR 0013)', async () => {
    const result = await resolve(valid(), optionsFor({ renderedSlots: ['titulo', 'slide'] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((item) => item.code)).toEqual(['W_UNUSED_SLOT']);
      expect(result.value.slots.cor).toBeDefined();
    }
  });
});
