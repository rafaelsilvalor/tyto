import { measureNothing } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { build as agendaSemana } from '../agenda-semana/template.js';
import { build as aprovados } from '../aprovados/template.js';
import { build as simuladosEcj } from '../simulados-semana-ecj/template.js';
import { build as simuladosOab } from '../simulados-semana-oab/template.js';
import { SEAL_HEIGHT } from './seal.js';

import type {
  AssetRef,
  Inline,
  RichText,
  SceneNode,
  TemplateBuild,
  TemplateContext,
} from '@tyto/core';

/**
 * Every template that takes a `selo` makes room for it the same way (TYTO-201): the page
 * shrinks by the seal's height, so the middle, centred on what is left, rises by half of it,
 * and whatever stands on the bottom edge rises by all of it — or, where the sign-off hugs the
 * middle, rises with the middle. The seal itself is glued to the foot of the frame.
 */

const SIZE = { w: 1080, h: 1350 };
const SELO: AssetRef = { id: 'selo', source: 'file', path: 'selo.png', hash: 'abc' };

function rich(source: string): RichText {
  const parts: Inline[] = [];
  let cursor = 0;
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) parts.push({ kind: 'break', range: { start: cursor, end: cursor++ } });
    const start = cursor;
    cursor += line.length;
    parts.push({ kind: 'text', value: line, range: { start, end: cursor } });
  }
  return parts;
}

interface Case {
  readonly name: string;
  readonly build: TemplateBuild;
  readonly lamina: string;
  /** The node that stands at the foot, and how far it rises with the seal. */
  readonly foot: { readonly node: string; readonly rises: number };
}

const CASES: readonly Case[] = [
  {
    name: 'agenda-semana',
    build: agendaSemana,
    lamina: 'FARMÁCIA\n16/09 - 14:00 | Farmacologia | Profª. Rafaela Gomes',
    foot: { node: 'footer', rises: SEAL_HEIGHT },
  },
  {
    name: 'aprovados',
    build: aprovados,
    lamina: 'ENDODONTIA\n1º | Ana Souza',
    foot: { node: 'footer', rises: SEAL_HEIGHT },
  },
  {
    name: 'simulados-semana-ecj',
    build: simuladosEcj,
    lamina: 'Domingo 25/10 | Aplicação às 08h30\n1º Simulado TJ SP',
    foot: { node: 'sign-off', rises: SEAL_HEIGHT / 2 },
  },
  {
    name: 'simulados-semana-oab',
    build: simuladosOab,
    lamina: 'Domingo 20/09 | Aplicação às 08h30\n1º Simulado de 2ª Fase',
    foot: { node: 'sign-off', rises: SEAL_HEIGHT / 2 },
  },
];

function slide(each: Case, selo: AssetRef | undefined, index = 0, count = 1): SceneNode[] {
  const slots: Record<string, unknown> = {
    titulo: { name: 'titulo', value: { kind: 'rich-text', text: rich('TÍTULO') }, adjustments: [] },
    lamina: {
      name: 'lamina',
      value: { kind: 'rich-text', text: rich(each.lamina) },
      adjustments: [],
    },
  };
  if (selo !== undefined) {
    slots['selo'] = { name: 'selo', value: { kind: 'image', asset: selo }, adjustments: [] };
  }
  const context = {
    format: 'grid',
    size: SIZE,
    idPrefix: `lamina-${index}-grid`,
    artwork: { id: `lamina-${index}`, index, count },
    slots,
    adjustments: {},
    measure: measureNothing,
  } as TemplateContext;
  return [...each.build(context).children];
}

function walk(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) => (node.kind === 'group' ? [node, ...walk(node.children)] : [node]));
}

const yOf = (nodes: readonly SceneNode[], name: string) =>
  walk(nodes).find((node) => node.name === name)?.transform.y;

describe.each(CASES)('$name with a selo', (each) => {
  it('glues the seal to the foot of the last slide, the frame’s width', () => {
    const seal = walk(slide(each, SELO)).find((node) => node.name === 'seal');

    expect(seal).toMatchObject({
      kind: 'image',
      asset: SELO,
      size: { w: SIZE.w, h: SEAL_HEIGHT },
      transform: { x: 0, y: SIZE.h - SEAL_HEIGHT },
    });
  });

  it('centres the middle above the seal: it rises by half the seal’s height', () => {
    const without = yOf(slide(each, undefined), 'middle');
    const withSeal = yOf(slide(each, SELO), 'middle');

    expect(without).toBeDefined();
    expect(withSeal).toBe((without ?? 0) - SEAL_HEIGHT / 2);
  });

  it('lifts what stands at the foot, so nothing is drawn under the seal', () => {
    const without = yOf(slide(each, undefined), each.foot.node);
    const withSeal = yOf(slide(each, SELO), each.foot.node);

    expect(withSeal).toBe((without ?? 0) - each.foot.rises);
  });

  it('draws no seal on an earlier slide, and leaves it laid out as if there were none', () => {
    const earlier = slide(each, SELO, 0, 2);

    expect(walk(earlier).some((node) => node.name === 'seal')).toBe(false);
    expect(yOf(earlier, 'middle')).toBe(yOf(slide(each, undefined, 0, 2), 'middle'));
  });
});
