import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { preProcessFile } from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The card's invariant, held by the imports: the preview is not a renderer.
 *
 * It may not import a stage, an exporter or a rasterizer — any `@tyto/*` package at all —
 * because a second route to a picture is exactly the preview that is "close to" the
 * output and not the output. What it may do is spawn the built binary and rebuild the
 * template pack, both of which it reaches by path. `preProcessFile` and not a regex, so a
 * package named in a comment (this one, say) is not read as an import.
 */

const SOURCE = fileURLToPath(new URL('.', import.meta.url));

const ALLOWED = [/^node:/, /^\.\//, /^tsup$/, /^typescript$/, /^vitest$/];

describe('the preview', () => {
  const files = readdirSync(SOURCE).filter((name) => name.endsWith('.ts'));

  it.each(files)('%s imports no Tyto package', (name) => {
    const source = readFileSync(join(SOURCE, name), 'utf8');
    const imports = preProcessFile(source, true, true).importedFiles.map((file) => file.fileName);
    expect(imports.filter((specifier) => !ALLOWED.some((rule) => rule.test(specifier)))).toEqual(
      [],
    );
  });
});
