import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `IDENTIFIER` in `packages/core/src/template/manifest.ts` is the grammar's `identifier`
 * token written a second time, as a regex. It has to be: `brief-lang` depends on `core`
 * and the arrow only points one way, so the pattern cannot be imported from the place it
 * belongs to. A comment at each end says so and neither end breaks when the other moves.
 *
 * The coupling lives outside both packages, which is where a check for it can live too —
 * the same argument `github-config.test.ts` makes for branch protection. Translating the
 * token into a regex and comparing the two sources is enough: a manifest refusing a slot
 * name a brief can write, or accepting one it cannot, is a silent failure either way.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const readRepoFile = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

const GRAMMAR = 'packages/brief-lang/src/brief.grammar';
const MANIFEST = 'packages/core/src/template/manifest.ts';

/**
 * The body of a named token in the `@tokens` block, as written.
 *
 * Deliberately a line match and not a parse of the grammar: Lezer's own parser is not a
 * dependency of this package, and a rule that fails when it cannot find the token is worth
 * more here than one that understands every shape the file could take.
 */
function tokenBody(grammar: string, name: string): string {
  const match = new RegExp(`^\\s*${name}\\s*\\{(.+)\\}\\s*$`, 'mu').exec(grammar);
  expect(match, `${GRAMMAR} declares no token '${name}'`).not.toBeNull();
  return match![1]!.trim();
}

/**
 * A Lezer token body of character sets — `$[a-z] $[a-z0-9]*` — as regex source.
 *
 * Only the shape `identifier` actually uses is understood, and anything else throws rather
 * than being approximated. A translation that quietly accepted a wider grammar would let
 * exactly the drift this file exists to catch through.
 */
function asRegexSource(body: string): string {
  const term = /\$\[((?:[^\]\\]|\\.)+)\]([*+?]?)/gu;
  let consumed = 0;
  let pattern = '';

  for (const match of body.matchAll(term)) {
    const skipped = body.slice(consumed, match.index);
    if (skipped.trim() !== '') {
      throw new Error(`cannot translate '${skipped.trim()}' in the token body '${body}'`);
    }
    pattern += `[${match[1]!}]${match[2]!}`;
    consumed = match.index + match[0].length;
  }

  const trailing = body.slice(consumed).trim();
  if (trailing !== '') {
    throw new Error(`cannot translate '${trailing}' in the token body '${body}'`);
  }
  if (pattern === '') throw new Error(`no character set in the token body '${body}'`);

  return `^${pattern}$`;
}

/** The source of a top-level `const NAME = /…/flags;`, without the delimiters. */
function regexLiteral(module: string, name: string): string {
  const match = new RegExp(`^const ${name} = /(.+)/[a-z]*;$`, 'mu').exec(module);
  expect(match, `${MANIFEST} declares no regex '${name}'`).not.toBeNull();
  return match![1]!;
}

describe("the manifest's copy of the grammar identifier", () => {
  it('still spells the same pattern as brief.grammar', () => {
    const fromGrammar = asRegexSource(tokenBody(readRepoFile(GRAMMAR), 'identifier'));
    const fromManifest = regexLiteral(readRepoFile(MANIFEST), 'IDENTIFIER');

    expect(
      fromManifest,
      `${MANIFEST} no longer matches 'identifier' in ${GRAMMAR}. Change both or neither.`,
    ).toBe(fromGrammar);
  });

  it('names the grammar in the comment above it, so the next reader finds this check', () => {
    const manifest = readRepoFile(MANIFEST);
    const comment = manifest.slice(0, manifest.indexOf('const IDENTIFIER'));
    expect(comment).toContain(GRAMMAR);
  });

  it('refuses a token body it cannot translate rather than approximating one', () => {
    expect(() => asRegexSource('$[a-z] "-" $[a-z]*')).toThrow(/cannot translate/u);
    expect(() => asRegexSource('identifier')).toThrow(/cannot translate/u);
    expect(() => asRegexSource('  ')).toThrow(/no character set/u);
  });
});
