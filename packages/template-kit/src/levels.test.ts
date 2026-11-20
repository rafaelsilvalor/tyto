import { rect, solid, systemFont } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { block } from './blocks.js';
import { type LevelItem, type LevelStackStyle, levelStack, levelsOf } from './levels.js';
import { bold, rich, span } from './rich-text.fixture.js';
import { plain } from './rows.js';

import type { RichText } from '@tyto/core';
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

  it('reads #### and #word as words, not as a mark', () => {
    expect(read('#### a | #1 colocado')).toEqual([['1:main:#### a', '0:after:#1 colocado']]);
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
function rows(items: LevelItem[]): { name: string; y: number }[] {
  const drawn = levelStack(items, STYLE, 200, measure);
  const children = (drawn.draft as GroupDraft).children ?? [];
  return children.map((child: NodeDraft) => {
    const inner = child.kind === 'group' ? (child.children[0] ?? child) : child;
    return { name: inner.name ?? '', y: child.transform?.y ?? 0 };
  });
}

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
