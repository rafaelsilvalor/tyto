import { describe, expect, it } from 'vitest';

import { build } from './template.js';
import { fields, lines, plain } from './rich-text.js';
import { ARROW, OWL } from './tokens.js';

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
  readonly disciplina: RichText;
  readonly index?: number;
  readonly count?: number;
  readonly titulo?: RichText;
  readonly format?: string;
}

function contextOf(options: ContextOptions): TemplateContext {
  const index = options.index ?? 0;
  const format = options.format ?? 'feed';
  const titulo = options.titulo ?? rich('Agenda da semana');

  return {
    format,
    size: format === 'story' ? { w: 1080, h: 1920 } : { w: 1080, h: 1080 },
    idPrefix: `artwork-${index}-${format}`,
    artwork: { id: `artwork-${index}`, index, count: options.count ?? 1 },
    slots: {
      titulo: { name: 'titulo', value: { kind: 'rich-text', text: titulo }, adjustments: [] },
      disciplina: {
        name: 'disciplina',
        value: { kind: 'rich-text', text: options.disciplina },
        adjustments: [],
      },
    },
    adjustments: {},
  };
}

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
  it('takes the first line as the discipline and the rest as sessions', () => {
    const value = rich(
      'Clínica Médica\n22/09 | Arritmias | Dra. Helena\n24/09 | Choque | Dr. Vitor',
    );

    const [heading, ...sessions] = lines(value);

    expect(plain(heading ?? [])).toBe('Clínica Médica');
    expect(sessions).toHaveLength(2);
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

describe('the cover', () => {
  const disciplina = rich('Clínica Médica\n22/09 | Arritmias | Dra. Helena');

  it('is drawn on the first slide', () => {
    const frame = build(contextOf({ disciplina, index: 0, count: 3 }));

    expect(words(named(frame.children, 'cover-title')[0])).toBe('Agenda da semana');
  });

  it('is drawn on no other slide, and the brief never said so', () => {
    for (const index of [1, 2]) {
      const frame = build(contextOf({ disciplina, index, count: 3 }));

      expect(named(frame.children, 'cover-title'), `slide ${index}`).toEqual([]);
    }
  });

  it('takes the space with it, so the slide below is not a slide with a hole in it', () => {
    const first = build(contextOf({ disciplina, index: 0, count: 2 }));
    const second = build(contextOf({ disciplina, index: 1, count: 2 }));

    // The body group's own y, which is the one coordinate this template writes by hand —
    // and it writes it from the block's measured height, not from a number per format.
    const bodyY = (frame: typeof first) => named(frame.children, 'body')[0]?.transform.y ?? 0;

    // Both are centred between the owl and the handle, so the shorter second slide sits
    // *lower* than the first rather than leaving a hole where the cover used to be.
    expect(bodyY(second)).toBeGreaterThan(bodyY(first));
  });

  it('draws no illustration when the brief supplied none', () => {
    const frame = build(contextOf({ disciplina }));

    expect(named(frame.children, 'calendar')).toEqual([]);
  });
});

describe('the sessions', () => {
  it('counts what the brief wrote, and nothing else counts them', () => {
    for (const [count, source] of [
      [1, 'Pediatria\n27/09 | Febre | Dra. Lúcia'],
      [
        3,
        'Cirurgia\n23/09 | Abdome | Dr. Caio\n25/09 | Trauma | Dra. Marina\n26/09 | Pré | Dr. Caio',
      ],
    ] as const) {
      const frame = build(contextOf({ disciplina: rich(source) }));

      expect(named(frame.children, 'session'), source).toHaveLength(count);
      expect(named(frame.children, 'session-pill')).toHaveLength(count);
    }
  });

  it('stacks them, so the second row sits a whole row below the first', () => {
    const frame = build(
      contextOf({
        disciplina: rich('Cirurgia\n23/09 | Abdome | Dr. Caio\n25/09 | Trauma | Dra. Marina'),
      }),
    );

    const [first, second] = named(frame.children, 'session');

    expect(second?.transform.y).toBeGreaterThan(first?.transform.y ?? 0);
  });

  it('draws a session with no professor without drawing an empty text node', () => {
    const frame = build(contextOf({ disciplina: rich('Pediatria\n27/09 | Febre sem foco') }));

    expect(named(frame.children, 'session-title').map(words)).toEqual(['Febre sem foco']);
    expect(named(frame.children, 'professor')).toEqual([]);
    // The pill is still there and still its full height: a missing field moves nothing.
    expect(named(frame.children, 'session-pill')).toHaveLength(1);
  });
});

describe('the marks the template holds the geometry of', () => {
  const frame = build(contextOf({ disciplina: rich('Pediatria\n27/09 | Febre | Dra. Lúcia') }));

  it.each([
    ['owl', OWL],
    ['arrow', ARROW],
  ])('draws %s as a path with a fill the template supplied', (name, token) => {
    const [node] = named(frame.children, name);

    expect(node?.kind).toBe('vector');
    if (node?.kind !== 'vector') return;

    expect(node.geometry).toEqual({ kind: 'path', d: token.d, fillRule: token.fillRule });
    // The colour is the template's, not the file's: neither token carries one.
    expect(node.fill).toEqual({ kind: 'solid', color: { r: 18, g: 48, b: 107, a: 1 } });
  });

  it.each([
    ['owl', OWL, 96],
    ['arrow', ARROW, 30],
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
  const disciplina = rich('Pediatria\n27/09 | Febre | Dra. Lúcia');

  it.each(['feed', 'story'])('draws %s at the size the context gave it', (format) => {
    const context = contextOf({ disciplina, format });
    const frame = build(context);

    expect(frame.size).toEqual(context.size);
    expect(frame.format).toBe(format);
  });

  it('namespaces its ids with the prefix the context supplied', () => {
    const context = contextOf({ disciplina, index: 2, format: 'story' });

    expect(build(context).children.every((node) => node.id.startsWith(context.idPrefix))).toBe(
      true,
    );
  });

  it('signs every slide, cover or no cover', () => {
    for (const index of [0, 1, 2]) {
      const frame = build(contextOf({ disciplina, index, count: 3 }));

      expect(words(named(frame.children, 'handle')[0]), `slide ${index}`).toBe('@estrategia.saude');
      expect(named(frame.children, 'owl'), `slide ${index}`).toHaveLength(1);
    }
  });
});
