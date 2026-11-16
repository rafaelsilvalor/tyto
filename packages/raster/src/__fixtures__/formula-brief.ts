import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBrief } from '@tyto/brief-lang';
import {
  type Diagnostics,
  type Result,
  type Scene,
  type Template,
  type TemplateManifest,
  type TemplateRegistry,
  compile,
  createFaceCache,
  defineTemplate,
  err,
  formatCatalogue,
  parseManifest,
  resolve,
} from '@tyto/core';
import { font, frame, runsOf, solid, text } from '@tyto/core/template';
import { bundledFontSource } from '@tyto/fonts';

/**
 * The reference brief of ADR 0206 (`formula.brief`) through the whole front of the compiler:
 * `parseBrief` → `resolve` → `compile`, measured against the bundled Source Sans 3 (TYTO-734).
 *
 * The template is the smallest that draws a rich-text slot, at the size and place of
 * TYTO-678's hand-built fixture, so the raster suite's frame and that fixture can be compared
 * by eye. It lives beside the brief rather than in `@tyto/templates`, which holds templates
 * other packages render; this one exists for these two tests only.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

export const FORMULA_BRIEF_PATH = join(HERE, 'formula.brief');

const MANIFEST_SOURCE = `name: formula-reference
version: 1.0.0
formats: [feed]
slots:
  resposta: { type: rich-text, required: true }
`;

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const MANIFEST = manifestOf(MANIFEST_SOURCE);

const registry: TemplateRegistry = {
  list: () => [MANIFEST],
  get: (name) => (name === MANIFEST.name ? MANIFEST : undefined),
  formatsOf: (name) => (name === MANIFEST.name ? MANIFEST.formats : undefined),
  directoryOf: () => undefined,
  failures: [],
};

const sourceSans = font('Source Sans 3');

const template: Template = defineTemplate(MANIFEST, (context) => {
  const answer = context.slots.resposta?.value;
  const runs = runsOf(answer?.kind === 'rich-text' ? answer.text : [], {
    font: sourceSans,
    size: 40,
    color: '#141428',
  });
  const [first, ...rest] = runs;
  return frame({
    format: context.format,
    size: context.size,
    background: solid('#fafafa'),
    idPrefix: context.idPrefix,
    children:
      first === undefined
        ? []
        : [
            text({
              id: `${context.idPrefix}.answer`,
              transform: { x: 40, y: 40 },
              box: { w: 520 },
              lineHeight: 1.4,
              runs: [first, ...rest],
            }),
          ],
  });
});

/** A brief's text compiled against the reference template, every diagnostic kept. */
export async function compileFormulaBrief(brief: string): Promise<Result<Scene, Diagnostics>> {
  const ast = parseBrief(brief);
  if (!ast.ok) return ast;
  const resolved = await resolve(ast.value, {
    registry,
    assets: { base: '(formula test)', resolve: () => Promise.resolve(undefined) },
  });
  if (!resolved.ok) return err([...ast.diagnostics, ...resolved.error]);
  const compiled = compile(resolved.value, template, {
    formats: formatCatalogue({ feed: { w: 600, h: 300 } }),
    faces: createFaceCache(bundledFontSource),
  });
  if (!compiled.ok) return compiled;
  return {
    ...compiled,
    diagnostics: [...ast.diagnostics, ...resolved.diagnostics, ...compiled.diagnostics],
  };
}

/** The reference brief, as the file the manual shows. */
export function readFormulaBrief(): string {
  return readFileSync(FORMULA_BRIEF_PATH, 'utf8');
}
