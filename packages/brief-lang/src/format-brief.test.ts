import { isOk } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { applyEdits, formatBrief, formatBriefEdits, lineEndingOf } from './format-brief.js';
import { parseBrief } from './parse-brief.js';

/**
 * Format Brief (TYTO-297, ADR 0096): the canonical shape, and the guarantee that reaching it
 * changes nothing the brief says.
 *
 * The meaning is compared as the AST with every offset removed — formatting moves offsets by
 * design. `tools/contract-test` holds the stronger version, the compiled Scene deep-equal,
 * over every built-in template's example.
 */

const FIXTURES = import.meta.glob('./__fixtures__/*.brief', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The AST as a value, with every source offset removed. */
function meaningOf(text: string): unknown {
  const result = parseBrief(text);
  if (!isOk(result)) throw new Error(result.error.map((item) => item.message).join('; '));
  return JSON.parse(
    JSON.stringify(result.value, (key, value: unknown) =>
      key === 'range' || key === 'nameRange' || key === 'ranges' ? undefined : value,
    ),
  );
}

function formatted(text: string, indentUnit?: number): string {
  const result = formatBrief(text, indentUnit === undefined ? {} : { indentUnit });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

const hasSyntaxError = (text: string): boolean => {
  const result = parseBrief(text);
  return isOk(result)
    ? result.diagnostics.some((item) => item.code === 'E_SYNTAX')
    : result.error.some((item) => item.code.endsWith('SYNTAX'));
};

/**
 * The same brief written badly, in one of four ways, every way a person's editor or a paste
 * gets there: a body indented by six spaces, a tab or three spaces; spaces and tabs at the end
 * of lines; a blank line made a run of them, or a line of spaces; blank lines between a head
 * and its first body line and at the end of the file; CRLF. Every one of those is something
 * the formatter takes back out, so the messy text and the clean one format the same. The
 * frontmatter is left alone, as the formatter leaves it.
 */
function messy(source: string, variant: number): string {
  const lines = source.replace(/\n$/u, '').split('\n');
  const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const indents = ['      ', '\t', '   ', ' \t '];
  const isBody = (line: string | undefined) => line !== undefined && /^[ \t]+\S/u.test(line);
  const out: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (index <= fenceEnd) {
      out.push(line);
      continue;
    }
    const step = index + variant;
    if (line === '') {
      out.push(...Array.from({ length: 1 + (step % 3) }, () => ''), step % 2 === 0 ? '   ' : '\t');
      continue;
    }
    if (isBody(line) && !isBody(lines[index - 1]) && step % 2 === 0) out.push('', '  ');
    let written = isBody(line) ? line.replace(/^[ \t]+/u, indents[step % indents.length]!) : line;
    if (step % 2 === 0) written += index % 3 === 0 ? ' \t ' : '  ';
    out.push(written);
  }
  out.push('', ' ', '');
  const text = out.join('\n');
  return variant % 2 === 1 ? text.replaceAll('\n', '\r\n') : text;
}

const corpus = Object.entries(FIXTURES).filter(([, source]) => !hasSyntaxError(source));
const broken = Object.entries(FIXTURES).filter(([, source]) => hasSyntaxError(source));

describe('formatBrief on a messy brief', () => {
  const MESSY = [
    '---',
    'template: agenda-diaria  ',
    'formats: [grid]',
    '---   ',
    '',
    '',
    '',
    '::titulo Agenda da semana   ',
    '::lamina',
    '',
    '\tORTOPEDISTA\t',
    '   10-09 - 20h | Cuidado dos pés 1. | Profª. Mara Rebeiro  ',
    '',
    '',
    '',
    '      ORTOPEDISTA',
    '  11-09 - 20h | Cuidado com a coluna 1. | Profª. Mara Rebeiro',
    '   ',
    '// fim   ',
    '::rodape   **Estratégia**  {cor:laranja}Saúde{/}  ',
    '',
    '',
  ].join('\n');

  it('comes out in the canonical shape', () => {
    expect(formatted(MESSY)).toBe(
      [
        '---',
        'template: agenda-diaria',
        'formats: [grid]',
        '---',
        '',
        '::titulo Agenda da semana',
        '::lamina',
        '  ORTOPEDISTA',
        '  10-09 - 20h | Cuidado dos pés 1. | Profª. Mara Rebeiro',
        '',
        '  ORTOPEDISTA',
        '  11-09 - 20h | Cuidado com a coluna 1. | Profª. Mara Rebeiro',
        '',
        '// fim',
        // Nothing inside a line moves: the three spaces after the name stay.
        '::rodape   **Estratégia**  {cor:laranja}Saúde{/}',
        '',
      ].join('\n'),
    );
  });

  it('indents body lines by the unit it is given', () => {
    const four = formatted(MESSY, 4).split('\n');
    expect(four).toContain('    ORTOPEDISTA');
    expect(four).toContain('    11-09 - 20h | Cuidado com a coluna 1. | Profª. Mara Rebeiro');
    expect(four.filter((line) => line.startsWith('  ') && !line.startsWith('    '))).toEqual([]);
  });

  it('says the same thing afterwards', () => {
    expect(meaningOf(formatted(MESSY))).toEqual(meaningOf(MESSY));
  });

  it('is idempotent', () => {
    const once = formatted(MESSY);
    expect(formatted(once)).toBe(once);
    expect(formatBriefEdits(once)).toEqual({ ok: true, value: [], diagnostics: [] });
  });
});

describe('formatBrief keeps the file’s line ending', () => {
  it('CRLF in, CRLF out, a final one included', () => {
    const text = '::titulo Um  \r\n::lamina\r\n\r\n\r\n    a\r\n\r\n\r\n    b';
    expect(formatted(text)).toBe('::titulo Um\r\n::lamina\r\n  a\r\n\r\n  b\r\n');
    expect(lineEndingOf(text)).toBe('\r\n');
  });

  it('LF with no final newline gains one', () => {
    expect(formatted('::titulo Um')).toBe('::titulo Um\n');
  });

  it('an empty brief stays empty, and a brief of blank lines becomes empty', () => {
    expect(formatted('')).toBe('');
    expect(formatted('\n  \n\t\n')).toBe('');
  });
});

describe('formatBrief and the frontmatter', () => {
  it('leaves it byte for byte but for the spaces its lines end with', () => {
    const text = '---\ntemplate: x   \nformats:   [feed,story]\n  # note  \n---  \n::titulo A\n';
    expect(formatted(text)).toBe(
      '---\ntemplate: x\nformats:   [feed,story]\n  # note\n---\n::titulo A\n',
    );
  });

  it('never re-indents it, at any indent unit: its indentation is YAML’s', () => {
    const text =
      '---\ntemplate: x\nformats:\n    - feed\n    - story\nnota:\n   a: 1\n---\n::titulo A\n';
    for (const unit of [2, 4]) expect(formatted(text, unit)).toBe(text);
  });

  it('keeps trailing spaces a literal block scalar would keep', () => {
    const text = '---\ntemplate: x\nnota: |\n  linha  \n---\n::titulo A\n';
    expect(formatted(text)).toBe(text);
  });
});

describe('formatBrief refuses a brief with a syntax error', () => {
  it.each(broken.map(([name, source]) => [name, source] as const))('%s', (_name, source) => {
    const result = formatBrief(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
    for (const item of result.error) expect(item.code).toMatch(/SYNTAX$/u);
  });

  it('an orphan indent, typed in the middle of a good brief', () => {
    expect(formatBrief('::titulo A\n// x\n  orphan\n').ok).toBe(false);
  });
});

describe.each(corpus.map(([name, source]) => [name, source] as const))(
  'fixture %s',
  (name, source) => {
    it('says the same thing formatted, and formatting again changes nothing', () => {
      const once = formatted(source);
      expect(meaningOf(once), name).toEqual(meaningOf(source));
      expect(formatted(once)).toBe(once);
    });

    it.each([0, 1, 2, 3])('written messily (variant %i), formats to the same text', (variant) => {
      const written = messy(source, variant);
      expect(meaningOf(written)).toEqual(meaningOf(source));
      const out = formatted(written);
      // CRLF variants come back CRLF; with that discounted, the same canonical text.
      expect(out.replaceAll('\r\n', '\n')).toBe(formatted(source));
      expect(meaningOf(out)).toEqual(meaningOf(source));
      expect(formatted(out)).toBe(out);
    });
  },
);

describe('formatBriefEdits', () => {
  it('touches only whitespace, so the text of each line keeps its place in the edits', () => {
    const text = '::lamina\n      um  \n\n\n      dois\n';
    const edits = formatBriefEdits(text);
    expect(edits.ok).toBe(true);
    if (!edits.ok) return;
    for (const edit of edits.value) {
      expect(text.slice(edit.from, edit.to)).toMatch(/^[ \t\r\n]*$/u);
      expect(edit.insert).toMatch(/^[ \r\n]*$/u);
    }
    expect(applyEdits(text, edits.value)).toBe('::lamina\n  um\n\n  dois\n');
  });
});
