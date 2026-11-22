import { defineTemplate, formatCatalogue, parseManifest } from '@tyto/core';
import { frame, rect, solid, systemFont } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { block } from './blocks.js';
import {
  type LevelItem,
  type LevelPart,
  type LevelStackStyle,
  levelStack,
  levelsOf,
} from './levels.js';
import { bold, rich, span } from './rich-text.fixture.js';
import { plain } from './rows.js';
import { compileTemplate } from './testing.js';

import type { Inline, RichText } from '@tyto/core';
import type { GroupDraft, NodeDraft } from '@tyto/core/template';
import type { Measure, TextStyle } from './text.js';

/**
 * The levels of `docs/slot-vocabulary.md`, "Levels inside a block", read and stacked
 * (TYTO-807). Every example the document shows is read here as written.
 */

/** One line's parts as `level:position:words`, the shortest thing a test can compare. */
function read(source: string | RichText): string[][] {
  const text = typeof source === 'string' ? rich(source) : source;
  return levelsOf(text).map((item) =>
    item.kind === 'divider'
      ? ['---']
      : item.parts.map((part) => `${part.level}:${part.position}:${plain(part.words)}`),
  );
}

describe('levelsOf', () => {
  describe('the document’s examples, as written', () => {
    it('reads Concurso | # TRT 4 (RS) | ## Edital publicado', () => {
      expect(read('Concurso | # TRT 4 (RS) | ## Edital publicado')).toEqual([
        ['0:before:Concurso', '1:main:TRT 4 (RS)', '2:after:Edital publicado'],
      ]);
    });

    it('reads ## Concurso | # TRT 4 (RS) | Edital publicado', () => {
      expect(read('## Concurso | # TRT 4 (RS) | Edital publicado')).toEqual([
        ['2:before:Concurso', '1:main:TRT 4 (RS)', '0:after:Edital publicado'],
      ]);
    });

    it('reads a title, a divider and a line', () => {
      expect(
        read('# Concurso TRT 4 (RS) | ## Edital publicado\n---\nGanhe até R$ 16 mil por mês!'),
      ).toEqual([
        ['1:main:Concurso TRT 4 (RS)', '2:after:Edital publicado'],
        ['---'],
        ['0:after:Ganhe até R$ 16 mil por mês!'],
      ]);
    });

    it('reads the three apelo lines', () => {
      expect(read('Pacotes com 40% OFF | Por tempo limitado')).toEqual([
        ['1:main:Pacotes com 40% OFF', '0:after:Por tempo limitado'],
      ]);
      expect(read('Lote Especial | # Pacotes com 40% OFF')).toEqual([
        ['0:before:Lote Especial', '1:main:Pacotes com 40% OFF'],
      ]);
      expect(read('Lote Especial | Pacotes com 40% OFF | Por tempo limitado')).toEqual([
        ['0:before:Lote Especial', '1:main:Pacotes com 40% OFF', '0:after:Por tempo limitado'],
      ]);
    });
  });

  describe('a line with no mark, by position', () => {
    it.each([
      ['a', ['1:main:a']],
      ['a | b', ['1:main:a', '0:after:b']],
      ['a | b | c', ['0:before:a', '1:main:b', '0:after:c']],
      ['a | b | c | d', ['0:before:a', '1:main:b', '0:after:c', '0:after:d']],
    ])('%s', (source, parts) => {
      expect(read(source)).toEqual([parts]);
    });
  });

  it('reads only the block’s first line by position; a later unmarked line is base level', () => {
    const written = [
      '## Edital publicado | # Concurso TRT 4 (RS)',
      'Vagas para Analista | Técnico',
      '## Ganhe até R$ 16 mil',
    ].join('\n');
    expect(read(written)).toEqual([
      ['2:before:Edital publicado', '1:main:Concurso TRT 4 (RS)'],
      ['0:after:Vagas para Analista', '0:after:Técnico'],
      ['2:main:Ganhe até R$ 16 mil'],
    ]);
    expect(read(['---', 'TRT 4', 'Cargos'].join('\n'))).toEqual([
      ['---'],
      ['1:main:TRT 4'],
      ['0:after:Cargos'],
    ]);
  });

  it('takes the highest level written as the main part when there is no #', () => {
    expect(read('a | ## b | ### c')).toEqual([['0:before:a', '2:main:b', '3:after:c']]);
  });

  it('reads ####### and #word as words, not as a mark', () => {
    expect(read('####### a | #1 colocado')).toEqual([['1:main:####### a', '0:after:#1 colocado']]);
  });

  it('reads #### to ###### as levels 4 to 6 (TYTO-834)', () => {
    expect(read('# Nome | #### Quatro | ##### Cinco | ###### Seis')).toEqual([
      ['1:main:Nome', '4:after:Quatro', '5:after:Cinco', '6:after:Seis'],
    ]);
  });

  it('keeps a bold span whole across a | written inside it', () => {
    const line: RichText = [span('# Salário | '), bold('R$ 9 | mil')];
    expect(read(line)).toEqual([['1:main:Salário', '0:after:R$ 9 | mil']]);
  });

  it('reads --- inside a line as words and alone on a line as the divider', () => {
    expect(read('a --- b\n  ---  ')).toEqual([['1:main:a --- b'], ['---']]);
  });

  it('drops empty lines and empty parts', () => {
    expect(read('a | | b\n\n')).toEqual([['1:main:a', '0:after:b']]);
  });
});

/* ------------------------------------------------------------------------ the stack -- */

/** A measure that wraps at a fixed number of characters per line, so a test can count. */
const CHARACTERS_PER_LINE = 10;
const measure: Measure = (node) => {
  const words = node.runs.map((run) => (run.kind === 'text' ? run.text : '\n')).join('');
  const size = Math.max(...node.runs.map((run) => (run.kind === 'text' ? run.size : 0)));
  const count = Math.max(1, Math.ceil([...words].length / CHARACTERS_PER_LINE));
  return {
    runs: node.runs,
    lines: count,
    width: node.box.w ?? 0,
    height: count * node.lineHeight * size,
    scale: 1,
    overflow: 0,
  };
};

const BASE: TextStyle = { font: systemFont('Test'), size: 10, weight: 400, color: '#000000' };
const MAIN: TextStyle = { ...BASE, size: 30, weight: 900 };

const STYLE: LevelStackStyle = {
  name: 'titulo',
  look: (part) => ({ style: part.level === 1 ? MAIN : BASE, lineHeight: 1 }),
  gap: 5,
  lineGap: 20,
  divider: (width) =>
    block(width, 4, rect({ name: 'divisor', size: { w: width, h: 4 }, fill: solid('#000000') })),
};

/** The rows of a drawn stack: each child's name, top and height. */
function rows(items: LevelItem[], style: LevelStackStyle = STYLE): { name: string; y: number }[] {
  const drawn = levelStack(items, style, 200, measure);
  const children = (drawn.draft as GroupDraft).children ?? [];
  return children.map((child: NodeDraft) => {
    const inner = child.kind === 'group' ? (child.children[0] ?? child) : child;
    return { name: inner.name ?? '', y: child.transform?.y ?? 0 };
  });
}

const probeManifest = parseManifest(
  'name: niveis\nversion: 1.0.0\nformats: [grid]\nslots:\n  titulo: { type: rich-text }\n',
  'manifest.yaml',
);
if (!probeManifest.ok) throw new Error(probeManifest.error.map((item) => item.message).join('; '));
const PROBE_MANIFEST = probeManifest.value;

/** A `\` the author typed, as the parser hands it on (`typed: true`). */
function typed(): Inline {
  return { kind: 'break', typed: true, range: { start: 0, end: 1 } };
}

/** The boundary between two block lines: a break the author did not type. */
function boundary(): Inline {
  return { kind: 'break', range: { start: 0, end: 0 } };
}

/** A part's words with each break shown as `/`, so a test sees where it stands. */
function shown(words: RichText): string {
  return words.map((inline) => (inline.kind === 'break' ? '/' : plain([inline]))).join('');
}

describe('a typed break (TYTO-822)', () => {
  const parts = (text: RichText): string[][] =>
    levelsOf(text).map((item) =>
      item.kind === 'divider'
        ? ['---']
        : item.parts.map((part) => `${part.level}:${part.position}:${shown(part.words)}`),
    );

  it('stays inside the main part, its spaces taken off, and the block line still ends', () => {
    const text = [span('Concurso | # ABIN '), typed(), span(' 2027'), boundary(), span('Agora')];
    expect(parts(text)).toEqual([['0:before:Concurso', '1:main:ABIN/2027'], ['0:after:Agora']]);
  });

  it('stays inside a part before the main one', () => {
    expect(parts([span('Edital '), typed(), span(' publicado | # TRT 4')])).toEqual([
      ['0:before:Edital/publicado', '1:main:TRT 4'],
    ]);
  });

  it('breaks nothing at either end of a part', () => {
    expect(parts([span('# TRT 4 '), typed(), span(' | '), typed(), span(' Sul')])).toEqual([
      ['1:main:TRT 4', '0:after:Sul'],
    ]);
  });

  it('reaches levelsOf from a real brief, through parse, resolve and compile', async () => {
    let titulo: RichText = [];
    const template = defineTemplate(PROBE_MANIFEST, (context) => {
      const value = context.slots['titulo']?.value;
      titulo = value?.kind === 'rich-text' ? value.text : [];
      return frame({
        format: context.format,
        size: context.size,
        idPrefix: context.idPrefix,
        background: solid('#ffffff'),
        children: [],
      });
    });
    const brief = [
      '---',
      'template: niveis',
      'formats: [grid]',
      '---',
      '::titulo',
      '  Concurso | # ABIN \\ 2027',
      '  O melhor momento',
    ].join('\n');
    const compiled = await compileTemplate({
      brief,
      template,
      formats: formatCatalogue({ grid: { w: 100, h: 100 } }),
    });
    expect(compiled.ok).toBe(true);
    expect(parts(titulo)).toEqual([
      ['0:before:Concurso', '1:main:ABIN/2027'],
      ['0:after:O melhor momento'],
    ]);
  });

  it('is drawn as a break inside that part’s row', () => {
    const drawn = levelStack(
      levelsOf([span('# ABIN'), typed(), span('2027')]),
      STYLE,
      200,
      measure,
    );
    const children = (drawn.draft as GroupDraft).children ?? [];
    expect(children).toHaveLength(1);
    const node = children[0]!;
    const runs = node.kind === 'text' ? node.runs : [];
    expect(runs.map((run) => (run.kind === 'text' ? run.text : '/'))).toEqual([
      'ABIN',
      '/',
      '2027',
    ]);
  });
});

describe('levelStack', () => {
  it('stacks a line’s parts one per row, with the line gap between lines', () => {
    expect(rows(levelsOf(rich('Edital | # TRT 4\n---\nGanhe')))).toEqual([
      { name: 'titulo-before-0', y: 0 },
      { name: 'titulo-main-1', y: 15 },
      { name: 'divisor', y: 65 },
      { name: 'titulo-after-0', y: 89 },
    ]);
  });

  it('pushes the next row down by the measured height of a part that wraps', () => {
    // 25 characters at 10 per line: three lines of the main style, 90 px.
    expect(rows(levelsOf(rich('# Concurso TRT 4 do Sul RS | Edital')))).toEqual([
      { name: 'titulo-main-0', y: 0 },
      { name: 'titulo-after-1', y: 95 },
    ]);
  });

  it('spaces each pair of lines by the function of the items around the gap', () => {
    const lineGap = (above: LevelItem, below: LevelItem): number => {
      if (below.kind === 'divider' || above.kind === 'divider') return 7;
      return above.parts.some((part) => part.level === 1) ? 40 : 11;
    };
    // # TRT (30) | 40 | Edital (10) | 11 | Ganhe (10) | 7 | divider (4) | 7 | Fim (10)
    const items = levelsOf(rich('# TRT\nEdital\nGanhe\n---\nFim'));
    expect(rows(items, { ...STYLE, lineGap })).toEqual([
      { name: 'titulo-main-0', y: 0 },
      { name: 'titulo-after-0', y: 70 },
      { name: 'titulo-after-0', y: 91 },
      { name: 'divisor', y: 108 },
      { name: 'titulo-after-0', y: 119 },
    ]);
  });

  it('spaces each pair of parts in a line by the function of the parts around the gap', () => {
    const gap = (above: LevelPart, below: LevelPart): number =>
      above.position === 'before' && below.position === 'main' ? 2 : 9;
    // Edital (10) | 2 | TRT 4 (30) | 9 | Sul (10)
    expect(rows(levelsOf(rich('Edital | # TRT 4 | Sul')), { ...STYLE, gap, lineGap: 20 })).toEqual([
      { name: 'titulo-before-0', y: 0 },
      { name: 'titulo-main-1', y: 12 },
      { name: 'titulo-after-2', y: 51 },
    ]);
  });

  it('never asks the line gap about a divider it leaves out', () => {
    const seen: string[] = [];
    const lineGap = (above: LevelItem, below: LevelItem): number => {
      seen.push(`${above.kind}>${below.kind}`);
      return 3;
    };
    rows(levelsOf(rich('---\nTRT\nSul\n---')), { ...STYLE, lineGap });
    expect(seen).toEqual(['line>line']);
  });

  it('draws no divider with nothing on one side of it', () => {
    expect(rows(levelsOf(rich('---\nTRT\n---')))).toEqual([{ name: 'titulo-main-0', y: 0 }]);
  });

  it('draws an empty block as an empty stack', () => {
    const drawn = levelStack(levelsOf(rich('\n')), STYLE, 200, measure);
    expect({ width: drawn.width, height: drawn.height }).toEqual({ width: 0, height: 0 });
  });

  it('applies a level’s transform to the words drawn, not to the words read', () => {
    const items = levelsOf(rich('# trt'));
    const drawn = levelStack(
      items,
      { ...STYLE, look: () => ({ style: MAIN, transform: upper }) },
      200,
      measure,
    );
    expect(JSON.stringify(drawn.draft)).toContain('"TRT"');
    expect(items[0]!.kind === 'line' && plain(items[0]!.parts[0]!.words)).toBe('trt');
  });
});

function upper(words: RichText): RichText {
  return words.map((inline) =>
    inline.kind === 'text' ? { ...inline, value: inline.value.toUpperCase() } : inline,
  );
}
