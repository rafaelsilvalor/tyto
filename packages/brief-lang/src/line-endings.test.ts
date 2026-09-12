import { lineColumnRange, sliceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { parseBrief } from './parse-brief.js';

/**
 * One brief, three line endings (TYTO-64).
 *
 * A brief is a file a person edits. The maintainer works on Windows, ADR 0011 has Jacurutu
 * writing `brief.brief` on whatever machine it runs on, and `.gitattributes` does not help:
 * the parser is handed text by a CLI reading a disk and by an editor holding a buffer, and
 * neither goes through Git.
 *
 * ## How "the same AST" is asserted, given that the offsets cannot be the same
 *
 * A CRLF file is one unit longer per line, so a range into it is numerically different from
 * the same range into the LF file. Comparing raw offsets would be comparing the wrong
 * thing. What has to hold is that a range covers **the same characters**, which is checked
 * two ways: every range rewritten as a line and column compares equal across all three, and
 * the text each range slices out compares equal once its own line endings are discounted.
 *
 * The second is the one that would catch an off-by-one that happened to preserve the
 * coordinates, so both are here rather than only the tidier one.
 */

const LF = `---
template: promo-curso
formats: [feed, story]
---
// A comment, which the parser drops.
::titulo Direito **Constitucional**
::subtitulo Turma de {cor:laranja}setembro{/}

::slide {destaque}
  O que cai na prova
  Segunda linha do bloco
::ai/caption Legenda
`;

const asCrLf = (text: string) => text.replaceAll('\n', '\r\n');
const asCr = (text: string) => text.replaceAll('\n', '\r');

const WRITTEN = [
  ['LF', LF],
  ['CRLF', asCrLf(LF)],
  ['CR', asCr(LF)],
] as const;

function astOf(text: string) {
  const result = parseBrief(text);
  if (!result.ok) {
    throw new Error(`should parse: ${result.error.map((item) => item.message).join(' | ')}`);
  }
  return result.value;
}

/** True for a `{ start, end }` pair, which is the only shape in the AST with those keys. */
function isRange(value: unknown): value is { start: number; end: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 2 &&
    typeof (value as { start?: unknown }).start === 'number' &&
    typeof (value as { end?: unknown }).end === 'number'
  );
}

/** The AST with every range rewritten as a line and column of the text it came from. */
function inLineColumns(node: unknown, text: string): unknown {
  if (isRange(node)) return lineColumnRange(text, node);
  if (Array.isArray(node)) return node.map((item) => inLineColumns(item, text));
  if (typeof node === 'object' && node !== null) {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, inLineColumns(value, text)]),
    );
  }
  return node;
}

/** Every range in the tree, in the order the walk reaches them. */
function rangesIn(
  node: unknown,
  found: { start: number; end: number }[] = [],
): { start: number; end: number }[] {
  if (isRange(node)) {
    found.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) rangesIn(item, found);
  } else if (typeof node === 'object' && node !== null) {
    for (const value of Object.values(node)) rangesIn(value, found);
  }
  return found;
}

/** The endings themselves, discounted — what is left is the text a range covers. */
const sameLines = (text: string) => text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

describe('a brief written with any line ending', () => {
  it.each(WRITTEN)('parses at all — %s', (_name, text) => {
    // The card's own measurement: CRLF and CR used to fail at the frontmatter fence and
    // then cascade, every directive after it reported incomplete.
    expect(parseBrief(text).ok).toBe(true);
  });

  it('produces the same directives, in the same order', () => {
    const names = WRITTEN.map(([, text]) =>
      astOf(text).directives.map((directive) => directive.name),
    );
    const [first, ...rest] = names;
    expect(first).toEqual(['titulo', 'subtitulo', 'slide', 'caption']);
    for (const other of rest) expect(other).toEqual(first);
  });

  it('puts every node at the same line and column, whichever ending wrote the file', () => {
    const [first, ...rest] = WRITTEN.map(([, text]) => inLineColumns(astOf(text), text));
    for (const other of rest) expect(other).toEqual(first);
  });

  it('gives every range the same characters, once the endings are discounted', () => {
    // The check that would catch an off-by-one preserving the coordinates: a range one unit
    // short still starts on the same column while slicing a different string.
    const sliced = WRITTEN.map(([, text]) =>
      rangesIn(astOf(text)).map((range) => sameLines(sliceRange(text, range))),
    );
    const [first, ...rest] = sliced;
    expect(first!.length).toBeGreaterThan(10);
    for (const other of rest) expect(other).toEqual(first);
  });

  it('keeps the frontmatter block whole, fences included, and reads its YAML', () => {
    for (const [name, text] of WRITTEN) {
      const { frontmatter } = astOf(text);
      expect(frontmatter.data.template, name).toBe('promo-curso');
      expect(frontmatter.data.formats, name).toEqual(['feed', 'story']);
      expect(sameLines(sliceRange(text, frontmatter.range!)), name).toBe(
        '---\ntemplate: promo-curso\nformats: [feed, story]\n---\n',
      );
    }
  });

  it('ends a directive before its line break, not in the middle of a CRLF', () => {
    // A range ending between the `\r` and the `\n` would leave half a line ending inside
    // the directive, where it reads as a stray character.
    for (const [name, text] of WRITTEN) {
      for (const directive of astOf(text).directives) {
        const slice = sliceRange(text, directive.range);
        expect(slice.endsWith('\r'), `${name}: ${directive.name}`).toBe(false);
        expect(slice.endsWith('\n'), `${name}: ${directive.name}`).toBe(false);
      }
    }
  });

  it('reads an indented block as its lines plus the break between them', () => {
    for (const [name, text] of WRITTEN) {
      const slide = astOf(text).directives.find((directive) => directive.name === 'slide');
      expect(
        slide?.body.map((inline) => inline.kind),
        name,
      ).toEqual(['text', 'break', 'text']);
    }
  });

  it('gives that break the whole line ending, however long it is', () => {
    // The `Break` node's span was hardcoded to one unit, which covers only the `\r` of a
    // CRLF and puts everything after it a column out.
    for (const [name, text] of WRITTEN) {
      const slide = astOf(text).directives.find((directive) => directive.name === 'slide');
      const lineBreak = slide?.body.find((inline) => inline.kind === 'break');
      expect(sliceRange(text, lineBreak!.range), name).toMatch(/^(\r\n|\r|\n)$/u);
    }
  });
});

describe('the diagnostics on a broken brief', () => {
  // Two problems on two lines: a bare line the grammar has no rule for, and a `::` with no
  // name after it. Two rather than one so the assertion covers ordering as well as
  // position, and on separate lines so both the line and the column have to be right.
  const BROKEN = 'oi\n\n:: sem nome\n';

  const reported = (text: string) => {
    const result = parseBrief(text);
    if (result.ok) throw new Error('this brief does not parse, and the test needs that');
    return result.error.map((item) => ({
      code: item.code,
      message: item.message,
      at: lineColumnRange(text, item.range!),
    }));
  };

  it('are the same diagnostics at the same line and column, whichever ending wrote it', () => {
    const [first, ...rest] = [BROKEN, asCrLf(BROKEN), asCr(BROKEN)].map(reported);
    for (const other of rest) expect(other).toEqual(first);
  });

  it('say what and where, so the list above is worth comparing', () => {
    // Pinned rather than left implicit: three empty lists would satisfy the test above.
    expect(reported(BROKEN)).toEqual([
      {
        code: 'E_SYNTAX',
        message: "Syntax error: unexpected 'oi'.",
        at: { start: { line: 1, column: 1 }, end: { line: 1, column: 3 } },
      },
      {
        code: 'E_SYNTAX',
        message: 'Syntax error: this directive is incomplete.',
        at: { start: { line: 3, column: 3 }, end: { line: 3, column: 4 } },
      },
    ]);
  });
});
