import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive, Frontmatter } from './ast.js';
import { compile } from './compile.js';
import { type ResolvedBrief, resolve } from './resolve.js';
import { formatCatalogue } from '../config/formats.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import type { AssetRef } from '../scene/primitives.js';
import { type SourceRange, sourceRange } from '../source/range.js';
import { defineTemplate } from '../template/define.js';
import { type TemplateManifest, parseManifest } from '../template/manifest.js';
import { frame, image } from '../template/nodes.js';
import type { TemplateRegistry } from '../template/registry.js';

/**
 * A slot that belongs to each slide (ADR 0160): `imagem: { type: image, per: lamina }`, written
 * as `::imagem` after the `::lamina` it goes with. Each slide resolves its own picture, through
 * the same asset resolver and with the same diagnostics as any other image, at its own line.
 */

const MANIFEST = `name: questao
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  lamina: { type: rich-text, repeat: true, min: 1 }
  imagem: { type: image, per: lamina }
  selo: { type: image, per: lamina, required: true }
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

const QUESTAO = manifestOf(MANIFEST);

const registry: TemplateRegistry = {
  list: () => [QUESTAO],
  get: (name) => (name === QUESTAO.name ? QUESTAO : undefined),
  formatsOf: (name) => (name === QUESTAO.name ? QUESTAO.formats : undefined),
  directoryOf: () => 'templates/questao',
  failures: [],
};

const refOf = (path: string): AssetRef => ({
  id: path.replace(/\W/gu, ''),
  source: 'file',
  path,
  hash: `sha256-${path.length}`,
});

const ON_DISK = new Set(['./um.png', './dois.png', './tres.png', './selo.png']);

const assets: AssetResolver = {
  base: 'briefs/',
  resolve: (reference) => Promise.resolve(ON_DISK.has(reference) ? refOf(reference) : undefined),
};

/** Every directive on its own line, so each range is distinct and a diagnostic names one. */
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

function brief(
  directives: readonly Directive[],
  data: Readonly<Record<string, unknown>> = {},
): BriefAst {
  const front: Frontmatter = {
    data: { template: 'questao', ...data },
    ranges: { imagem: sourceRange(5, 20) },
    range: sourceRange(0, 40),
  };
  return { frontmatter: front, directives, range: sourceRange(0, 10_000) };
}

async function resolved(ast: BriefAst): Promise<{
  readonly value: ResolvedBrief;
  readonly problems: readonly Diagnostic[];
}> {
  const result = await resolve(ast, { registry, assets });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return { value: result.value, problems: result.diagnostics };
}

const pathOf = (value: ResolvedBrief['slots'][string] | undefined): string | undefined =>
  value?.value.kind === 'image' ? value.value.asset.path : undefined;

describe('a slot that belongs to each slide', () => {
  it('gives each occurrence the picture written after it', async () => {
    const { value, problems } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('imagem', './um.png'),
        directive('selo', './selo.png'),
        directive('lamina', 'Dois'),
        directive('selo', './selo.png'),
        directive('imagem', './dois.png'),
        directive('lamina', 'Tres'),
        directive('imagem', './tres.png'),
        directive('selo', './selo.png'),
      ]),
    );

    expect(problems).toEqual([]);
    expect(value.artworks.map((artwork) => pathOf(artwork.slots.imagem))).toEqual([
      './um.png',
      './dois.png',
      './tres.png',
    ]);
    // Not a brief-wide slot: the second `::imagem` is not "set more than once".
    expect(value.slots.imagem).toBeUndefined();
    expect(value.assets.map((asset) => asset.path)).toEqual([
      './um.png',
      './selo.png',
      './dois.png',
      './tres.png',
    ]);
  });

  it('reports a missing file at the line of the slide that named it', async () => {
    const missing = directive('imagem', './nao-existe.png');
    const { value, problems } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('imagem', './um.png'),
        directive('selo', './selo.png'),
        directive('lamina', 'Dois'),
        missing,
        directive('selo', './selo.png'),
      ]),
    );

    expect(problems.map((item) => [item.code, item.range])).toEqual([
      ['E_ASSET_NOT_FOUND', missing.range],
    ]);
    expect(value.artworks.map((artwork) => pathOf(artwork.slots.imagem))).toEqual([
      './um.png',
      undefined,
    ]);
  });

  it('refuses one before any slide, twice for one slide, and in the frontmatter', async () => {
    const early = directive('imagem', './um.png');
    const twice = directive('imagem', './dois.png');
    const { problems } = await resolved(
      brief(
        [
          early,
          directive('lamina', 'Um'),
          directive('imagem', './um.png'),
          twice,
          directive('selo', './selo.png'),
        ],
        { imagem: './um.png' },
      ),
    );

    const at = (range: SourceRange): string | undefined =>
      problems.find((item) => item.range === range)?.message;
    expect(problems.map((item) => item.code)).toEqual([
      'E_BAD_SLOT_VALUE',
      'E_BAD_SLOT_VALUE',
      'E_BAD_SLOT_VALUE',
    ]);
    expect(problems[0]?.message).toContain('not in the frontmatter');
    expect(at(early.range)).toContain("no 'lamina' comes before it");
    expect(at(twice.range)).toContain('more than once for lamina 1');
  });

  it('requires a required one on every slide, at that slide', async () => {
    const bare = directive('lamina', 'Dois');
    const { value, problems } = await resolved(
      brief([directive('lamina', 'Um'), directive('selo', './selo.png'), bare]),
    );

    expect(problems.map((item) => [item.code, item.range])).toEqual([
      ['E_MISSING_REQUIRED_SLOT', bare.range],
    ]);
    expect(value.missingRequiredSlots).toEqual([]);
    expect(value.artworks.map((artwork) => artwork.missingRequiredSlots)).toEqual([[], ['selo']]);
  });
});

describe('compiling a slot that belongs to each slide', () => {
  const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1080 } });
  const template = defineTemplate(QUESTAO, (context) => {
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

  it('hands each artwork its own picture, and stamps only the slide with a hole', async () => {
    const { value } = await resolved(
      brief([
        directive('lamina', 'Um'),
        directive('imagem', './um.png'),
        directive('selo', './selo.png'),
        directive('lamina', 'Dois'),
        directive('imagem', './dois.png'),
        directive('lamina', 'Tres'),
        directive('imagem', './tres.png'),
        directive('selo', './selo.png'),
      ]),
    );
    const scene = compile(value, template, { formats: FORMATS });
    if (!scene.ok) throw new Error(scene.error.map((item) => item.message).join('; '));

    const drawn = scene.value.artworks.map((artwork) =>
      artwork.frames[0]?.children.flatMap((node) =>
        node.kind === 'image' ? [node.asset.path] : [node.id],
      ),
    );
    expect(drawn).toEqual([['./um.png'], ['./dois.png', 'lamina-2.feed.gap'], ['./tres.png']]);
  });
});

describe('a manifest that declares one', () => {
  it('names the repeatable slot, does not repeat, and takes no default', () => {
    expect(
      manifestProblems(`name: x
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true }
  titulo: { type: rich-text }
  imagem: { type: image, per: titulo }
  foto: { type: image, per: lamina, repeat: true }
  tom: { type: enum, values: [a, b], default: a, per: lamina }
`),
    ).toEqual([
      expect.stringContaining('only one slot may repeat'),
      expect.stringContaining("per names 'titulo', which is not the manifest's repeatable slot"),
      expect.stringContaining('does not repeat itself'),
      expect.stringContaining('takes no default'),
    ]);
  });
});
