import {
  type AssetRef,
  type AssetResolver,
  type TemplateManifest,
  defineTemplate,
  formatCatalogue,
  parseManifest,
} from '@tyto/core';
import { frame, image, solid } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { imageHeight } from './image.js';
import { compileTemplate } from './testing.js';

/**
 * ADR 0158: a frame follows the height of the picture a brief supplies, from the size the
 * host put on the ref, with nothing written on the slide by hand.
 */

const LARGA: AssetRef = {
  id: './larga.png',
  source: 'file',
  path: '/brief/larga.png',
  hash: 'sha256-larga',
  size: { w: 1600, h: 900 },
};
const ALTA: AssetRef = {
  id: './alta.png',
  source: 'file',
  path: '/brief/alta.png',
  hash: 'sha256-alta',
  size: { w: 600, h: 1200 },
};

describe('imageHeight', () => {
  it('is the width times the picture’s own aspect', () => {
    expect(imageHeight(LARGA, 800, 300)).toBe(450);
    expect(imageHeight(ALTA, 800, 300)).toBe(1600);
  });

  it('is the fallback for a ref with no size, or no ref', () => {
    const { size: _size, ...unmeasured } = LARGA;
    expect(imageHeight(unmeasured, 800, 300)).toBe(300);
    expect(imageHeight(undefined, 800, 300)).toBe(300);
  });

  it('is the fallback for a size with no area, rather than zero or infinity', () => {
    expect(imageHeight({ ...LARGA, size: { w: 0, h: 900 } }, 800, 300)).toBe(300);
    expect(imageHeight({ ...LARGA, size: { w: 1600, h: 0 } }, 800, 300)).toBe(300);
  });
});

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const MANIFEST = manifestOf(`name: enunciado
version: 1.0.0
formats: [grid]
slots:
  capa: { type: image }
  rodape: { type: image }
`);

const WIDTH = 800;

/** Two pictures stacked, each frame as tall as its picture is at {@link WIDTH}. */
const enunciado = defineTemplate(MANIFEST, (context) => {
  const children = [];
  let y = 0;
  for (const name of ['capa', 'rodape']) {
    const value = context.slots[name]?.value;
    if (value?.kind !== 'image') continue;
    const height = imageHeight(value.asset, WIDTH, 300);
    children.push(
      image({
        id: `${context.idPrefix}.${name}`,
        asset: value.asset,
        size: { w: WIDTH, h: height },
        transform: { x: 140, y },
      }),
    );
    y += height;
  }
  return frame({
    format: context.format,
    size: context.size,
    background: solid('#ffffff'),
    idPrefix: context.idPrefix,
    children,
  });
});

const assets: AssetResolver = {
  base: '/brief',
  resolve: (reference) =>
    Promise.resolve(
      reference === './larga.png' ? LARGA : reference === './alta.png' ? ALTA : undefined,
    ),
};

/** Every image node's height in the scene, in drawing order. */
function imageHeights(value: unknown, into: number[] = []): number[] {
  if (Array.isArray(value)) {
    for (const item of value) imageHeights(item, into);
  } else if (typeof value === 'object' && value !== null) {
    const node = value as { kind?: unknown; size?: { h?: unknown } };
    if (node.kind === 'image' && typeof node.size?.h === 'number') into.push(node.size.h);
    else for (const item of Object.values(value)) imageHeights(item, into);
  }
  return into;
}

describe('a frame sized to the brief’s picture', () => {
  it('draws two heights for two aspects, with no proportion written on the slide', async () => {
    const result = await compileTemplate({
      brief: `---
template: enunciado
formats: [grid]
capa: ./larga.png
rodape: ./alta.png
---
`,
      template: enunciado,
      formats: formatCatalogue({ grid: { w: 1080, h: 1350 } }),
      assets,
    });

    if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
    expect(imageHeights(result.value.scene.artworks)).toEqual([450, 1600]);
  });
});
