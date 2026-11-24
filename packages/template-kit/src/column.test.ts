import {
  type Face,
  type FaceCache,
  type Scene,
  type SceneNode,
  type Template,
  defineTemplate,
  formatCatalogue,
  parseManifest,
} from '@tyto/core';
import { font, frame, rect, solid } from '@tyto/core/template';
import { exportSvg } from '@tyto/export-svg';
import { describe, expect, it } from 'vitest';

import { type Block, at, sized } from './blocks.js';
import {
  BLOCK_COLUMN_PARAMETERS,
  type ColumnEntry,
  blockColumn,
  columnOrder,
  distanceOf,
  scalesOf,
  sizeOf,
  spacingOf,
  weightOf,
} from './column.js';
import { MAIN_LINE_FIT_PARAMETERS, mainLineScale } from './fit.js';
import { richTextOfPlain } from './highlight.js';
import { type LevelLook, type LevelPart, levelsOf } from './levels.js';
import { parameterValues } from './parameters.js';
import { compileTemplate, placeholderFont } from './testing.js';
import { type Measure, grownTextBlock } from './text.js';
import columnBrief from './__fixtures__/column/coluna.brief?raw';
import distanceBrief from './__fixtures__/column/distancia.brief?raw';

/**
 * The block column (TYTO-824, ADR 0224) on blocks of known size: a block of `height` at scale 1
 * is `height × scale` tall, so every top below is arithmetic a reader can redo.
 */

function box(name: string, width: number, height: number): Block {
  return sized(rect({ name, size: { w: width, h: height }, fill: solid('#000000') }));
}

/** An entry whose block is `height` tall at scale 1 and grows with its scale. */
function entry(name: string, height: number, scale?: number): ColumnEntry {
  return {
    name,
    build: (_area, builtAt) => box(name, 100, height * builtAt),
    ...(scale === undefined ? {} : { scale }),
  };
}

const absent: ColumnEntry = { name: 'nota', build: () => undefined };

describe('the order of the blocks', () => {
  const entries = [entry('titulo', 10), entry('apelo', 20), entry('nota', 30)];

  it('is the template’s own when the brief gives none', () => {
    expect(columnOrder(entries, undefined).map((item) => item.name)).toEqual([
      'titulo',
      'apelo',
      'nota',
    ]);
  });

  it('is the brief’s among the blocks it wrote', () => {
    const order = [{ name: 'nota' }, { name: 'titulo' }, { name: 'apelo' }];
    expect(columnOrder(entries, order).map((item) => item.name)).toEqual([
      'nota',
      'titulo',
      'apelo',
    ]);
  });

  it('keeps a block the brief did not write in the template’s place', () => {
    // `apelo` came from a default: it stays second, and the two written blocks swap around it.
    const order = [{ name: 'nota' }, { name: 'titulo' }];
    expect(columnOrder(entries, order).map((item) => item.name)).toEqual([
      'nota',
      'apelo',
      'titulo',
    ]);
  });

  it('ignores a name the template has no block for, and a name written twice', () => {
    const order = [{ name: 'imagem' }, { name: 'apelo' }, { name: 'apelo' }, { name: 'titulo' }];
    expect(columnOrder(entries, order).map((item) => item.name)).toEqual([
      'apelo',
      'titulo',
      'nota',
    ]);
  });

  it('draws the blocks top to bottom in that order', () => {
    const column = blockColumn(
      { width: 100, height: Infinity },
      { entries, order: [{ name: 'nota' }, { name: 'apelo' }, { name: 'titulo' }] },
    );
    expect(column.placed.map((item) => [item.name, item.top])).toEqual([
      ['nota', 0],
      ['apelo', 30],
      ['titulo', 50],
    ]);
  });
});

describe('a block the brief left out', () => {
  it('takes no room and no gap', () => {
    const column = blockColumn(
      { width: 100, height: Infinity },
      { entries: [entry('titulo', 10), absent, entry('apelo', 20)], parameters: { gap: 5 } },
    );
    expect(column.placed.map((item) => [item.name, item.top])).toEqual([
      ['titulo', 0],
      ['apelo', 15],
    ]);
    expect(column.block.height).toBe(35);
  });

  it('is absent also when it comes out with no height', () => {
    const column = blockColumn(
      { width: 100, height: Infinity },
      { entries: [entry('titulo', 10), entry('nota', 0)], parameters: { gap: 5 } },
    );
    expect(column.placed.map((item) => item.name)).toEqual(['titulo']);
    expect(column.block.height).toBe(10);
  });
});

describe('the gaps', () => {
  it('are the template’s per pair, the gap parameter where it states none', () => {
    const column = blockColumn(
      { width: 100, height: Infinity },
      {
        entries: [entry('titulo', 10), entry('apelo', 20), entry('nota', 30)],
        gapBetween: (above) => (above === 'titulo' ? 40 : undefined),
        parameters: { gap: 7 },
      },
    );
    expect(column.placed.map((item) => item.top)).toEqual([0, 50, 77]);
    expect(column.block.height).toBe(107);
  });

  it('are never negative', () => {
    const column = blockColumn(
      { width: 100, height: Infinity },
      { entries: [entry('titulo', 10), entry('apelo', 20)], gapBetween: () => -30 },
    );
    expect(column.placed.map((item) => item.top)).toEqual([0, 10]);
  });
});

describe('peso', () => {
  const slot = (value?: string) => ({
    adjustments: value === undefined ? [] : [{ name: 'peso', value }],
  });

  it('scales a block 0.7, 0.85, 1, 1.2 and 1.4 by default, 3 the block as designed', () => {
    expect(['1', '2', '3', '4', '5'].map((value) => weightOf(slot(value)))).toEqual([
      0.7, 0.85, 1, 1.2, 1.4,
    ]);
  });

  it('scales a block 1.6, 1.8 and 2 at 6, 7 and 8 (TYTO-853)', () => {
    expect(['6', '7', '8'].map((value) => weightOf(slot(value)))).toEqual([1.6, 1.8, 2]);
  });

  it('is the designed size when not written, absent or not one of the eight values', () => {
    expect([weightOf(slot()), weightOf(undefined), weightOf(slot('9'))]).toEqual([1, 1, 1]);
  });

  it('reads the weights from the column’s parameters', () => {
    expect(weightOf(slot('5'), { weight5: 1.6 })).toBe(1.6);
    expect(weightOf(slot('1'), { weight1: 0.5 })).toBe(0.5);
  });

  it('builds the block at its scale, and the column measures what came out', () => {
    const column = blockColumn(
      { width: 100, height: Infinity },
      {
        entries: [
          entry('titulo', 100, weightOf(slot('4'))),
          entry('apelo', 100, weightOf(slot('2'))),
        ],
      },
    );
    expect(column.placed.map((item) => [item.name, item.height, item.scale])).toEqual([
      ['titulo', 120, 1.2],
      ['apelo', 85, 0.85],
    ]);
    expect(column.block.height).toBe(205);
  });
});

describe('tamanho, espaco and distancia (TYTO-853)', () => {
  const written = (...pairs: [string, string][]) => ({
    adjustments: pairs.map(([name, value]) => ({ name, value })),
  });

  it('take peso for both sides when neither is written, as before', () => {
    expect(scalesOf(written(['peso', '4']))).toEqual({ scale: 1.2, spacing: 1.2, distance: 1 });
    expect(scalesOf(undefined)).toEqual({ scale: 1, spacing: 1, distance: 1 });
  });

  it('let tamanho replace the letters’ side only, on the scales of peso up to 8', () => {
    const slot = written(['peso', '2'], ['tamanho', '8']);
    expect([sizeOf(slot), spacingOf(slot)]).toEqual([2, 0.85]);
  });

  it('let espaco replace the spaces’ side only, on the scales of peso 1 to 5', () => {
    const slot = written(['peso', '5'], ['espaco', '1']);
    expect([sizeOf(slot), spacingOf(slot)]).toEqual([1.4, 0.7]);
  });

  it('read an espaco past 5, or any unknown value, as not written', () => {
    expect(spacingOf(written(['peso', '4'], ['espaco', '6']))).toBe(1.2);
    expect(sizeOf(written(['tamanho', 'grande']))).toBe(1);
    expect(distanceOf(written(['distancia', '0']))).toBe(1);
  });

  it('read distancia as 0, 0.5, 1, 1.5 and 2 of the gap, and never from peso', () => {
    expect(
      ['1', '2', '3', '4', '5'].map((value) => distanceOf(written(['distancia', value]))),
    ).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(distanceOf(written(['peso', '8']))).toBe(1);
    expect(distanceOf(written(['distancia', '5']), { distance5: 3 })).toBe(3);
  });

  /** An entry `height` tall whose letters and inner spaces take 10 each at scale 1. */
  const twoSided = (name: string, scales: Partial<ColumnEntry>): ColumnEntry => ({
    name,
    build: (_area, scale, spacing) => box(name, 100, 10 * scale + 10 * (spacing ?? scale)),
    ...scales,
  });

  it('build a block with its letters and its spaces apart', () => {
    const column = blockColumn(
      { width: 100, height: Infinity },
      { entries: [twoSided('titulo', scalesOf(written(['tamanho', '8'], ['espaco', '1'])))] },
    );
    // 10 × 2 of letters, 10 × 0.7 of spaces.
    expect(column.placed.map((item) => [item.height, item.scale, item.spacing])).toEqual([
      [27, 2, 0.7],
    ]);
  });

  it('give the spaces the letters’ scale when an entry states only one', () => {
    const column = blockColumn(
      { width: 100, height: Infinity },
      { entries: [twoSided('titulo', { scale: 1.2 })] },
    );
    expect(column.placed.map((item) => [item.height, item.spacing])).toEqual([[24, 1.2]]);
  });

  it('shrink the letters and the spaces by the same factor', () => {
    const column = blockColumn(
      { width: 100, height: 14 },
      { entries: [twoSided('titulo', { scale: 1, spacing: 1 })] },
    );
    expect(column.shrink).toBe(0.7);
    expect(column.placed.map((item) => [item.scale, item.spacing])).toEqual([[0.7, 0.7]]);
  });

  it('scale the gap above a block by its own distancia, the first block’s changing nothing', () => {
    const topsWith = (distance: string, where: 'titulo' | 'apelo'): number[] =>
      blockColumn(
        { width: 100, height: Infinity },
        {
          entries: [
            {
              ...entry('titulo', 10),
              ...(where === 'titulo' ? scalesOf(written(['distancia', distance])) : {}),
            },
            {
              ...entry('apelo', 10),
              ...(where === 'apelo' ? scalesOf(written(['distancia', distance])) : {}),
            },
          ],
          gapBetween: () => 20,
        },
      ).placed.map((item) => item.top);
    expect(['1', '2', '3', '4', '5'].map((value) => topsWith(value, 'apelo')[1])).toEqual([
      10, 20, 30, 40, 50,
    ]);
    expect(topsWith('5', 'titulo')).toEqual([0, 30]);
  });
});

describe('the group in its area', () => {
  const entries = [entry('titulo', 10), entry('apelo', 20)];

  it('is centred between the top and the bottom by default', () => {
    const column = blockColumn({ width: 100, height: 100 }, { entries, parameters: { gap: 10 } });
    // 40 of content in 100: 30 above and 30 below.
    expect(column.placed.map((item) => item.top)).toEqual([30, 50]);
    expect(column.block.height).toBe(100);
    expect(column.overflow).toBe(0);
  });

  it('sits at the top or the bottom when asked', () => {
    const start = blockColumn(
      { width: 100, height: 100 },
      { entries, parameters: { verticalAlign: 'start' } },
    );
    const end = blockColumn(
      { width: 100, height: 100 },
      { entries, parameters: { verticalAlign: 'end' } },
    );
    expect(start.placed.map((item) => item.top)).toEqual([0, 10]);
    expect(end.placed.map((item) => item.top)).toEqual([70, 80]);
  });

  it('centres a narrower block across the area', () => {
    const column = blockColumn(
      { width: 300, height: Infinity },
      { entries: [entry('titulo', 10)] },
    );
    const child = column.block.draft.kind === 'group' ? column.block.draft.children[0] : undefined;
    expect(child?.transform.x).toBe(100);
  });

  it('starts at the top and says by how much it did not fit, when it may not shrink', () => {
    const column = blockColumn(
      { width: 100, height: 25 },
      { entries, parameters: { gap: 5, shrinkFloor: 1 } },
    );
    expect(column.placed.map((item) => item.top)).toEqual([0, 15]);
    expect(column.overflow).toBe(10);
  });

  it('offers every block the area it was given', () => {
    const offered: { width: number; height: number }[] = [];
    blockColumn(
      { width: 640, height: 900 },
      {
        entries: [
          {
            name: 'titulo',
            build: (area) => {
              offered.push(area);
              return box('titulo', 10, 10);
            },
          },
        ],
      },
    );
    expect(offered).toEqual([{ width: 640, height: 900 }]);
  });
});

describe('the parameters', () => {
  it('declare a default for every number the column uses', () => {
    expect(parameterValues(BLOCK_COLUMN_PARAMETERS)).toEqual({
      gap: 0,
      verticalAlign: 'center',
      horizontalAlign: 'center',
      weight1: 0.7,
      weight2: 0.85,
      weight3: 1,
      weight4: 1.2,
      weight5: 1.4,
      weight6: 1.6,
      weight7: 1.8,
      weight8: 2,
      distance1: 0,
      distance2: 0.5,
      distance3: 1,
      distance4: 1.5,
      distance5: 2,
      shrinkFloor: 0.7,
      reach: 0,
    });
  });

  it('bring a value back inside its limits, and an unknown choice back to its default', () => {
    const values = parameterValues(BLOCK_COLUMN_PARAMETERS, {
      gap: -4,
      // @ts-expect-error — a word outside the list, as an editor might send it
      verticalAlign: 'middle',
    });
    expect([values.gap, values.verticalAlign]).toEqual([0, 'center']);
  });
});

/* ------------------------------------------------------------- through the compile -- */

const EVEN: Face = { advance: (text) => text.length * 0.5, contentHeight: 1.2 };
const faces: FaceCache = { get: (face) => (face.family === 'Test' ? EVEN : undefined) };

const parsedManifest = parseManifest(
  `name: coluna-teste
version: 1.0.0
formats: [grid]
slots:
  titulo: { type: rich-text, required: true }
  lamina: { type: rich-text, repeat: true, min: 1, max: 5 }
  apelo: { type: rich-text, per: lamina }
  nota: { type: rich-text, per: lamina, shared: true }
adjustments:
  peso: { type: enum, values: ['1', '2', '3', '4', '5', '6', '7', '8'], default: '3', applies: [titulo, apelo, nota] }
  tamanho: { type: enum, values: ['1', '2', '3', '4', '5', '6', '7', '8'], default: '3', applies: [titulo, apelo, nota] }
  espaco: { type: enum, values: ['1', '2', '3', '4', '5'], default: '3', applies: [titulo, apelo, nota] }
  distancia: { type: enum, values: ['1', '2', '3', '4', '5'], default: '3', applies: [titulo, apelo, nota] }
`,
  'manifest.yaml',
);
if (!parsedManifest.ok) {
  throw new Error(parsedManifest.error.map((item) => item.message).join('; '));
}
const FORMATS = formatCatalogue({ grid: { w: 600, h: 400 } });
const SIZES: Readonly<Record<string, number>> = { titulo: 32, apelo: 24, nota: 16 };

/**
 * A template that hands its three blocks to the column and does nothing else. It adopts `peso`,
 * `tamanho`, `espaco` and `distancia` the way any template does: the manifest declares them and
 * each entry spreads `scalesOf` its slot (TYTO-853).
 */
const columnTemplate: Template = defineTemplate(parsedManifest.value, (context) => {
  const entries: ColumnEntry[] = ['titulo', 'apelo', 'nota'].map((name) => ({
    name,
    ...scalesOf(context.slots[name]),
    build: (area, scale) => {
      const value = context.slots[name]?.value;
      if (value?.kind !== 'rich-text' || value.text.length === 0) return undefined;
      const style = {
        font: font('Test'),
        size: SIZES[name]! * scale,
        weight: 400,
        color: '#202020',
      };
      return grownTextBlock(value.text, area.width, 0, style, context.measure, {
        name,
        align: 'center',
        lineHeight: 1.25,
      });
    },
  }));
  const column = blockColumn(
    { width: 520, height: 320 },
    { entries, order: context.order, parameters: { gap: 12 }, name: 'coluna' },
  );
  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children: [at(40, 40, column.block)],
  });
});

/** Each artwork's text nodes by name, with their top in the frame, top to bottom. */
function textsOf(scene: Scene, artwork: number): [string, number][] {
  const found: [string, number][] = [];
  const walk = (nodes: readonly SceneNode[], y: number): void => {
    for (const node of nodes) {
      const top = y + node.transform.y;
      if (node.kind === 'text') found.push([node.name ?? '', top]);
      if (node.kind === 'group') walk(node.children, top);
    }
  };
  walk(scene.artworks[artwork]?.frames[0]?.children ?? [], 0);
  return found.sort((left, right) => left[1] - right[1]);
}

describe('the column, through the real compile', async () => {
  const compiled = await compileTemplate({
    brief: columnBrief,
    template: columnTemplate,
    formats: FORMATS,
    faces,
  });
  if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
  const { scene } = compiled.value;

  it('draws a slide’s blocks in the order the brief wrote them', () => {
    expect(textsOf(scene, 0).map(([name]) => name)).toEqual(['titulo', 'nota', 'apelo']);
  });

  it('draws a shared note below a slide that wrote none of its own', () => {
    expect(textsOf(scene, 1).map(([name]) => name)).toEqual(['titulo', 'apelo', 'nota']);
  });

  it('builds each block at its peso', () => {
    const sizes = (artwork: number) =>
      Object.fromEntries(
        (scene.artworks[artwork]?.frames[0]?.children ?? []).flatMap(function sizesOf(
          node: SceneNode,
        ): [string, number][] {
          if (node.kind === 'group') return node.children.flatMap(sizesOf);
          if (node.kind !== 'text') return [];
          const run = node.runs.find((each) => each.kind === 'text');
          return run === undefined ? [] : [[node.name ?? '', run.size]];
        }),
      );
    expect(sizes(0)).toEqual({ titulo: 32 * 1.2, nota: 16, apelo: 24 * 0.85 });
    expect(sizes(1)).toEqual({ titulo: 32 * 1.2, apelo: 24, nota: 16 });
  });

  it('draws both slides as committed', async () => {
    const svg = exportSvg(scene, { resources: { font: placeholderFont } });
    if (!svg.ok) throw new Error(svg.error.map((item) => item.message).join('; '));
    for (const [index, item] of svg.value.entries()) {
      await expect(item.svg).toMatchFileSnapshot(
        `./__snapshots__/column/lamina-${String(index + 1)}.grid.svg`,
      );
    }
  });
});

describe('tamanho and distancia, through the real compile (TYTO-853)', async () => {
  const compiled = await compileTemplate({
    brief: distanceBrief,
    template: columnTemplate,
    formats: FORMATS,
    faces,
  });
  if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
  const { scene } = compiled.value;
  const control = await compileTemplate({
    brief: distanceBrief.replace(/ \{[^}]*\}/gu, ''),
    template: columnTemplate,
    formats: FORMATS,
    faces,
  });
  if (!control.ok) throw new Error(control.error.map((item) => item.message).join('; '));

  /** The room between the bottom of one text and the top of the next, by their tops. */
  const tops = (of: Scene): number[] => textsOf(of, 0).map(([, top]) => top);

  it('takes the adjustments the manifest declares, and the control none', () => {
    expect(textsOf(scene, 0).map(([name]) => name)).toEqual(['titulo', 'apelo', 'nota']);
    expect(tops(scene)).not.toEqual(tops(control.value.scene));
  });

  it('draws the title at its tamanho, 2 times its size', () => {
    const run = (of: Scene): number | undefined => {
      const walk = (nodes: readonly SceneNode[]): number | undefined => {
        for (const node of nodes) {
          if (node.kind === 'text' && node.name === 'titulo') {
            const first = node.runs.find((each) => each.kind === 'text');
            return first?.kind === 'text' ? first.size : undefined;
          }
          if (node.kind === 'group') {
            const found = walk(node.children);
            if (found !== undefined) return found;
          }
        }
        return undefined;
      };
      return walk(of.artworks[0]?.frames[0]?.children ?? []);
    };
    expect([run(scene), run(control.value.scene)]).toEqual([64, 32]);
  });

  it('leaves no room above the offer written {distancia: 1}, and twice the gap above the note', () => {
    // The title is one line of 64 × 1.25; the offer one of 24 × 1.25, then 2 × 12 above the note.
    const [titulo, apelo, nota] = tops(scene);
    expect(apelo! - titulo!).toBeCloseTo(64 * 1.25, 5);
    expect(nota! - apelo!).toBeCloseTo(24 * 1.25 + 24, 5);
  });
});

/* -------------------------------------------------------------- the height limit -- */

describe('a group taller than its area (TYTO-825)', () => {
  // 100 + 100 of blocks and a 20 gap: 220 at full size.
  const entries = [entry('titulo', 100), entry('apelo', 100)];
  const gap = { gap: 20 };

  it('shrinks every block by the one largest factor that fits, the gaps kept', () => {
    const column = blockColumn({ width: 100, height: 180 }, { entries, parameters: gap });
    // 200 × f + 20 = 180 → f = 0.8.
    expect(column.shrink).toBeCloseTo(0.8, 2);
    expect(column.placed.map((item) => item.scale)).toEqual([column.shrink, column.shrink]);
    expect(column.placed[1]!.top - column.placed[0]!.top - column.placed[0]!.height).toBeCloseTo(
      20,
      5,
    );
    expect(column.overflow).toBe(0);
    expect(column.rise).toBe(0);
  });

  it('shrinks each block from its own weight', () => {
    const column = blockColumn(
      { width: 100, height: 180 },
      { entries: [entry('titulo', 100, 1.2), entry('apelo', 100)], parameters: gap },
    );
    const [titulo, apelo] = column.placed;
    expect(titulo!.scale / apelo!.scale).toBeCloseTo(1.2, 5);
    expect(column.overflow).toBe(0);
  });

  it('stops at the floor, then reaches above its top, then reports what is left', () => {
    // At the floor 0.7: 140 + 20 = 160 in an area of 100. Reach 40: room 140; 20 left over.
    const column = blockColumn(
      { width: 100, height: 100 },
      { entries, parameters: { ...gap, reach: 40 } },
    );
    expect(column.shrink).toBe(0.7);
    expect(column.rise).toBe(40);
    expect(column.block.height).toBe(140);
    expect(column.overflow).toBeCloseTo(20, 5);
  });

  it('reaches only as far as it needs', () => {
    // At the floor: 160 in 150, reach 40 → rises 10 and fits.
    const column = blockColumn(
      { width: 100, height: 150 },
      { entries, parameters: { ...gap, reach: 40 } },
    );
    expect(column.shrink).toBe(0.7);
    expect(column.rise).toBeCloseTo(10, 5);
    expect(column.overflow).toBe(0);
  });

  it('does not shrink a group that fits, nor an unbounded one', () => {
    const fits = blockColumn({ width: 100, height: 300 }, { entries, parameters: gap });
    const unbounded = blockColumn({ width: 100, height: Infinity }, { entries, parameters: gap });
    expect([fits.shrink, unbounded.shrink, fits.rise, unbounded.rise]).toEqual([1, 1, 0, 0]);
  });
});

/* ----------------------------------------------------------------- the main line -- */

describe('the main line filling its width (TYTO-825)', () => {
  // The arithmetic face: a character is half the size wide, so "ABCDEFGHIJ" at 20 is 100 wide.
  const measureEven: Measure = (node) => {
    const runs = node.runs.filter((run) => run.kind === 'text');
    const width = runs.reduce((sum, run) => sum + run.text.length * 0.5 * run.size, 0);
    const height = Math.max(0, ...runs.map((run) => run.size));
    return { runs: node.runs, lines: 1, width, height, scale: 1, overflow: 0 };
  };
  const look = (part: LevelPart): LevelLook => ({
    style: { font: font('Test'), size: part.level === 1 ? 20 : 10, weight: 400, color: '#000' },
  });
  const head = (text: string) => levelsOf(richTextOfPlain(text));

  it('grows the # part until it fills the width', () => {
    // 100 wide at 20 in an area 150 wide: 1.5.
    expect(
      mainLineScale(
        { width: 150, height: Infinity },
        { items: head('# ABCDEFGHIJ'), look, measure: measureEven },
      ),
    ).toBeCloseTo(1.5, 5);
  });

  it('keeps the scale between the minimum and the maximum', () => {
    const wide = mainLineScale(
      { width: 1000, height: Infinity },
      { items: head('# ABCDEFGHIJ'), look, measure: measureEven },
    );
    const narrow = mainLineScale(
      { width: 10, height: Infinity },
      { items: head('# ABCDEFGHIJ'), look, measure: measureEven },
    );
    expect([wide, narrow]).toEqual([1.6, 0.7]);
  });

  it('measures the words as drawn, transformed', () => {
    const doubled: (part: LevelPart) => LevelLook = (part) => ({
      ...look(part),
      transform: (words) => [...words, ...words],
    });
    // Twice the words: 200 wide, so 0.75 fills 150.
    expect(
      mainLineScale(
        { width: 150, height: Infinity },
        { items: head('# ABCDEFGHIJ'), look: doubled, measure: measureEven },
      ),
    ).toBeCloseTo(0.75, 5);
  });

  it('lowers the scale until the head fits its height cap', () => {
    // The head is 100 tall per unit of scale; the cap is 120, so 1.2 rather than 1.5.
    const scale = mainLineScale(
      { width: 150, height: 120 },
      { items: head('# ABCDEFGHIJ'), look, measure: measureEven, heightAt: (scale) => 100 * scale },
    );
    expect(scale).toBeCloseTo(1.2, 2);
    expect(100 * scale).toBeLessThanOrEqual(120);
  });

  it('never goes below the minimum for the cap', () => {
    const scale = mainLineScale(
      { width: 150, height: 10 },
      { items: head('# ABCDEFGHIJ'), look, measure: measureEven, heightAt: (scale) => 100 * scale },
    );
    expect(scale).toBe(0.7);
  });

  it('is 1 for a head with no # part, or when nothing measures', () => {
    expect(
      mainLineScale(
        { width: 150, height: Infinity },
        { items: head('## ABCDEFGHIJ'), look, measure: measureEven },
      ),
    ).toBe(1);
    expect(
      mainLineScale(
        { width: 150, height: Infinity },
        { items: head('# ABCDEFGHIJ'), look, measure: () => undefined },
      ),
    ).toBe(1);
  });

  it('reads its bounds from its parameters', () => {
    expect(parameterValues(MAIN_LINE_FIT_PARAMETERS)).toEqual({ minScale: 0.7, maxScale: 1.6 });
    expect(
      mainLineScale(
        { width: 1000, height: Infinity },
        { items: head('# ABCDEFGHIJ'), look, measure: measureEven, parameters: { maxScale: 2 } },
      ),
    ).toBe(2);
  });
});
