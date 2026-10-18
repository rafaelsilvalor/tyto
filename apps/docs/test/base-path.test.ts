import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vitepress';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The site will be published under a project path (`/tyto/` on GitHub Pages, TYTO-318), set
 * when it is built. VitePress rewrites Markdown links for that path on its own; a URL a
 * component writes is rewritten only if the component asks `withBase`, and one that does not
 * is a broken picture on the published site and a working one everywhere a test looks at `/`.
 * So this builds the site once more, under a base, into a folder of its own.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = '/tyto/';

let out: string;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'tyto-docs-base-'));
  await build(ROOT, { base: BASE, outDir: out });
}, 180_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('the site built under a base path', () => {
  it.each([
    { page: 'get-started/window-tour.html', locale: 'en' },
    { page: 'pt-BR/get-started/window-tour.html', locale: 'pt-BR' },
  ])('$page points its pictures inside the base', ({ page, locale }) => {
    const html = readFileSync(join(out, page), 'utf8');
    const sources = [...html.matchAll(/<img[^>]*?\ssrc="([^"]+)"/gu)]
      .map((match) => match[1] ?? '')
      .filter((src) => src.includes('/screenshots/'));

    expect(sources).toContain(`${BASE}screenshots/${locale}/window-tour-tyto-light.png`);
    expect(sources).toContain(`${BASE}screenshots/${locale}/window-tour-tyto-dark.png`);
    for (const src of sources) expect(src.startsWith(`${BASE}screenshots/`), src).toBe(true);
  });
});
