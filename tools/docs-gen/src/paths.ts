import { fileURLToPath } from 'node:url';

export const DIAGNOSTIC_CODES_DOC = fileURLToPath(
  new URL('../../../docs/diagnostic-codes.md', import.meta.url),
);

/** The Jacurutu-facing contract, prose (ADR 0011, TYTO-46). */
export const RENDER_CONTRACT_DOC = fileURLToPath(
  new URL('../../../docs/render-contract.md', import.meta.url),
);

/**
 * The same contract, machine-readable.
 *
 * A separate file rather than only a fenced block in the document, because the consumer of
 * this half is a program: Jacurutu validates `result.json` against it, and asking a program
 * to parse Markdown to find its schema is asking for the schema to be reimplemented by hand.
 */
export const RENDER_RESULT_SCHEMA = fileURLToPath(
  new URL('../../../docs/render-result.schema.json', import.meta.url),
);
