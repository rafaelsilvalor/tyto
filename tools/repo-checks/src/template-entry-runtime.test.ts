import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `@tyto/core/template` must not reach a parser at run time (TYTO-457).
 *
 * A code template's plugin bundles that entry, and TYTO-438 once made it import the manifest's
 * schema, and with it `yaml`, which a bundled plugin could not load: typecheck, lint and every
 * test passed, and the plugin broke at its first render. This walks the built entry the way a
 * bundler does, through each relative chunk it imports, and lists the packages it reaches.
 * The built bundle rather than the sources, because tsup decides what lands in which chunk.
 *
 * `@tyto/core` is a devDependency of this package, so `turbo test` builds it first.
 */
const entry = fileURLToPath(new URL('../../../packages/core/dist/template.js', import.meta.url));

/** Parsers the entry must never reach: each one is a file a bundled plugin cannot load. */
const FORBIDDEN = ['yaml'];

function packagesReachedFrom(file: string, seen = new Set<string>()): Set<string> {
  const reached = new Set<string>();
  if (seen.has(file)) return reached;
  seen.add(file);
  // `preProcessFile` reads imports and dynamic imports, and never a comment.
  const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  for (const { fileName } of importedFiles) {
    if (fileName.startsWith('.')) {
      for (const name of packagesReachedFrom(resolve(dirname(file), fileName), seen)) {
        reached.add(name);
      }
    } else {
      reached.add(fileName);
    }
  }
  return reached;
}

describe('the @tyto/core/template entry', () => {
  it('is built, so the walk below measures something', () => {
    expect(existsSync(entry), entry).toBe(true);
  });

  it('reaches no parser at run time', () => {
    const reached = [...packagesReachedFrom(entry)];

    expect(reached.filter((name) => FORBIDDEN.some((parser) => name.startsWith(parser)))).toEqual(
      [],
    );
  });
});
