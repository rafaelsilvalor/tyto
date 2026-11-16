import { describe, expect, it } from 'vitest';

import type { BriefAst, Directive, Frontmatter } from './ast.js';
import { resolve } from './resolve.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import { sourceRange } from '../source/range.js';
import { parseManifest } from '../template/manifest.js';
import type { TemplateRegistry } from '../template/registry.js';

/**
 * A manifest that declares no `multiple` gives what it gave before TYTO-746, object for object.
 * The file was written by origin/main e9899627's `resolve` on this same brief and is compared as
 * JSON, so a field added to every nested slot — an empty `occurrences` — fails here.
 */
describe('a manifest without multiple', () => {
  it('resolves a nested brief to the JSON origin/main gave it', async () => {
    const parsed = parseManifest(
      `name: aninhado
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  lamina: { type: rich-text, repeat: true, min: 1 }
  bloco: { type: rich-text, per: lamina }
  nota: { type: rich-text, per: lamina }
  paragrafo: { type: rich-text, per: bloco, required: true }
  imagem: { type: image, per: lamina }
`,
      'manifest.yaml',
    );
    if (!parsed.ok) throw new Error('manifest');
    const manifest = parsed.value;
    const registry: TemplateRegistry = {
      list: () => [manifest],
      get: (name) => (name === manifest.name ? manifest : undefined),
      formatsOf: (name) => (name === manifest.name ? manifest.formats : undefined),
      directoryOf: () => 'templates/aninhado',
      failures: [],
    };
    const assets: AssetResolver = { base: 'briefs/', resolve: () => Promise.resolve(undefined) };
    let at = 0;
    const fixed = (name: string, body: string): Directive => {
      at += 1;
      const range = sourceRange(at * 10, at * 10 + 5);
      return {
        name,
        adjustments: [],
        body: [{ kind: 'text', value: body, range }],
        range,
        nameRange: range,
      };
    };
    const directives = [
      fixed('titulo', 'T'),
      fixed('lamina', 'Um'),
      fixed('bloco', 'A'),
      fixed('paragrafo', 'A1'),
      fixed('nota', 'N'),
      fixed('lamina', 'Dois'),
      fixed('bloco', 'B'),
      fixed('paragrafo', 'B1'),
    ];
    const front: Frontmatter = {
      data: { template: 'aninhado' },
      ranges: {},
      range: sourceRange(0, 5),
    };
    const ast: BriefAst = { frontmatter: front, directives, range: sourceRange(0, 1000) };
    const result = await resolve(ast, { registry, assets });
    if (!result.ok) throw new Error('resolve');
    expect(result.diagnostics).toEqual([]);
    const value = result.value;
    await expect(`${JSON.stringify(value, undefined, 2)}\n`).toMatchFileSnapshot(
      './__fixtures__/nested-without-multiple.resolved.json',
    );
  });
});
