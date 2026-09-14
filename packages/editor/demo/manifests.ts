import { type TemplateManifest, parseManifest } from '@tyto/core';

import carrossel from '../../templates/templates/carrossel-lista/manifest.yaml?raw';
import promo from '../../templates/templates/promo-curso/manifest.yaml?raw';

/**
 * The built-in templates' real manifests, read the way the editor has to read them.
 *
 * A DOM package may not open a file (ADR 0010), so the bundler hands over the text and
 * `parseManifest` does the rest — which is also what `apps/desktop` will do across the
 * preload bridge, with main doing the reading. Parsing them here rather than hand-writing
 * a fixture is what makes the demo an acceptance surface: the completion list the demo
 * shows is the one the built-in templates actually declare.
 */
const read = (source: string, path: string): TemplateManifest => {
  const parsed = parseManifest(source, path);
  if (!parsed.ok) {
    throw new Error(
      `demo: ${path} does not parse — ${parsed.error.map((d) => d.message).join('; ')}`,
    );
  }
  return parsed.value;
};

export const MANIFESTS: readonly TemplateManifest[] = [
  read(promo, 'promo-curso/manifest.yaml'),
  read(carrossel, 'carrossel-lista/manifest.yaml'),
];
