import { describe, expect, it } from 'vitest';

import { build } from './template.js';
import { fields, lines, plain } from './rich-text.js';
import { ARROW, INK, OWL } from './tokens.js';

import { measureNothing } from '@tyto/core';

import type { Inline, RichText, SceneNode, TemplateContext } from '@tyto/core';

/**
 * What the first TypeScript template is checked against.
 *
 * `build` is a pure function of its context, so these call it directly and read the frame
 * it returns. What they deliberately do **not** do is measure: `compile` is where text is
 * laid out against the faces, so the claim "nothing runs past its box" belongs to
 * `tools/contract-test`, which has the fonts. Asserting it here would assert it against a
 * measurement that never happened, which is the emptiest kind of green.
 */

/* ---------------------------------------------------------------------- the fixture -- */

let cursor = 0;

/** A plain-text inline with a range nobody has to count out by hand. */
function span(value: string): Inline {
  const start = cursor;
  cursor += value.length;
  return { kind: 'text', value, range: { start, end: cursor } };
}

/**
 * Rich text from a string, with `\n` becoming the `Break` the language produces between
 * two lines of an indented block (`docs/brief-language.md`).
 */
function rich(source: string): RichText {
  const parts: Inline[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) parts.push({ kind: 'break', range: { start: cursor, end: cursor++ } });
    parts.push(span(line));
  }
  return parts;
}

function bold(value: string): Inline {
  const children = [span(value)];
  return { kind: 'bold', children, range: children[0]!.range };
}

interface ContextOptions {
  readonly slide: RichText;
  readonly index?: number;
  readonly count?: number;
  readonly titulo?: RichText;
}

function contextOf(options: ContextOptions): TemplateContext {
  const index = options.index ?? 0;
  const titulo = options.titulo ?? rich('AGENDA DA SEMANA');

  return {
    format: 'retrato',
    size: { w: 1080, h: 1350 },
    idPrefix: `artwork-${index}-retrato`,
    artwork: { id: `artwork-${index}`, index, count: options.count ?? 1 },
    slots: {
      titulo: { name: 'titulo', value: { kind: 'rich-text', text: titulo }, adjustments: [] },
      slide: { name: 'slide', value: { kind: 'rich-text', text: options.slide }, adjustments: [] },
    },
    adjustments: {},
    // A pure function of its context, called directly: no faces, so nothing measures.
    measure: measureNothing,
  };
}

/** The reference slide of 2026-09-22: two disciplines of two sessions each. */
const REFERENCE = [
  'FARMÁCIA',
  '16/09 - 14:00 | Farmacologia Geral | Profª. Rafaela Gomes',
  '17/09 - 14:00 | Maratonando com questões sobre Ensaios Farmacopeicos | Profª. Sonia Dourado',
  'SERVIÇO SOCIAL',
  '15/09 - 19:00 | Serviço Social no âmbito hospitalar | Profª. Nilza Ciciliati',
  '16/09 - 19:00 | Sistema de Garantia dos Direitos da Criança e do Adolescente | Profª. Coimbra Almeida',
].join('\n');

/* ----------------------------------------------------------------------- the walker -- */

function walk(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) => (node.kind === 'group' ? [node, ...walk(node.children)] : [node]));
}

const named = (nodes: readonly SceneNode[], name: string) =>
  walk(nodes).filter((node) => node.name === name);

/** The words of a node, joined, so an assertion can name what it expects to read. */
function words(node: SceneNode | undefined): string {
  if (node?.kind !== 'text') return '';
  return node.runs
    .map((run) => (run.kind === 'text' ? run.text : '\n'))
    .join('')
    .trim();
}

/* ------------------------------------------------------------------------- the slot -- */

describe('one slot read as a small table', () => {
  it('keeps a line with no separator whole, which is how a heading is told apart', () => {
    const [heading, session] = lines(
      rich('FARMÁCIA\n16/09 - 14:00 | Farmacologia | Profª. Rafaela'),
    );

    expect(fields(heading ?? [])).toHaveLength(1);
    expect(fields(session ?? []).length).toBeGreaterThan(1);
  });

  it('drops a blank line rather than reading it as a session with no fields', () => {
    expect(lines(rich('Pediatria\n\n27/09 | Febre | Dra. Lúcia'))).toHaveLength(2);
  });

  it('splits a line into date, title and professor, without the spaces around the bars', () => {
    const [line] = lines(rich('22/09 | Insuficiência cardíaca | Dra. Helena Prado'));

    expect(fields(line ?? [], 3).map(plain)).toEqual([
      '22/09',
      'Insuficiência cardíaca',
      'Dra. Helena Prado',
    ]);
  });

  it('leaves a bar in the last field, because the limit stops the split and not the text', () => {
    const [line] = lines(rich('22/09 | Revisão | Dra. Helena | Dr. Vitor'));

    expect(fields(line ?? [], 3).map(plain)).toEqual([
      '22/09',
      'Revisão',
      'Dra. Helena | Dr. Vitor',
    ]);
  });

  it('never splits inside emphasis, where a bar is the author doing something else', () => {
    const line: RichText = [span('22/09 | '), bold('Revisão | final'), span(' | Dra. Helena')];

    expect(fields(line, 3).map(plain)).toEqual(['22/09', 'Revisão | final', 'Dra. Helena']);
  });
});

/* ------------------------------------------------------------------- what it draws -- */

describe('several disciplines on one slide (TYTO-173)', () => {
  it('draws both of the reference slide’s disciplines in one frame, in order', () => {
    const frame = build(contextOf({ slide: rich(REFERENCE) }));

    expect(named(frame.children, 'discipline').map(words)).toEqual(['FARMÁCIA', 'SERVIÇO SOCIAL']);
  });

  it('gives each discipline the sessions written under it, and no one else’s', () => {
    const frame = build(
      contextOf({
        slide: rich('A\n01/01 | um | x\nB\n02/01 | dois | y\n03/01 | três | z\n04/01 | quatro | w'),
      }),
    );

    expect(named(frame.children, 'eventos').map((node) => named([node], 'session').length)).toEqual(
      [1, 3],
    );
  });

  it('counts the disciplines from the brief, one to as many as it wrote', () => {
    for (const count of [1, 2, 3]) {
      const source = Array.from({ length: count }, (_, i) => `D${i}\n01/01 | t | p`).join('\n');
      const frame = build(contextOf({ slide: rich(source) }));

      expect(named(frame.children, 'discipline-block'), source).toHaveLength(count);
    }
  });

  it('draws sessions written before any heading, under no heading, rather than dropping them', () => {
    const frame = build(contextOf({ slide: rich('01/01 | Aula solta | Prof. X') }));

    expect(named(frame.children, 'session')).toHaveLength(1);
    expect(named(frame.children, 'discipline')).toEqual([]);
  });

  it('asks for the long title to shrink rather than to be reported', () => {
    const frame = build(contextOf({ slide: rich(REFERENCE) }));
    const titles = named(frame.children, 'session-title');

    const longest = titles.find((node) => words(node).startsWith('Sistema de Garantia'));
    expect(longest?.kind === 'text' ? longest.overflow : undefined).toBe('shrink');
  });
});

describe('the cover', () => {
  const slide = rich('FARMÁCIA\n16/09 - 14:00 | Farmacologia | Profª. Rafaela');

  it('is drawn on the first slide', () => {
    const frame = build(contextOf({ slide, index: 0, count: 3 }));

    expect(words(named(frame.children, 'cover-title')[0])).toBe('AGENDA DA SEMANA');
  });

  it('is drawn on no other slide, and the brief never said so', () => {
    for (const index of [1, 2]) {
      const frame = build(contextOf({ slide, index, count: 3 }));

      expect(named(frame.children, 'cover-title'), `slide ${index}`).toEqual([]);
    }
  });

  it('keeps the disciplines a fixed gap under the cover, centred together as one block', () => {
    const frame = build(contextOf({ slide, index: 0, count: 2 }));
    const [middle] = named(frame.children, 'middle');

    if (middle?.kind !== 'group') throw new Error('the first slide centres a middle block');
    // Cover first, disciplines second, and nothing else: the gap between them is the
    // stack's, not whatever room the centring happened to leave.
    expect(middle.children.map((node) => node.name)).toEqual(['cover', 'disciplinas']);
  });

  it('takes the space with it: without a cover the disciplines alone are the middle', () => {
    const frame = build(contextOf({ slide, index: 1, count: 2 }));

    expect(named(frame.children, 'middle')).toEqual([]);
    expect(frame.children.map((node) => node.name)).toContain('disciplinas');
  });

  it('draws no illustration when the brief supplied none', () => {
    const frame = build(contextOf({ slide }));

    expect(named(frame.children, 'calendar')).toEqual([]);
  });
});

describe('the sessions', () => {
  it('stacks them, so the second row sits a whole row below the first', () => {
    const frame = build(contextOf({ slide: rich(REFERENCE) }));

    const [first, second] = named(frame.children, 'session');

    expect(second?.transform.y).toBeGreaterThan(first?.transform.y ?? 0);
  });

  it('draws the date on top of the grey pill, which runs under it from the left edge', () => {
    const frame = build(contextOf({ slide: rich(REFERENCE) }));
    const [row] = named(frame.children, 'session');

    if (row?.kind !== 'group') throw new Error('a session is a group');
    // Painted last, so it covers the grey pill's rounded left end — the two read as one.
    expect(row.children.map((node) => node.name)).toEqual(['session-pill', 'date-pill']);
    expect(row.children.every((node) => node.transform.x === 0)).toBe(true);
  });

  it('draws a session with no professor without drawing an empty text node', () => {
    const frame = build(contextOf({ slide: rich('Pediatria\n27/09 | Febre sem foco') }));

    expect(named(frame.children, 'session-title').map(words)).toEqual(['Febre sem foco']);
    expect(named(frame.children, 'professor')).toEqual([]);
    // The pill is still there and still its full height: a missing field moves nothing.
    expect(named(frame.children, 'session-pill')).toHaveLength(1);
  });
});

describe('the marks the template holds the geometry of', () => {
  const frame = build(contextOf({ slide: rich('Pediatria\n27/09 | Febre | Dra. Lúcia') }));

  it.each([
    ['owl', OWL],
    ['arrow', ARROW],
  ])('draws %s as a path with a fill the template supplied', (name, token) => {
    const [node] = named(frame.children, name);

    expect(node?.kind).toBe('vector');
    if (node?.kind !== 'vector') return;

    expect(node.geometry).toEqual({ kind: 'path', d: token.d, fillRule: token.fillRule });
    // The colour is the template's, not the file's: neither token carries one.
    expect(node.fill).toEqual({ kind: 'solid', color: hexToColor(INK) });
  });

  it.each([
    ['owl', OWL, 64],
    ['arrow', ARROW, 26],
  ])(
    "sizes %s as the box its 'd' was drawn in, and scales with a transform",
    (name, token, drawn) => {
      const [node] = named(frame.children, name);

      if (node?.kind !== 'vector') throw new Error(`${name} is not a vector`);

      // The regression this pins: `size` is the viewport `export-html` writes as the
      // `viewBox`, so a *drawn* size here clips the geometry to a fraction of itself and
      // nothing warns. Caught by looking at a render, not by a test that did not exist.
      expect(node.size).toEqual(token.box);
      expect(node.transform.scaleX).toBeCloseTo(node.transform.scaleY);
      expect(node.transform.scaleY * node.size.h).toBeCloseTo(drawn);
    },
  );
});

describe('the frame itself', () => {
  const slide = rich('Pediatria\n27/09 | Febre | Dra. Lúcia');

  it('draws the portrait format at the size the context gave it', () => {
    const context = contextOf({ slide });
    const frame = build(context);

    expect(frame.size).toEqual(context.size);
    expect(frame.format).toBe('retrato');
  });

  it('namespaces its ids with the prefix the context supplied', () => {
    const context = contextOf({ slide, index: 2 });

    expect(build(context).children.every((node) => node.id.startsWith(context.idPrefix))).toBe(
      true,
    );
  });

  it('signs every slide, cover or no cover', () => {
    for (const index of [0, 1, 2]) {
      const frame = build(contextOf({ slide, index, count: 3 }));

      expect(words(named(frame.children, 'handle')[0]), `slide ${index}`).toBe('@estrategia.saude');
      expect(named(frame.children, 'owl'), `slide ${index}`).toHaveLength(1);
    }
  });
});

/** `#rrggbb` as the colour a solid paint holds, so the test states the token and not RGB. */
function hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: 1 };
}
