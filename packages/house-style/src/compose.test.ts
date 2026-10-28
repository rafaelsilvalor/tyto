import { measureNothing, noBrandKit, noFiles, reportNothing } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { CALL_TO_COMMENT, ROXO, OCRE, VINHO } from './brands.js';
import { simuladosDaSemana } from './compose.js';
import { SAFETY, TABLE } from './tokens.js';

import type { Inline, RichText, SceneNode, TemplateContext, TemplateReport } from '@tyto/core';

/**
 * The weekly mock-exam agenda is composition (ADR 0047), so what is checked here is that it
 * composes: which pieces each format and each slide carries, in which brand's colour, and
 * where the areas stand. The pixels were matched against the maintainer's ocre reference of
 * 2026-09-28 in the live preview (TYTO-200); the table itself is tested in the kit.
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

const SIZE = { grid: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } } as const;

const WEEK =
  'Domingo 26/10 | Aplicação às 08h30 & correção às 14h\n' +
  '1º Simulado Delegado (Regular)\n' +
  '1º Simulado TX QC\n' +
  'Sábado 01/11 | Aplicação às 08h30 & correção às 14h\n' +
  '1º Simulado Defensoria SP';

interface Slide {
  readonly format: keyof typeof SIZE;
  readonly index?: number;
  readonly count?: number;
  /** The slide's `lamina`; the two-day week when a case does not say. */
  readonly week?: string;
  /** The brief's call to comment, when a case writes one. */
  readonly chamada?: string;
}

function contextOf(
  slide: Slide,
  measure: TemplateContext['measure'] = measureNothing,
  report: TemplateContext['report'] = reportNothing,
) {
  const index = slide.index ?? 0;
  const slots = {
    titulo: rich('Agenda de Simulados'),
    lamina: rich(slide.week ?? WEEK),
    ...(slide.chamada === undefined ? {} : { chamada: rich(slide.chamada) }),
  };
  return {
    format: slide.format,
    size: SIZE[slide.format],
    idPrefix: `lamina-${index}-${slide.format}`,
    artwork: { id: `lamina-${index}`, index, count: slide.count ?? 1 },
    slots: Object.fromEntries(
      Object.entries(slots).map(([name, text]) => [
        name,
        { name, value: { kind: 'rich-text', text }, adjustments: [] },
      ]),
    ) as TemplateContext['slots'],
    adjustments: {},
    measure,
    report,
    files: noFiles,
    brand: noBrandKit,
  } satisfies TemplateContext;
}

/** A hex colour as the scene holds it. */
function rgba(hex: string) {
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  return { r: channel(1), g: channel(3), b: channel(5), a: 1 };
}

function walk(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) => (node.kind === 'group' ? [node, ...walk(node.children)] : [node]));
}

const named = (nodes: readonly SceneNode[], name: string) =>
  walk(nodes).filter((node) => node.name === name);

function draw(brand = OCRE, slide: Slide = { format: 'grid' }, measure = tenPerCharacter) {
  return simuladosDaSemana(brand)(contextOf(slide, measure)).children;
}

describe('simulados da semana: pieces per format and slide', () => {
  it('draws the title on every slide, not only the first', () => {
    for (const index of [0, 1, 2]) {
      expect(named(draw(OCRE, { format: 'story', index, count: 3 }), 'title')).toHaveLength(1);
    }
  });

  it('reads each day, its schedule band and its exams', () => {
    const nodes = draw();

    expect(named(nodes, 'day')).toHaveLength(2);
    expect(named(nodes, 'schedule-band')).toHaveLength(2);
    expect(named(nodes, 'exams').map((rows) => named([rows], 'exam-line').length)).toEqual([2, 1]);
  });

  it('asks for a comment on the last grid only', () => {
    const grids = [0, 1, 2].map((index) => draw(OCRE, { format: 'grid', index, count: 3 }));

    expect(grids.map((nodes) => named(nodes, 'call-to-comment').length)).toEqual([0, 0, 1]);
  });

  it('says the brief’s chamada in the call to comment, and the house’s line without one', () => {
    const said = (slide: Slide) => {
      const [cta] = named(draw(OCRE, slide), 'cta');
      return cta?.kind === 'text'
        ? cta.runs.map((run) => (run.kind === 'text' ? run.text : '')).join('')
        : undefined;
    };

    expect(said({ format: 'grid', chamada: 'Comente PROVA' })).toBe('Comente PROVA');
    expect(said({ format: 'grid' })).toBe(CALL_TO_COMMENT);
  });

  it('never asks for a comment on a story, not even the last', () => {
    expect(named(draw(OCRE, { format: 'story' }), 'call-to-comment')).toEqual([]);
  });

  it('puts the logo on the grid and none on the story', () => {
    expect(named(draw(OCRE, { format: 'grid' }), 'logo')).toHaveLength(1);
    expect(named(draw(OCRE, { format: 'story' }), 'logo')).toEqual([]);
  });
});

describe('simulados da semana: the three brands', () => {
  it('fills the logo with each brand’s accent', () => {
    for (const brand of [OCRE, VINHO, ROXO]) {
      const [logo] = named(draw(brand), 'logo');
      expect(logo).toMatchObject({ fill: { kind: 'solid', color: rgba(brand.accent) } });
    }
  });

  it('bands each day in the brand’s accent', () => {
    const [band] = named(draw(VINHO), 'schedule-band');
    expect(band?.kind === 'group' ? band.children[0] : undefined).toMatchObject({
      fill: { kind: 'solid', color: rgba(VINHO.accent) },
    });
  });

  it('signs with the signature for OCRE and VINHO, and with the note to the link for ROXO', () => {
    expect(named(draw(OCRE, { format: 'story' }), 'signature')).toHaveLength(1);
    expect(named(draw(VINHO, { format: 'story' }), 'signature')).toHaveLength(1);
    expect(named(draw(ROXO, { format: 'story' }), 'signature')).toEqual([]);
    expect(named(draw(ROXO, { format: 'story' }), 'note')).toHaveLength(1);
  });
});

describe('simulados da semana: the table’s width', () => {
  const bandWidth = (week: string) => {
    const [band] = named(draw(OCRE, { format: 'story', week }), 'schedule-band');
    const [shape] = band?.kind === 'group' ? band.children : [];
    return shape !== undefined && 'size' in shape ? shape.size.w : undefined;
  };
  const dayWith = (exam: string) => `Domingo | às 8h
${exam}`;

  it('keeps its least width when every name fits in it', () => {
    expect(bandWidth(WEEK)).toBe(TABLE.width);
  });

  it('grows to the longest name and its padding', () => {
    // 72 characters at 10 px, and the padding on both ends.
    expect(bandWidth(dayWith('x'.repeat(72)))).toBe(720 + TABLE.padding * 2);
  });

  it('stops at the maximum, where the name wraps instead', () => {
    expect(bandWidth(dayWith('x'.repeat(120)))).toBe(TABLE.maxWidth);
  });

  it('keeps its least width where nothing can measure', () => {
    const [band] = named(
      simuladosDaSemana(OCRE)(contextOf({ format: 'story', week: dayWith('x'.repeat(120)) }))
        .children,
      'schedule-band',
    );
    const [shape] = band?.kind === 'group' ? band.children : [];
    expect(shape !== undefined && 'size' in shape ? shape.size.w : undefined).toBe(TABLE.width);
  });
});

describe('simulados da semana: the areas', () => {
  it('centres the middle on the page, both ways', () => {
    const [middle] = named(draw(OCRE, { format: 'story' }), 'middle');

    // The table is the widest piece at 10 px a character, so the middle is its width.
    expect(middle?.transform.x).toBe((SIZE.story.w - TABLE.width) / 2);
    expect(middle?.transform.y).toBeGreaterThan(0);
  });

  it('stands the sign-off a safety gap below the middle', () => {
    const nodes = draw(OCRE, { format: 'story' });
    const [middle] = named(nodes, 'middle');
    const [signOff] = named(nodes, 'sign-off');
    const middleBottom = (middle?.transform.y ?? 0) + heightOf(middle);

    expect(signOff?.transform.y).toBe(middleBottom + SAFETY);
  });

  // "Todos devem estar alinhados" (the maintainer, 2026-09-29, on the first real art).
  it.each([
    ['a grid with the call to comment', { format: 'grid' } as const, 'logo'],
    ['an earlier grid', { format: 'grid', index: 0, count: 2 } as const, 'logo'],
    ['a story, which has no logo', { format: 'story' } as const, undefined],
  ])('lines the logo and the sign-off up with the middle on %s', (_name, slide, owlName) => {
    for (const brand of [OCRE, VINHO, ROXO]) {
      const nodes = draw(brand, slide);
      const [middle] = named(nodes, 'middle');
      const x = middle?.transform.x;

      expect(x).toBeGreaterThan(0);
      expect(named(nodes, 'sign-off')[0]?.transform.x).toBe(x);
      if (owlName !== undefined) expect(named(nodes, owlName)[0]?.transform.x).toBe(x);
    }
  });
});

/** The height of a stack the composition drew, read back from its last child's bottom. */
function heightOf(node: SceneNode | undefined): number {
  if (node?.kind !== 'group') return 0;
  return Math.max(...node.children.map((child) => child.transform.y + boxHeightOf(child)));
}

function boxHeightOf(node: SceneNode): number {
  switch (node.kind) {
    case 'group':
      return heightOf(node);
    case 'text':
      return node.box.h ?? 0;
    default:
      return 'size' in node ? node.size.h : 0;
  }
}

describe('simulados da semana: a slide that runs off the page (TYTO-202)', () => {
  /** Two days of four exams: at 10 px a character, more than the grid holds and less than the story. */
  const LONG = [26, 27]
    .map(
      (day) =>
        `Domingo ${String(day)}/10 | Aplicação às 08h30 & correção às 14h\n` +
        Array.from({ length: 4 }, (_, exam) => `${String(exam + 1)}º Simulado TX QC`).join('\n'),
    )
    .join('\n');

  /** One day of one exam, on a grid that is not the last: nothing near the foot. */
  const SHORT = 'Domingo 26/10 | Aplicação às 08h30 & correção às 14h\n1º Simulado TX QC';

  function reportsOf(slide: Slide): TemplateReport[] {
    const reports: TemplateReport[] = [];
    simuladosDaSemana(OCRE)(
      contextOf(slide, tenPerCharacter, (report) => {
        reports.push(report);
      }),
    );
    return reports;
  }

  it('reports how far the grid runs past its foot', () => {
    const reports = reportsOf({ format: 'grid', week: LONG });

    expect(reports.map((report) => report.code)).toEqual(['W_TEMPLATE_OVERFLOW']);
    expect(reports[0]?.overflow).toBeGreaterThan(0);
  });

  it('says nothing for the same slide on the taller story', () => {
    expect(reportsOf({ format: 'story', week: LONG })).toEqual([]);
  });

  it('says nothing for a slide that fits the grid, which is the control', () => {
    expect(reportsOf({ format: 'grid', index: 0, count: 2, week: SHORT })).toEqual([]);
  });

  it('measures the overflow to the sign-off’s foot, the lowest thing drawn', () => {
    const [signOff] = named(draw(OCRE, { format: 'grid', week: LONG }), 'sign-off');
    const foot = (signOff?.transform.y ?? 0) + (signOff === undefined ? 0 : boxHeightOf(signOff));

    expect(reportsOf({ format: 'grid', week: LONG })[0]?.overflow).toBeCloseTo(foot - SIZE.grid.h);
  });
});
