import { readFile } from 'node:fs/promises';

import { EXIT_CODES, renderResultSchema } from '@tyto/io';
import { describe, expect, it } from 'vitest';

import { RENDER_CONTRACT_DOC, RENDER_RESULT_SCHEMA } from './paths.js';
import { renderRenderContract } from './render-contract-doc.js';
import { renderResultJsonSchema } from './render-result-schema.js';

/**
 * Both committed artefacts are derived from code, so both can go stale in silence. Checking
 * them here means changing `renderResultSchema` without regenerating fails `pnpm check`
 * rather than shipping a contract document that lies to the program reading it.
 *
 * That matters more here than for the diagnostic catalog: this is the one document another
 * product validates against.
 */

describe('docs/render-contract.md', () => {
  it('matches what the contract renders today', async () => {
    const committed = await readFile(RENDER_CONTRACT_DOC, 'utf8');

    expect(
      committed,
      'docs/render-contract.md is out of date — run `pnpm docs:gen` and commit the result.',
    ).toBe(renderRenderContract());
  });

  it('documents every exit code, and says which one is worth retrying', async () => {
    const committed = await readFile(RENDER_CONTRACT_DOC, 'utf8');

    for (const entry of EXIT_CODES) {
      expect(committed).toContain(`\`${String(entry.code)}\``);
      expect(committed).toContain(entry.name);
    }
    // The distinction the whole two-code design exists for.
    expect(committed).toContain('Only `2` is worth retrying');
  });

  it('names every field of result.json', async () => {
    const committed = await readFile(RENDER_CONTRACT_DOC, 'utf8');

    for (const field of Object.keys(renderResultSchema.shape)) {
      expect(committed, `the contract does not mention '${field}'`).toContain(`\`${field}\``);
    }
  });
});

describe('docs/render-result.schema.json', () => {
  it('matches what the Zod schema emits today', async () => {
    const committed = await readFile(RENDER_RESULT_SCHEMA, 'utf8');

    expect(
      committed,
      'docs/render-result.schema.json is out of date — run `pnpm docs:gen` and commit it.',
    ).toBe(renderResultJsonSchema());
  });

  it('is strict, which is what makes adding a field a breaking change', async () => {
    // Written down in the document's versioning section. If this ever stops being true the
    // policy is wrong, and a consumer validating strictly would start rejecting documents
    // for a reason nobody told it about.
    const committed = JSON.parse(await readFile(RENDER_RESULT_SCHEMA, 'utf8')) as {
      additionalProperties?: boolean;
      required?: readonly string[];
    };

    expect(committed.additionalProperties).toBe(false);
    expect([...(committed.required ?? [])].sort()).toEqual(
      Object.keys(renderResultSchema.shape).sort(),
    );
  });
});
