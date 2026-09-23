import { parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { compileTemplate } from './compile-template.js';
import { isTemplateName, scaffoldTemplate } from './scaffold.js';

describe('scaffoldTemplate', () => {
  it('writes a manifest and a body the compiler has nothing to say about', () => {
    // The claim both hosts make by calling this: a scaffold with a diagnostic in it teaches an
    // author that the checker cries wolf, on their very first run.
    const scaffold = scaffoldTemplate('promo', ['feed', 'story']);

    const manifest = parseManifest(scaffold.manifest, 'manifest.yaml');
    expect(manifest.ok && manifest.diagnostics).toEqual([]);
    if (!manifest.ok) return;
    expect(manifest.value.name).toBe('promo');
    expect(manifest.value.formats).toEqual(['feed', 'story']);

    const compiled = compileTemplate(scaffold.markup, { manifest: manifest.value });
    expect(compiled.ok ? compiled.diagnostics : compiled.error).toEqual([]);
  });

  it('draws the first format and extends it for the rest', () => {
    const { markup } = scaffoldTemplate('promo', ['feed', 'story', 'banner']);

    expect(markup).toContain('<frame format="feed" bg="var(--bg)">');
    expect(markup).toContain('<frame format="story" extends="feed" />');
    expect(markup).toContain('<frame format="banner" extends="feed" />');
  });

  it('writes an example brief that names the template and fills its required slot', () => {
    const { example } = scaffoldTemplate('promo', ['feed']);

    expect(example).toMatch(/^---\ntemplate: promo\n/u);
    expect(example).toContain('::titulo');
    // No `formats:` line: the example renders whatever the manifest declares, so a format
    // added to the manifest shows up in the preview without a second edit.
    expect(example).not.toContain('formats:');
  });

  it('accepts exactly the names a brief can write', () => {
    expect(isTemplateName('promo-curso')).toBe(true);
    expect(isTemplateName('nome com espaço')).toBe(false);
    expect(isTemplateName('a/b')).toBe(false);
    expect(isTemplateName('')).toBe(false);
  });
});
