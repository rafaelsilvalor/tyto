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
import { describe, expect, it } from 'vitest';

import { type Block, at, sized } from './blocks.js';
import {
  type BlockOfKind,
  type ColumnEntry,
  type OrderedBlock,
  blockColumn,
  entriesInOrder,
  weightOf,
} from './column.js';
import { compileTemplate } from './testing.js';
import { grownTextBlock } from './text.js';

/**
 * TYTO-839 (ADR 0227): the column holds one entry per placed block of `context.order`, so two
 * `::corpo`, or a shared title and a slide's own, are two blocks in the brief's order, each at
 * its own `peso`.
 */

function box(name: string, height: number): Block {
  return sized(rect({ name, size: { w: 100, h: height }, fill: solid('#000000') }));
}

/** A placed block whose value is `text`, with `peso` when given. */
function placed(name: string, text: string, peso?: string): OrderedBlock {
  return {
    name,
    slot: {
      value: {
        kind: 'rich-text',
        text: [{ kind: 'text', value: text, range: { start: 0, end: 0 } }],
      },
      adjustments: peso === undefined ? [] : [{ name: 'peso', value: peso }],
    },
  };
}

/** A kind whose block is named after the placed text and is 10 tall at scale 1. */
const kind: BlockOfKind = (slot) => {
  const text =
    slot.value.kind === 'rich-text'
      ? slot.value.text.map((inline) => (inline.kind === 'text' ? inline.value : '')).join('')
      : '';
  return { scale: weightOf(slot), build: (_area, scale) => box(text, 10 * scale) };
};

const namesOf = (entries: readonly ColumnEntry[]): string[] =>
  entries.map((entry) => {
    const built = entry.build({ width: 100, height: 100 }, entry.scale ?? 1);
    return `${entry.name}:${built?.draft.name ?? '?'}@${String(entry.scale ?? 1)}`;
  });

describe('entries one per placed block', () => {
  it('gives two blocks of one kind two entries, in order, each at its own peso', () => {
    const entries = entriesInOrder(
      [placed('corpo', 'Vagas', '2'), placed('corpo', 'Salário', '4')],
      { corpo: kind },
    );

    expect(namesOf(entries)).toEqual(['corpo:Vagas@0.85', 'corpo:Salário@1.2']);
  });

  it('puts the placed blocks where the template’s own entries of those names stood', () => {
    const logo: ColumnEntry = { name: 'logo', build: () => box('logo', 5) };
    const entries = entriesInOrder(
      [placed('titulo', 'A'), placed('corpo', 'B'), placed('corpo', 'C')],
      { titulo: kind, corpo: kind },
      [
        { name: 'titulo', build: () => undefined },
        logo,
        { name: 'corpo', build: () => undefined },
        { name: 'selo', build: () => box('selo', 5) },
      ],
    );

    // The second body has no place of its own: it comes right after the last one, before 'selo'.
    expect(namesOf(entries)).toEqual([
      'titulo:A@1',
      'logo:logo@1',
      'corpo:B@1',
      'corpo:C@1',
      'selo:selo@1',
    ]);
  });

  it('leaves out a placed block no kind builds', () => {
    expect(
      namesOf(entriesInOrder([placed('extra', 'X'), placed('corpo', 'B')], { corpo: kind })),
    ).toEqual(['corpo:B@1']);
  });

  it('falls back to the template’s order when the order carries no values', () => {
    const fallback = [
      { name: 'titulo', build: () => box('t', 10) },
      { name: 'corpo', build: () => box('c', 10) },
    ];
    const entries = entriesInOrder(
      [{ name: 'corpo' }, { name: 'titulo' }],
      { corpo: kind },
      fallback,
    );

    expect(entries.map((entry) => entry.name)).toEqual(['corpo', 'titulo']);
  });
});

/* ------------------------------------------------------------- through the compile -- */

const EVEN: Face = { advance: (text) => text.length * 0.5, contentHeight: 1.2 };
const faces: FaceCache = { get: (face) => (face.family === 'Test' ? EVEN : undefined) };

const parsedManifest = parseManifest(
  `name: coluna-blocos
version: 1.0.0
formats: [grid]
slots:
  titulo: { type: rich-text, per: lamina, shared: true }
  corpo: { type: rich-text, per: lamina, shared: true, multiple: true }
  lamina: { type: rich-text, repeat: true, min: 1, max: 5 }
  apelo: { type: rich-text, per: lamina }
adjustments:
  peso: { type: enum, values: ['1', '2', '3', '4', '5'], default: '3', applies: [titulo, corpo, apelo] }
`,
  'manifest.yaml',
);
if (!parsedManifest.ok) {
  throw new Error(parsedManifest.error.map((item) => item.message).join('; '));
}
const FORMATS = formatCatalogue({ grid: { w: 600, h: 600 } });
const SIZES: Readonly<Record<string, number>> = { titulo: 32, corpo: 20, apelo: 24 };

/** Every kind draws its text at its reference size times the column's scale. */
const textKind =
  (name: string, measure: Parameters<typeof grownTextBlock>[4]): BlockOfKind =>
  (slot) => {
    const value = slot.value;
    if (value.kind !== 'rich-text' || value.text.length === 0) return undefined;
    return {
      scale: weightOf(slot),
      build: (area, scale) =>
        grownTextBlock(
          value.text,
          area.width,
          0,
          { font: font('Test'), size: SIZES[name]! * scale, weight: 400, color: '#202020' },
          measure,
          { name, align: 'center', lineHeight: 1.25 },
        ),
    };
  };

const perBlockTemplate: Template = defineTemplate(parsedManifest.value, (context) => {
  const kinds = Object.fromEntries(
    ['titulo', 'corpo', 'apelo'].map((name) => [name, textKind(name, context.measure)]),
  );
  const column = blockColumn(
    { width: 520, height: 520 },
    { entries: entriesInOrder(context.order, kinds), parameters: { gap: 12 }, name: 'coluna' },
  );
  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children: [at(40, 40, column.block)],
  });
});

/** Each artwork's text nodes as `name:words@size`, top to bottom. */
function textsOf(scene: Scene, artwork: number): string[] {
  const found: [string, number][] = [];
  const walk = (nodes: readonly SceneNode[], y: number): void => {
    for (const node of nodes) {
      const top = y + node.transform.y;
      if (node.kind === 'text') {
        const run = node.runs.find((each) => each.kind === 'text');
        const words = node.runs.map((each) => (each.kind === 'text' ? each.text : '')).join('');
        found.push([
          `${node.name ?? ''}:${words}@${String(run?.kind === 'text' ? run.size : 0)}`,
          top,
        ]);
      }
      if (node.kind === 'group') walk(node.children, top);
    }
  };
  walk(scene.artworks[artwork]?.frames[0]?.children ?? [], 0);
  return found.sort((left, right) => left[1] - right[1]).map(([text]) => text);
}

describe('the column per block, through the real compile', async () => {
  const brief = [
    '---',
    'template: coluna-blocos',
    '---',
    '::titulo Concurso',
    '::corpo {nome: vagas, peso: 2}',
    '  Vagas',
    '::corpo {nome: salario, peso: 4}',
    '  Salario',
    '::lamina',
    '::titulo Edital',
    '::corpo {nome: salario}',
    '::apelo Oferta',
    '::corpo {nome: vagas}',
    '::lamina',
    '::apelo Garantia',
    '',
  ].join('\n');
  const compiled = await compileTemplate({
    brief,
    template: perBlockTemplate,
    formats: FORMATS,
    faces,
  });
  if (!compiled.ok) throw new Error(compiled.error.map((item) => item.message).join('; '));
  const { scene } = compiled.value;

  it('draws the shared title and the slide’s own, then the bodies where the slide placed them', () => {
    expect(textsOf(scene, 0)).toEqual([
      'titulo:Concurso@32',
      'titulo:Edital@32',
      'corpo:Salario@24',
      'apelo:Oferta@24',
      'corpo:Vagas@17',
    ]);
  });

  it('draws the shared blocks above a slide that places none, each at its own peso', () => {
    expect(textsOf(scene, 1)).toEqual([
      'titulo:Concurso@32',
      'corpo:Vagas@17',
      'corpo:Salario@24',
      'apelo:Garantia@24',
    ]);
  });
});
