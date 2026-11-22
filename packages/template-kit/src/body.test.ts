import {
  type Face,
  type FaceCache,
  type Scene,
  type SceneNode,
  type Template,
  type TextNode,
  defineTemplate,
  formatCatalogue,
  parseManifest,
} from '@tyto/core';
import { font, frame, rect, solid } from '@tyto/core/template';
import { exportSvg } from '@tyto/export-svg';
import { describe, expect, it } from 'vitest';

import { at, sized } from './blocks.js';
import { BODY_PARAMETERS, type BodyOptions, bodyBlock, bodySize } from './body.js';
import { type ColumnEntry, blockColumn, weightOf } from './column.js';
import { richTextOfPlain } from './highlight.js';
import { levelsOf } from './levels.js';
import { parameterValues } from './parameters.js';
import { compileTemplate, placeholderFont } from './testing.js';
import { type Measure, grownTextBlock } from './text.js';
import bodyBrief from './__fixtures__/body/corpo.brief?raw';

/**
 * The body (TYTO-831, ADR 0224) on an arithmetic measure: a line is as tall as its size and
 * half its size wide per character, so every height below is a sum a reader can redo.
 */

const measure: Measure = (node) => {
  const runs = node.runs.filter((run) => run.kind === 'text');
  const size = Math.max(0, ...runs.map((run) => run.size));
  const width = runs.reduce((sum, run) => sum + run.text.length * 0.5 * run.size, 0);
  return { runs: node.runs, lines: 1, width, height: size, scale: 1, overflow: 0 };
};

const SIZES = { 1: 40, 2: 30, 3: 24 } as const;

function options(text: string, extra: Partial<BodyOptions> = {}): BodyOptions {
  return {
    items: levelsOf(richTextOfPlain(text)),
    sizes: SIZES,
    look: (_part, size) => ({
      style: { font: font('Test'), size, weight: 400, color: '#202020' },
      lineHeight: 1,
    }),
    measure,
    ...extra,
  };
}

/** Every text node of a draft, with its size, top to bottom. */
function sizesIn(draft: unknown): number[] {
  const found: number[] = [];
  const walk = (node: { kind: string; children?: unknown[]; runs?: { size?: number }[] }) => {
    if (node.kind === 'text') found.push(node.runs?.[0]?.size ?? 0);
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(draft as Parameters<typeof walk>[0]);
  return found;
}

const AREA = { width: 1000, height: Infinity };

describe('the sizes of a body’s levels', () => {
  it('draws each marked level at its own size', () => {
    const body = bodyBlock(AREA, 1, options('## Salário\n### Cargos\n# Destaque'))!;
    expect(sizesIn(body.draft)).toEqual([30, 24, 40]);
  });

  it('draws an unmarked line smaller than every marked level', () => {
    const body = bodyBlock(AREA, 1, options('### Cargos\nBanca FGV'))!;
    const [marked, unmarked] = sizesIn(body.draft);
    expect(unmarked).toBeLessThan(marked!);
    expect(unmarked).toBeCloseTo(24 * 0.8, 5);
  });

  it('keeps the unmarked level smallest whatever order the template gives the marks', () => {
    // A template whose ### is larger than its ##: the unmarked size follows the smallest mark.
    const sizes = { 1: 40, 2: 20, 3: 36 } as const;
    expect(bodySize(0, sizes)).toBeCloseTo(16, 5);
    expect(bodySize(0, sizes)).toBeLessThan(Math.min(sizes[1], sizes[2], sizes[3]));
  });

  it('reads the unmarked ratio from its parameters, never above 1', () => {
    expect(bodySize(0, SIZES, { unmarkedRatio: 0.5 })).toBe(12);
    expect(bodySize(0, SIZES, { unmarkedRatio: 3 })).toBe(24);
  });
});

describe('a body at a scale', () => {
  it('multiplies every size and every gap by the scale', () => {
    const text = '## Salário\nBanca FGV';
    const plain = bodyBlock(AREA, 1, options(text))!;
    const heavy = bodyBlock(AREA, 1.2, options(text))!;
    expect(sizesIn(heavy.draft)).toEqual(sizesIn(plain.draft).map((size) => size * 1.2));
    // 30 + 12 + 24 at scale 1; all of it times 1.2.
    expect(plain.height).toBeCloseTo(30 + 12 + 24 * 0.8, 5);
    expect(heavy.height).toBeCloseTo(plain.height * 1.2, 5);
  });

  it('spaces the parts of one line by the part gap', () => {
    const body = bodyBlock(
      AREA,
      1,
      options('## Salário | Banca FGV', { parameters: { partGap: 5 } }),
    )!;
    expect(body.height).toBeCloseTo(30 + 5 + 24 * 0.8, 5);
  });

  it('takes a gap per pair of lines from the template, scaled', () => {
    const body = bodyBlock(AREA, 2, options('## A\n## B', { lineGapBetween: () => 7 }))!;
    expect(body.height).toBeCloseTo(2 * (30 + 7 + 30), 5);
  });

  it('is as wide as its area', () => {
    expect(bodyBlock({ width: 640, height: 900 }, 1, options('## A'))!.width).toBe(640);
  });

  it('scales the gap between the parts of one line too', () => {
    const body = bodyBlock(
      AREA,
      2,
      options('## Salário | ## Banca', { parameters: { partGap: 5 } }),
    )!;
    expect(body.height).toBeCloseTo(2 * (30 + 5 + 30), 5);
  });

  it('is nothing when its lines draw nothing, as a divider alone', () => {
    expect(bodyBlock(AREA, 1, options('---'))).toBeUndefined();
  });

  it('is nothing when it has no lines, so a column leaves no room for it', () => {
    expect(bodyBlock(AREA, 1, options(''))).toBeUndefined();
  });

  it('draws the template’s divider at its scale', () => {
    const scales: number[] = [];
    bodyBlock(
      AREA,
      1.5,
      options('## A\n---\n## B', {
        divider: (_width, scale) => {
          scales.push(scale);
          return sized(rect({ name: 'divisor', size: { w: 10, h: 2 }, fill: solid('#000') }));
        },
      }),
    );
    expect(scales).toEqual([1.5]);
  });
});

describe('the parameters', () => {
  it('declare a default for every number the body uses', () => {
    expect(parameterValues(BODY_PARAMETERS)).toEqual({
      unmarkedRatio: 0.8,
      partGap: 8,
      lineGap: 12,
    });
  });
});

/* ------------------------------------------------------------- through the compile -- */

const EVEN: Face = { advance: (text) => text.length * 0.5, contentHeight: 1.2 };
const faces: FaceCache = { get: (face) => (face.family === 'Test' ? EVEN : undefined) };

const parsedManifest = parseManifest(
  `name: corpo-teste
version: 1.0.0
formats: [grid]
slots:
  titulo: { type: rich-text, required: true }
  lamina: { type: rich-text, repeat: true, min: 1, max: 5 }
  corpo: { type: rich-text, per: lamina, shared: true }
adjustments:
  peso: { type: enum, values: ['1', '2', '3'], default: '2', applies: [titulo, corpo] }
`,
  'manifest.yaml',
);
if (!parsedManifest.ok) {
  throw new Error(parsedManifest.error.map((item) => item.message).join('; '));
}
const FORMATS = formatCatalogue({ grid: { w: 600, h: 400 } });

/** A title and a body, each its own entry of the column. */
const bodyTemplate: Template = defineTemplate(parsedManifest.value, (context) => {
  const words = (name: string) => {
    const value = context.slots[name]?.value;
    return value?.kind === 'rich-text' ? value.text : [];
  };
  const entries: ColumnEntry[] = [
    {
      name: 'titulo',
      scale: weightOf(context.slots['titulo']),
      build: (area, scale) =>
        grownTextBlock(
          words('titulo'),
          area.width,
          0,
          { font: font('Test'), size: 32 * scale, weight: 900, color: '#1360d0' },
          context.measure,
          { name: 'titulo', align: 'center', lineHeight: 1.25 },
        ),
    },
    {
      name: 'corpo',
      scale: weightOf(context.slots['corpo']),
      build: (area, scale) =>
        bodyBlock(area, scale, {
          items: levelsOf(words('corpo')),
          sizes: { 1: 24, 2: 20, 3: 16 },
          look: (_part, size) => ({
            style: { font: font('Test'), size, weight: 400, color: '#202020' },
            lineHeight: 1.25,
          }),
          measure: context.measure,
          name: 'corpo',
        }),
    },
  ];
  const column = blockColumn(
    { width: 520, height: 320 },
    { entries, order: context.order, parameters: { gap: 16 }, name: 'coluna' },
  );
  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children: [at(40, 40, column.block)],
  });
});

function textsOf(scene: Scene, artwork: number): TextNode[] {
  const found: TextNode[] = [];
  const walk = (nodes: readonly SceneNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'text') found.push(node);
      if (node.kind === 'group') walk(node.children);
    }
  };
  walk(scene.artworks[artwork]?.frames[0]?.children ?? []);
  return found;
}

const sizeOf = (node: TextNode): number => node.runs.find((run) => run.kind === 'text')?.size ?? 0;

describe('the body, through the real compile', async () => {
  const compiled = await compileTemplate({
    brief: bodyBrief,
    template: bodyTemplate,
    formats: FORMATS,
    faces,
  });
  if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
  const { scene } = compiled.value;

  it('draws the shared body on a slide that writes none, at its own sizes', () => {
    const sizes = textsOf(scene, 0).map(sizeOf);
    // The title at 32; the body: `##` 20, unmarked 16 × 0.8.
    expect(sizes).toEqual([32, 20, 16 * 0.8]);
  });

  it('draws a slide’s own body, at its peso, without touching the title', () => {
    const sizes = textsOf(scene, 1).map(sizeOf);
    expect(sizes).toEqual([32, 20 * 1.2, 16 * 0.8 * 1.2]);
  });

  it('draws both slides as committed', async () => {
    const svg = exportSvg(scene, { resources: { font: placeholderFont } });
    if (!svg.ok) throw new Error(svg.error.map((item) => item.message).join('; '));
    for (const [index, item] of svg.value.entries()) {
      await expect(item.svg).toMatchFileSnapshot(
        `./__snapshots__/body/lamina-${String(index + 1)}.grid.svg`,
      );
    }
  });
});
