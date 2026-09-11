import { writeFile } from 'node:fs/promises';

import { DIAGNOSTIC_CODES_DOC, RENDER_CONTRACT_DOC, RENDER_RESULT_SCHEMA } from './paths.ts';
import { renderDiagnosticCodes } from './render-diagnostic-codes.ts';
import { renderRenderContract } from './render-contract-doc.ts';
import { renderResultJsonSchema } from './render-result-schema.ts';

const artefacts: readonly [string, string][] = [
  [DIAGNOSTIC_CODES_DOC, renderDiagnosticCodes()],
  [RENDER_CONTRACT_DOC, renderRenderContract()],
  [RENDER_RESULT_SCHEMA, renderResultJsonSchema()],
];

for (const [path, contents] of artefacts) {
  await writeFile(path, contents, 'utf8');
  console.log(`wrote ${path}`);
}
