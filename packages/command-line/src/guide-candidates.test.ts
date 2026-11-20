import { join } from 'node:path';

import { parseBrief } from '@tyto/brief-lang';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import {
  type GuideLocation,
  guideCandidates,
  guideOverwrite,
  guidePaths,
} from './guide-candidates.js';

/**
 * The rules of ADR 0222 that `tyto guide` and the window share (TYTO-741): which citations get
 * a guide, what each guide is called and where it goes, and when an existing one is replaced.
 */

const MANIFEST = `
name: pintura
version: 1.0.0
formats: [grid-1x1, story]
slots:
  titulo: { type: rich-text }
  fundo:
    type: image
    external:
      kind: full
      sizes:
        grid-1x1: { width: 1080, height: 1080 }
        story: { width: 1080, height: 1920 }
  segundo:
    type: image
    external:
      kind: full
      sizes:
        grid-1x1: { width: 1080, height: 1080 }
        story: { width: 1080, height: 1920 }
  imagem:
    type: image
    external:
      kind: inline
      sizes:
        grid-1x1: { width: 920, suggestedHeight: 560 }
        story: { width: 920, suggestedHeight: 1080 }
`;

function manifest(): TemplateManifest {
  const parsed = parseManifest(MANIFEST, 'manifest.yaml');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

function ast(source: string) {
  const parsed = parseBrief(source);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

describe('guideCandidates', () => {
  it('lists each cited external slot with its file, place and artwork, frontmatter or directive', () => {
    const source = '---\ntemplate: pintura\nfundo: art/grafico.png\n---\n::imagem\n  foto.png\n';
    const found = guideCandidates(ast(source), manifest());

    expect(found.candidates.map(({ range: _range, ...rest }) => rest)).toEqual([
      { slot: 'fundo', kind: 'full', cited: 'art/grafico.png', artwork: 1 },
      { slot: 'imagem', kind: 'inline', cited: 'foto.png', artwork: 1 },
    ]);
    const [fundo, imagem] = found.candidates;
    expect(source.slice(fundo?.range.start, fundo?.range.end)).toContain('fundo');
    expect(source.slice(imagem?.range.start, imagem?.range.end)).toContain('::imagem');
  });

  it('lists a slot the brief cites no file for apart, with the line that would cite one', () => {
    const found = guideCandidates(ast('---\ntemplate: pintura\nfundo: f.png\n---\n'), manifest());
    expect(found.uncited).toEqual([
      { slot: 'segundo', kind: 'full', line: 'segundo: segundo.png' },
      { slot: 'imagem', kind: 'inline', line: 'imagem: imagem.png' },
    ]);
  });

  it("gives no guide to a second full slot or to a plugin source's item, and says why", () => {
    const found = guideCandidates(
      ast('---\ntemplate: pintura\nsegundo: s.png\nimagem: "acervo:foto-1"\n---\n'),
      manifest(),
    );
    expect(found.candidates).toEqual([]);
    expect(found.unguided.map(({ slot, reason }) => ({ slot, reason }))).toEqual([
      {
        slot: 'segundo',
        reason: "only the first full slot, 'fundo', is the frame's art (ADR 0220)",
      },
      { slot: 'imagem', reason: "it names an item in a plugin's source, not a file" },
    ]);
  });
});

/** A location where only `present` exists. */
function at(briefDirectory: string, present: readonly string[], delivery = false): GuideLocation {
  const files = new Set(present);
  return { briefDirectory, delivery, exists: (path) => files.has(path) };
}

const BRIEF_DIRECTORY = join('/work', 'peca');
const FUNDO = { slot: 'fundo', kind: 'full', cited: 'grafico.png' } as const;

describe('guidePaths', () => {
  it('names one guide after the cited file for one format, in assets/ when the file is not there yet', () => {
    expect(guidePaths(FUNDO, ['story'], at(BRIEF_DIRECTORY, []))).toEqual([
      {
        ...FUNDO,
        format: 'story',
        guide: join(BRIEF_DIRECTORY, 'assets', 'grafico.guide.psd'),
        art: join(BRIEF_DIRECTORY, 'assets', 'grafico.png'),
      },
    ]);
  });

  it('names a guide per format, and the PNG painted from it, for several formats', () => {
    const assets = join(BRIEF_DIRECTORY, 'assets');
    expect(
      guidePaths(FUNDO, ['grid-1x1', 'story'], at(BRIEF_DIRECTORY, [])).map(
        ({ format, guide, art }) => ({ format, guide, art }),
      ),
    ).toEqual([
      {
        format: 'grid-1x1',
        guide: join(assets, 'grafico.grid-1x1.guide.psd'),
        art: join(assets, 'grafico.grid-1x1.png'),
      },
      {
        format: 'story',
        guide: join(assets, 'grafico.story.guide.psd'),
        art: join(assets, 'grafico.story.png'),
      },
    ]);
  });

  it("goes beside the cited file when it is in the brief's own folder, earlier in the search order", () => {
    const cited = { ...FUNDO, cited: 'art/grafico.png' };
    const present = join(BRIEF_DIRECTORY, 'art', 'grafico.png');
    expect(guidePaths(cited, ['story'], at(BRIEF_DIRECTORY, [present]))[0]?.guide).toBe(
      join(BRIEF_DIRECTORY, 'art', 'grafico.guide.psd'),
    );
  });

  it("goes in a delivery's assets/, beside its editable folder, unless the file is found earlier", () => {
    const editable = join('/work', 'entrega', 'editaveis');
    expect(guidePaths(FUNDO, ['story'], at(editable, [], true))[0]?.guide).toBe(
      join('/work', 'entrega', 'assets', 'grafico.guide.psd'),
    );
    const earlier = join(editable, 'assets', 'grafico.png');
    expect(guidePaths(FUNDO, ['story'], at(editable, [earlier], true))[0]?.guide).toBe(
      join(editable, 'assets', 'grafico.guide.psd'),
    );
  });
});

describe('guideOverwrite', () => {
  const brief = 1_000;
  it.each([
    [undefined, false, false, 'write'],
    [undefined, false, true, 'write'],
    [999, false, false, 'write'],
    [1_000, false, false, 'write'],
    [1_001, false, true, 'ask'],
    [1_001, false, false, 'refuse'],
    [1_001, true, false, 'write'],
    [1_001, true, true, 'write'],
  ] as const)(
    'guide modified at %s, force %s, interactive %s: %s',
    (guideModified, force, interactive, expected) => {
      expect(
        guideOverwrite({
          ...(guideModified === undefined ? {} : { guideModified }),
          briefModified: brief,
          force,
          interactive,
        }),
      ).toBe(expected);
    },
  );
});
