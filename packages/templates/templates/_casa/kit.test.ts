import { measureNothing, noBrandKit, noFiles, reportNothing } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { build as agendaSemana } from '../agenda-semana/template.js';
import { build as aprovados } from '../aprovados/template.js';
import { build as bannerRoxo } from '../banner-roxo/template.js';
import { build as simuladosOcre } from '../simulados-semana-ocre/template.js';
import { build as simuladosRoxo } from '../simulados-semana-roxo/template.js';
import { build as simuladosVinho } from '../simulados-semana-vinho/template.js';
import { build as tabelaRoxo } from '../tabela-roxo/template.js';
import { PLACEHOLDER_LOGO, PLACEHOLDER_SIGNATURE } from './marks.js';

import type {
  BrandKit,
  Inline,
  RichText,
  SceneNode,
  TemplateBuild,
  TemplateContext,
} from '@tyto/core';

/**
 * Every built-in template of the house draws its brand kit's logo and signature, and the
 * placeholders where the kit leaves either out (ADR 0065). The kit here is invented: a
 * triangle and a line nobody signs with.
 */

const TEST_LOGO = 'M0,50L50,0L100,50Z';
const TEST_SIGNATURE = '@kit-de-teste';
const TEST_KIT: BrandKit = {
  logo: { box: { w: 100, h: 50 }, d: TEST_LOGO, fillRule: 'nonzero' },
  signature: TEST_SIGNATURE,
};

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
  readonly format: string;
  readonly size: { readonly w: number; readonly h: number };
  readonly slots: Readonly<Record<string, string>>;
  /** Whether the piece signs off with the kit's signature, rather than a line of its own. */
  readonly signs: boolean;
}

const LAMINA = 'Domingo 25/10 | Aplicação às 08h30\n1º Simulado';
const PORTRAIT = { w: 1080, h: 1350 };

const CASES: readonly Case[] = [
  {
    name: 'agenda-semana',
    build: agendaSemana,
    format: 'grid',
    size: PORTRAIT,
    slots: { lamina: 'FARMÁCIA\n16/09 - 14:00 | Farmacologia | Profª. Marcela Rocha' },
    signs: true,
  },
  {
    name: 'aprovados',
    build: aprovados,
    format: 'grid',
    size: PORTRAIT,
    slots: { lamina: 'ENDODONTIA\n1º | Ana Souza' },
    signs: true,
  },
  {
    name: 'simulados-semana-ocre',
    build: simuladosOcre,
    format: 'grid',
    size: PORTRAIT,
    slots: { titulo: 'TÍTULO', lamina: LAMINA },
    signs: true,
  },
  {
    name: 'simulados-semana-vinho',
    build: simuladosVinho,
    format: 'grid',
    size: PORTRAIT,
    slots: { titulo: 'TÍTULO', lamina: LAMINA },
    signs: true,
  },
  {
    name: 'tabela-roxo',
    build: tabelaRoxo,
    format: 'grid',
    size: PORTRAIT,
    slots: { titulo: 'TÍTULO', tabela: 'Concurso | Vagas\nTribunal | 10' },
    signs: true,
  },
  {
    name: 'banner-roxo',
    build: bannerRoxo,
    format: 'banner',
    size: { w: 1200, h: 628 },
    slots: { titulo: 'Curso de teste' },
    signs: false,
  },
];

function draw(each: Case, kit: BrandKit): SceneNode[] {
  const slots: TemplateContext['slots'] = Object.fromEntries(
    Object.entries(each.slots).map(([name, source]) => [
      name,
      { name, value: { kind: 'rich-text', text: rich(source) }, adjustments: [] },
    ]),
  );
  return walk(
    each.build({
      format: each.format,
      size: each.size,
      idPrefix: `artwork-0-${each.format}`,
      artwork: { id: 'artwork-0', index: 0, count: 1 },
      slots,
      adjustments: {},
      measure: measureNothing,
      report: reportNothing,
      files: noFiles,
      brand: kit,
    }).children,
  );
}

function walk(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) => (node.kind === 'group' ? [node, ...walk(node.children)] : [node]));
}

function logoPaths(nodes: readonly SceneNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'vector' && node.name === 'logo' && node.geometry.kind === 'path'
      ? [node.geometry.d]
      : [],
  );
}

function signatures(nodes: readonly SceneNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'text' && node.name === 'signature'
      ? [node.runs.map((run) => (run.kind === 'text' ? run.text : '')).join('')]
      : [],
  );
}

describe.each(CASES)('$name', (each) => {
  it('draws the kit’s logo and, where it signs, the kit’s signature', () => {
    const nodes = draw(each, TEST_KIT);

    expect(logoPaths(nodes)).toEqual([TEST_LOGO]);
    expect(signatures(nodes)).toEqual(each.signs ? [TEST_SIGNATURE] : []);
  });

  it('draws the placeholders when no kit is installed', () => {
    const nodes = draw(each, noBrandKit);

    expect(logoPaths(nodes)).toEqual([PLACEHOLDER_LOGO.d]);
    expect(signatures(nodes)).toEqual(each.signs ? [PLACEHOLDER_SIGNATURE] : []);
  });

  it('takes each field on its own: a kit with a signature only still gets the placeholder logo', () => {
    const nodes = draw(each, { signature: TEST_SIGNATURE });

    expect(logoPaths(nodes)).toEqual([PLACEHOLDER_LOGO.d]);
    expect(signatures(nodes)).toEqual(each.signs ? [TEST_SIGNATURE] : []);
  });
});

describe('simulados-semana-roxo', () => {
  it('signs its story with its own note, kit or no kit, and draws no logo there', () => {
    const story = {
      name: 'simulados-semana-roxo',
      build: simuladosRoxo,
      format: 'story',
      size: { w: 1080, h: 1920 },
      slots: { titulo: 'TÍTULO', lamina: LAMINA },
      signs: false,
    };
    const nodes = draw(story, TEST_KIT);

    expect(logoPaths(nodes)).toEqual([]);
    expect(signatures(nodes)).toEqual([]);
    expect(nodes.some((node) => node.kind === 'text' && node.name === 'note')).toBe(true);
  });
});
