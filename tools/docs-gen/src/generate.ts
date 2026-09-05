import { writeFile } from 'node:fs/promises';

import { DIAGNOSTIC_CODES_DOC } from './paths.ts';
import { renderDiagnosticCodes } from './render-diagnostic-codes.ts';

await writeFile(DIAGNOSTIC_CODES_DOC, renderDiagnosticCodes(), 'utf8');
console.log(`wrote ${DIAGNOSTIC_CODES_DOC}`);
