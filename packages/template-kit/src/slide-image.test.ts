import {
  type AssetRef,
  type AssetResolver,
  type TemplateManifest,
  defineTemplate,
  formatCatalogue,
  parseManifest,
} from '@tyto/core';
import { frame, image } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { imageHeight } from './image.js';
import { compileTemplate } from './testing.js';

/**
 * TYTO-482's acceptance, run as a template repository would run it: a carousel whose slides
 * each name their own picture (ADR 0160), through the real parser, `resolve` and `compile`.
 */

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const MANIFEST = manifestOf(`name: carrossel-foto
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true, min: 1 }
  imagem: { type: image, per: lamina }
`);

/** Each picture is as wide as the frame, and twice as wide as it is tall unless measured. */
const carrossel = defineTemplate(MANIFEST, (context) => {
  const picture = context.slots.imagem?.value;
  const asset = picture?.kind === 'image' ? picture.asset : undefined;
  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children:
      asset === undefined
        ? []
        : [image({ asset, size: { w: 1080, h: imageHeight(asset, 1080, 540) } })],
  });
});

const FORMATS = formatCatalogue({ feed: { w: 1080, h: 1350 } });

const PICTURES: Readonly<Record<string, AssetRef>> = {
  './um.png': {
    id: 'um',
    source: 'file',
    path: './um.png',
    hash: 'sha256-1',
    size: { w: 2, h: 1 },
  },
  './dois.png': { id: 'dois', source: 'file', path: './dois.png', hash: 'sha256-2' },
  './tres.png': {
    id: 'tres',
    source: 'file',
    path: './tres.png',
    hash: 'sha256-3',
    size: { w: 1, h: 1 },
  },
};

const assets: AssetResolver = {
  base: 'briefs/',
  resolve: (reference) => Promise.resolve(PICTURES[reference]),
};

const briefWith = (third: string): string => `---
template: carrossel-foto
---

::lamina
  Primeiro
::imagem ./um.png

::lamina
  Segundo
::imagem ./dois.png

::lamina
  Terceiro
::imagem ${third}
`;

describe('a slide that carries its own image', () => {
  it('renders three slides with three images, each its own', async () => {
    const compiled = await compileTemplate({
      brief: briefWith('./tres.png'),
      template: carrossel,
      formats: FORMATS,
      assets,
    });
    if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));

    const drawn = compiled.value.scene.artworks.map((artwork) =>
      artwork.frames[0]?.children.map((node) =>
        node.kind === 'image' ? [node.asset.id, node.size.h] : node.id,
      ),
    );
    expect(drawn).toEqual([[['um', 540]], [['dois', 540]], [['tres', 1080]]]);
    expect(compiled.value.scene.assets.map((asset) => asset.id)).toEqual(['um', 'dois', 'tres']);
  });

  it('reports a missing file at the line of the slide that named it', async () => {
    const brief = briefWith('./falta.png');
    const compiled = await compileTemplate({
      brief,
      template: carrossel,
      formats: FORMATS,
      assets,
    });
    if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));

    const problem = compiled.diagnostics.find((item) => item.code === 'E_ASSET_NOT_FOUND');
    expect(compiled.value.scene.artworks).toHaveLength(3);
    expect(problem?.range?.start).toBe(brief.indexOf('::imagem ./falta.png'));
    expect(brief.slice(problem?.range?.start, problem?.range?.end).trim()).toBe(
      '::imagem ./falta.png',
    );
  });
});
