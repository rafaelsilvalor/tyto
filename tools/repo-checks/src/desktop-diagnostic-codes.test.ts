import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Every diagnostic code the desktop app puts in a string is findable in
 * `docs/diagnostic-codes.md` (TYTO-141).
 *
 * The catalogue promised "every error and warning", and three codes the window mints itself —
 * `E_FILE_NOT_FOUND`, `E_TEMPLATE_FOLDER_EMPTY`, `E_SAVE_FAILED` — were in no catalogue,
 * because they are not compiler diagnostics and so never entered `@tyto/core`. They reach the
 * problems panel all the same. A person who greps a code off a screenshot must find it, so this
 * suite fails when a code literal under `apps/desktop` is not mentioned in the doc: the next
 * renderer-minted code has to be added to `tools/docs-gen/src/desktop-codes.ts` and the doc
 * regenerated, or `pnpm check` is red.
 *
 * Read through the TypeScript AST rather than a regular expression, because a regex reads
 * comments: `main/export.ts` explains in a comment why it does *not* mint `E_EXPORT_FAILED`,
 * and a text scan would demand a catalogue entry for a code that does not exist.
 *
 * Test files are skipped: they invent codes such as `E_ONE` to exercise the panel.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const SCANNED_DIRS = ['apps/desktop/src', 'apps/desktop/shared'] as const;
const CATALOGUE = join(repoRoot, 'docs/diagnostic-codes.md');

const CODE_SHAPE = /^[EW]_[A-Z][A-Z0-9_]*$/;

interface Minted {
  readonly code: string;
  /** `path:line`, relative to the repository root, for the failure message. */
  readonly site: string;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const isSource = entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts');
    const isTest = /\.test\.ts$/.test(entry.name);
    return isSource && !isTest ? [path] : [];
  });
}

function codeLiteralsIn(path: string): Minted[] {
  const text = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: Minted[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      CODE_SHAPE.test(node.text)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      const site = `${relative(repoRoot, path).replaceAll('\\', '/')}:${line + 1}`;
      found.push({ code: node.text, site });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const minted = SCANNED_DIRS.flatMap((directory) =>
  sourceFiles(join(repoRoot, directory)).flatMap(codeLiteralsIn),
);

describe('diagnostic codes the desktop app mints', () => {
  it('finds the window-minted codes, so a green run cannot mean it scanned nothing', () => {
    const codes = new Set(minted.map((entry) => entry.code));
    for (const code of ['E_FILE_NOT_FOUND', 'E_TEMPLATE_FOLDER_EMPTY', 'E_SAVE_FAILED']) {
      expect(codes, `expected the scan to find ${code}`).toContain(code);
    }
  });

  it('does not take a code named only in a comment', () => {
    // `main/export.ts` says in prose why it does not invent `E_EXPORT_FAILED`.
    expect(minted.map((entry) => entry.code)).not.toContain('E_EXPORT_FAILED');
  });

  it('lists every one of them in docs/diagnostic-codes.md', () => {
    const catalogue = readFileSync(CATALOGUE, 'utf8');
    const missing = minted.filter((entry) => !catalogue.includes(`\`${entry.code}\``));

    expect(
      missing.map((entry) => `${entry.code} (${entry.site})`),
      'A code the desktop app mints is not in docs/diagnostic-codes.md. A code that is not a ' +
        'compiler diagnostic goes in tools/docs-gen/src/desktop-codes.ts; then run ' +
        '`pnpm docs:gen` and commit the result.',
    ).toEqual([]);
  });
});
