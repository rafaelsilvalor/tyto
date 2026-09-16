import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * The runtime boundary (ADR 0010) is worth exactly as much as its enforcement, so the
 * enforcement itself is tested. Each case lints a source that never reaches disk, at a
 * path inside the package whose category is under test.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const eslint = new ESLint({ cwd: repoRoot });

type Message = Awaited<ReturnType<ESLint['lintText']>>[number]['messages'][number];

async function lint(relativePath: string, source: string): Promise<Message[]> {
  const [result] = await eslint.lintText(source, {
    filePath: join(repoRoot, relativePath),
    warnIgnored: false,
  });
  if (!result) throw new Error(`ESLint returned no result for ${relativePath}`);
  return result.messages;
}

const ruleIds = (messages: Message[]) => messages.map((message) => message.ruleId);

const RESTRICTED_IMPORTS = '@typescript-eslint/no-restricted-imports';
const RESTRICTED_GLOBALS = 'no-restricted-globals';

describe('pure packages', () => {
  it('rejects a prefixed Node built-in and explains the boundary', async () => {
    const messages = await lint(
      'packages/core/src/scratch.ts',
      `import { readFile } from 'node:fs';\nexport const read = readFile;\n`,
    );

    const violation = messages.find((message) => message.ruleId === RESTRICTED_IMPORTS);
    expect(
      violation,
      `expected ${RESTRICTED_IMPORTS}, got: ${ruleIds(messages).join(', ')}`,
    ).toBeDefined();
    expect(violation?.message).toContain('ADR 0010');
    expect(violation?.message).toContain('port');
  });

  it('rejects a bare Node built-in specifier too', async () => {
    const messages = await lint(
      'packages/core/src/scratch.ts',
      `import { join } from 'path';\nexport const j = join;\n`,
    );

    expect(ruleIds(messages)).toContain(RESTRICTED_IMPORTS);
  });

  it('rejects a type-only import of a Node built-in', async () => {
    const messages = await lint(
      'packages/export-svg/src/scratch.ts',
      `import type { PathLike } from 'node:fs';\nexport type P = PathLike;\n`,
    );

    expect(ruleIds(messages)).toContain(RESTRICTED_IMPORTS);
  });

  it('rejects DOM globals', async () => {
    const messages = await lint(
      'packages/export-html/src/scratch.ts',
      `export const title = () => document.title;\n`,
    );

    expect(ruleIds(messages)).toContain(RESTRICTED_GLOBALS);
  });

  it('rejects Node globals', async () => {
    const messages = await lint(
      'packages/core/src/scratch.ts',
      `export const here = () => process.cwd();\n`,
    );

    expect(ruleIds(messages)).toContain(RESTRICTED_GLOBALS);
  });
});

describe('node packages', () => {
  it('allows Node built-ins', async () => {
    const messages = await lint(
      'packages/io/src/scratch.ts',
      `import { readFile } from 'node:fs/promises';\nexport const read = readFile;\n`,
    );

    expect(ruleIds(messages)).not.toContain(RESTRICTED_IMPORTS);
  });

  it('rejects DOM globals', async () => {
    const messages = await lint(
      'packages/pipeline/src/scratch.ts',
      `export const width = () => window.innerWidth;\n`,
    );

    expect(ruleIds(messages)).toContain(RESTRICTED_GLOBALS);
  });
});

describe('DOM packages', () => {
  it('allows DOM globals', async () => {
    const messages = await lint(
      'packages/editor/src/scratch.ts',
      `export const title = () => document.title;\n`,
    );

    expect(ruleIds(messages)).not.toContain(RESTRICTED_GLOBALS);
  });

  it('rejects Node built-ins, because the renderer runs with nodeIntegration: false', async () => {
    const messages = await lint(
      'packages/editor/src/scratch.ts',
      `import { readFile } from 'node:fs';\nexport const read = readFile;\n`,
    );

    const violation = messages.find((message) => message.ruleId === RESTRICTED_IMPORTS);
    expect(violation?.message).toContain('nodeIntegration: false');
  });
});

/**
 * Not a runtime boundary, but the same shape of rule and the same reason to test it here:
 * one module may call a thing and the rest of the package may not.
 *
 * `syntaxTree(state)` returns whatever the last parse finished — 3 000 characters on a fresh
 * state, on a 20 ms wall-clock budget — so a reader that resolves a position past that gets
 * the top node and silently answers nothing. It is not a crash and it is not a wrong answer;
 * it is an empty one, which is why five readers carried it for two cards without anybody
 * noticing (TYTO-114). `treeAt` in `syntax.ts` is the call with the position it has to reach.
 */
describe('the editor has one reader of the syntax tree', () => {
  const SOURCE = `import { syntaxTree } from '@codemirror/language';\nexport const t = syntaxTree;\n`;

  it('refuses syntaxTree elsewhere in the package, and says what to use', async () => {
    const messages = await lint('packages/editor/src/scratch.ts', SOURCE);

    const violation = messages.find((message) => message.ruleId === RESTRICTED_IMPORTS);
    expect(violation?.message).toContain('treeAt(state, upto)');
    expect(violation?.message).toContain('3000 characters');
  });

  it('allows it in syntax.ts, which is the module that wraps it', async () => {
    const messages = await lint('packages/editor/src/syntax.ts', SOURCE);

    expect(ruleIds(messages)).not.toContain(RESTRICTED_IMPORTS);
  });

  it('allows it in a test, where reaching for the truncated tree is the point', async () => {
    // How the defect was measured in the first place, and how `template-language.test.ts`
    // still has to build a state whose tree covers the document.
    const messages = await lint('packages/editor/src/scratch.test.ts', SOURCE);

    expect(ruleIds(messages)).not.toContain(RESTRICTED_IMPORTS);
  });
});
