import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBrief } from '@tyto/brief-lang';
import { nodeFileSystem } from '@tyto/io';
import { describe, expect, it } from 'vitest';

/**
 * A brief saved on Windows, read off the disk as bytes rather than built in memory.
 *
 * TYTO-64 fixed the parser and pinned it with tests that construct the three line endings
 * from one LF source. That is the right instrument for comparing ASTs — the three differ
 * only in the offsets, and building them removes every other variable — but it leaves one
 * step untested: nothing proved that a CRLF file survives a checkout and reaches the parser
 * with its bytes intact. `.gitattributes` normalises every other file to LF, so an
 * in-memory test would keep passing on the day that normalisation swallowed the fixture.
 *
 * Hence a committed file, an exemption beside it, and an assertion on the bytes before the
 * assertion on the parse. Here rather than in `packages/brief-lang` because that package is
 * pure (ADR 0010) and cannot open a file; this one already composes real packages over a
 * real folder, which is what it is for.
 */
const fixtures = fileURLToPath(new URL('./fixture/line-endings/', import.meta.url));

const fileSystem = nodeFileSystem();

describe('a brief saved with CRLF line endings', () => {
  it('reaches the parser with its carriage returns, not normalised away', async () => {
    const source = await fileSystem.readFile(join(fixtures, 'crlf.brief'));

    expect(
      source.split('\r\n').length - 1,
      'the fixture lost its CRLF bytes — check the `-text` exemption in .gitattributes',
    ).toBe(11);
    expect(source.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('parses with no diagnostics, frontmatter and directives included', async () => {
    const source = await fileSystem.readFile(join(fixtures, 'crlf.brief'));
    const parsed = parseBrief(source);

    expect(parsed.ok, parsed.ok ? '' : parsed.error.map((item) => item.message).join('; ')).toBe(
      true,
    );
    if (!parsed.ok) return;

    expect(parsed.warnings).toEqual([]);
    expect(parsed.value.frontmatter?.data).toMatchObject({
      template: 'cartaz',
      formats: ['feed'],
      cor: 'laranja',
    });
    expect(parsed.value.directives.map((directive) => directive.name)).toEqual(['slide', 'slide']);
  });

  it('ranges index the bytes the caller handed in, carriage returns and all', async () => {
    const source = await fileSystem.readFile(join(fixtures, 'crlf.brief'));
    const parsed = parseBrief(source);
    if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));

    // The guarantee the grammar comment makes: offsets are into the original text, so a
    // slice of a range is the source it came from rather than something one byte off per
    // line. Nothing else in the repository measures that against real CRLF bytes.
    const [first] = parsed.value.directives;
    expect(first).toBeDefined();
    expect(source.slice(first!.nameRange.start, first!.nameRange.end)).toBe('slide');
  });
});
