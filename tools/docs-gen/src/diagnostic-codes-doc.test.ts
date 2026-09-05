import { readFile } from 'node:fs/promises';

import { diagnosticCodeList } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { DIAGNOSTIC_CODES_DOC } from './paths.js';
import { renderDiagnosticCodes } from './render-diagnostic-codes.js';

/**
 * The committed doc is an artefact of the catalog, so it can go stale silently. Checking
 * it here means adding a code without regenerating fails `pnpm check` rather than landing
 * a doc that lies.
 */
describe('docs/diagnostic-codes.md', () => {
  it('matches what the catalog renders today', async () => {
    const committed = await readFile(DIAGNOSTIC_CODES_DOC, 'utf8');

    expect(
      committed,
      'docs/diagnostic-codes.md is out of date — run `pnpm docs:gen` and commit the result.',
    ).toBe(renderDiagnosticCodes());
  });

  it('mentions every code in the catalog', async () => {
    const committed = await readFile(DIAGNOSTIC_CODES_DOC, 'utf8');

    for (const code of diagnosticCodeList) {
      expect(committed).toContain(`\`${code}\``);
    }
  });
});
