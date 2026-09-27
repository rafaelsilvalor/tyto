import { measureNothing } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { APPROVED } from '../_estrategia-saude/tokens.js';
import { build } from './template.js';

import type { AssetRef, Inline, RichText, SceneNode, TemplateContext } from '@tyto/core';

/**
 * `aprovados` is composition only (ADR 0039), so what is checked here is that it composes:
 * the right pieces, in the right order, fed from the right slots. The pixels were matched
 * against the maintainer's reference of 2026-09-27 in the live preview (TYTO-185), and the
 * pieces themselves are tested where they live — the kit and the Saúde presets.
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

function contextOf(
  slots: Record<string, RichText | AssetRef>,
  measure: TemplateContext['measure'] = measureNothing,
): TemplateContext {
  return {
    format: 'retrato',
    size: { w: 1080, h: 1350 },
    idPrefix: 'artwork-0-retrato',
    artwork: { id: 'artwork-0', index: 0, count: 1 },
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
  subtitulo: rich('Mais um dia difícil para quem não é Coruja'),
  titulo: rich('CADAR'),
  lista: rich(LIST),
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
    const frame = build(contextOf({ ...FULL, lista: long }, tenPerCharacter));
    const [list] = named(frame.children, 'approved');

    expect(list?.transform.x).toBe((1080 - 70 * 2 - APPROVED.table.max) / 2);
  });

  it('draws no emblem when the brief supplied none, and one when it did', () => {
    expect(named(build(contextOf(FULL)).children, 'emblem')).toEqual([]);

    const asset = { kind: 'file', path: 'emblema.png' } as unknown as AssetRef;
    expect(named(build(contextOf({ ...FULL, emblema: asset })).children, 'emblem')).toHaveLength(1);
  });

  it('signs the slide without an arrow, since no slide follows it', () => {
    const frame = build(contextOf(FULL));

    expect(named(frame.children, 'handle').map(words)).toEqual(['@estrategia.saude']);
    expect(named(frame.children, 'arrow')).toEqual([]);
  });
});
