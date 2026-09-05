import { fileURLToPath } from 'node:url';

export const DIAGNOSTIC_CODES_DOC = fileURLToPath(
  new URL('../../../docs/diagnostic-codes.md', import.meta.url),
);
