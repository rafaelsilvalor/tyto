import { measureNothing } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { APPROVED } from '../_azul/tokens.js';
import { build } from './template.js';

import type { AssetRef, Inline, RichText, SceneNode, TemplateContext } from '@tyto/core';

/**
 * `aprovados` is composition only (ADR 0047), so what is checked here is that it composes:
 * the right pieces, in the right order, fed from the right slots. The pixels were matched
 * against the maintainer's reference of 2026-09-27 in the live preview (TYTO-185), and the
 * pieces themselves are tested where they live — the kit and the Azul presets.
 */

let cursor = 0;

function rich(source: string): RichText {
  const parts: Inline[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) parts.push({ kind: 'break', range: { start: cursor, end: cursor++ } });
    const start = cursor;
    cursor += line.length;
    parts.push({ kind: 'text', value: line, range: { start, end: cursor } });
  }
  return parts;
}

/** A measure of 10 px a character, one line, 20 px tall: enough to count widths by. */
const tenPerCharacter: TemplateContext['measure'] = (node) => {
  const characters = node.runs.reduce(
    (sum, run) => sum + (run.kind === 'text' ? run.text.length : 0),
    0,
  );
  return { runs: node.runs, lines: 1, width: characters * 10, height: 20, scale: 1, overflow: 0 };
};

const LIST = 'ENDODONTIA\n1º | Ana Souza\n2º | Bruno Lima\nPERIODONTIA\n1º | Carla Dias';

/** Which slide of how many; the first of one when a case does not say. */
interface Slide {
  readonly index: number;
  readonly count: number;
}

function contextOf(
  slots: Record<string, RichText | AssetRef>,
  measure: TemplateContext['measure'] = measureNothing,
  slide: Slide = { index: 0, count: 1 },
): TemplateContext {
  return {
    format: 'grid',
    size: { w: 1080, h: 1350 },
    idPrefix: `lamina-${slide.index}-grid`,
    artwork: { id: `lamina-${slide.index}`, index: slide.index, count: slide.count },
    slots: Object.fromEntries(
      Object.entries(slots).map(([name, value]) => [
        name,
        {
          name,
          value: Array.isArray(value)
            ? { kind: 'rich-text', text: value }
            : { kind: 'image', asset: value },
          adjustments: [],
        },
      ]),
    ) as TemplateContext['slots'],
    adjustments: {},
    measure,
  };
}

function walk(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) => (node.kind === 'group' ? [node, ...walk(node.children)] : [node]));
}

const named = (nodes: readonly SceneNode[], name: string) =>
  walk(nodes).filter((node) => node.name === name);

function words(node: SceneNode | undefined): string {
  if (node?.kind !== 'text') return '';
  return node.runs.map((run) => (run.kind === 'text' ? run.text : '')).join('');
}

const FULL = {
  chamada: rich('Resultado provisório'),
  subtitulo: rich('Mais um dia difícil para quem não é Falcão'),
  titulo: rich('CADAR'),
  lamina: rich(LIST),
};

describe('aprovados', () => {
  it('draws the title block over the list, in that order', () => {
    const frame = build(contextOf(FULL));
    const [middle] = named(frame.children, 'middle');

    if (middle?.kind !== 'group') throw new Error('the slide centres a middle block');
    expect(middle.children.map((node) => node.name)).toEqual(['result-title', 'approved-table']);
    expect(named(frame.children, 'kicker').map(words)).toEqual(['Resultado provisório']);
    expect(named(frame.children, 'exam').map(words)).toEqual(['CADAR']);
  });

  it('reads the list into specialties and places', () => {
    const frame = build(contextOf(FULL));

    expect(named(frame.children, 'specialty').map(words)).toEqual(['ENDODONTIA', 'PERIODONTIA']);
    expect(named(frame.children, 'rank').map(words)).toEqual(['1º Lugar', '2º Lugar', '1º Lugar']);
    expect(named(frame.children, 'name').map(words)).toEqual([
      'ANA SOUZA',
      'BRUNO LIMA',
      'CARLA DIAS',
    ]);
  });

  it('makes every row of a specialty as wide as its longest name, centred on its own', () => {
    // A measure that answers 10 px a character, so the widths are countable.
    const frame = build(contextOf(FULL, tenPerCharacter));
    const lists = named(frame.children, 'approved');

    // BRUNO LIMA (10) is ENDODONTIA's longest name, CARLA DIAS (10) PERIODONTIA's: badge,
    // padding either side of the name, and the name.
    const width = APPROVED.badge.w + APPROVED.padding.left + 100 + APPROVED.padding.right;
    for (const list of lists) {
      expect(list.transform.x).toBe((1080 - 70 * 2 - width) / 2);
    }
  });

  it('stops a list growing at the maximum, where the name wraps instead', () => {
    const long = rich(`ENDODONTIA\n1º | ${'NOME '.repeat(40).trim()}`);
    const frame = build(contextOf({ ...FULL, lamina: long }, tenPerCharacter));
    const [list] = named(frame.children, 'approved');

    expect(list?.transform.x).toBe((1080 - 70 * 2 - APPROVED.table.max) / 2);
  });

  it('draws no emblem when the brief supplied none, and one when it did', () => {
    expect(named(build(contextOf(FULL)).children, 'emblem')).toEqual([]);

    const asset = { kind: 'file', path: 'emblema.png' } as unknown as AssetRef;
    expect(named(build(contextOf({ ...FULL, imagem: asset })).children, 'emblem')).toHaveLength(1);
  });

  it('signs a single slide without an arrow, since no slide follows it', () => {
    const frame = build(contextOf(FULL));

    expect(named(frame.children, 'handle').map(words)).toEqual(['@assinatura']);
    expect(named(frame.children, 'arrow')).toEqual([]);
  });
});

describe('aprovados across several slides (TYTO-190)', () => {
  const slides = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      build(contextOf(FULL, measureNothing, { index, count })),
    );

  it('draws the title block on the first slide and on no other', () => {
    expect(slides(3).map((frame) => named(frame.children, 'result-title').length)).toEqual([
      1, 0, 0,
    ]);
  });

  it('draws the list alone as the middle of every later slide', () => {
    const [, second] = slides(2);
    const [middle] = named(second?.children ?? [], 'middle');

    if (middle?.kind !== 'group') throw new Error('every slide centres a middle block');
    expect(middle.children.map((node) => node.name)).toEqual(['approved-table']);
  });

  it('points on to the next slide from every slide but the last', () => {
    expect(slides(3).map((frame) => named(frame.children, 'arrow').length)).toEqual([1, 1, 0]);
  });

  it('draws each slide from its own lamina', () => {
    const frame = build(
      contextOf({ ...FULL, lamina: rich('PRÓTESE DENTAL\n3º | Leo Moura') }, measureNothing, {
        index: 1,
        count: 2,
      }),
    );

    expect(named(frame.children, 'specialty').map(words)).toEqual(['PRÓTESE DENTAL']);
    expect(named(frame.children, 'name').map(words)).toEqual(['LEO MOURA']);
  });
});
