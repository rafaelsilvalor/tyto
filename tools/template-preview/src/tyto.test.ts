import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { KIT_PACKAGE } from './paths.ts';
import { staleDiagnostics } from './tyto.ts';

/**
 * What the page says in place of a picture when a package does not rebuild (TYTO-181).
 *
 * Measured live as well, with a syntax error saved into the kit: the page showed no image and
 * `@tyto/template-kit did not rebuild, so its dist/ is stale: Unexpected ";"` at the file and
 * line, and the previous image's URL answered 404.
 */

describe('staleDiagnostics', () => {
  const [diagnostic] = staleDiagnostics('@tyto/template-kit', KIT_PACKAGE, [
    { text: 'Unexpected ";"', file: join('src', 'title-block.ts'), line: 131, column: 21 },
  ]);

  it('names the package whose dist/ is stale, in the words the page shows', () => {
    expect(diagnostic?.code).toBe('PREVIEW_BUILD_FAILED');
    expect(diagnostic?.message).toBe(
      '@tyto/template-kit did not rebuild, so its dist/ is stale: Unexpected ";"',
    );
  });

  it('points at the file inside that package, with the column counted from 1', () => {
    // Shown relative to the repository, with forward slashes, the way every path on the page is.
    expect(diagnostic?.path).toBe('packages/template-kit/src/title-block.ts');
    expect([diagnostic?.line, diagnostic?.column]).toEqual([131, 22]);
  });
});
