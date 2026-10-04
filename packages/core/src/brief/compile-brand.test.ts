import { describe, expect, it } from 'vitest';

import type { BriefAst } from './ast.js';
import { compile, compileDeferred } from './compile.js';
import { type ResolvedBrief, resolve } from './resolve.js';
import { formatCatalogue } from '../config/formats.js';
import { sourceRange } from '../source/range.js';
import { type BrandKit, noBrandKit } from '../template/brand.js';
import { type DeferredTemplate, type TemplateContext, defineTemplate } from '../template/define.js';
import { type TemplateManifest, parseManifest } from '../template/manifest.js';
import { frame } from '../template/nodes.js';
import type { TemplateRegistry } from '../template/registry.js';

/**
 * A template reads its own brand's kit, and nobody else's (ADR 0063).
 *
 * The brand and the shape are invented: `test-brand` and a triangle.
 */

const TRIANGLE = { box: { w: 10, h: 10 }, d: 'M0 10 L5 0 L10 10 Z', fillRule: 'nonzero' } as const;

const TEST_KIT: BrandKit = { logo: TRIANGLE, signature: '@test-brand' };
const OTHER_KIT: BrandKit = { signature: '@other-brand' };

const KITS: ReadonlyMap<string, BrandKit> = new Map([
  ['test-brand', TEST_KIT],
  ['other-brand', OTHER_KIT],
]);

const FORMATS = formatCatalogue({ feed: { w: 100, h: 100 }, story: { w: 100, h: 200 } });

function manifestOf(brand: string | undefined): TemplateManifest {
  const source = `name: cartao
version: 1.0.0
${brand === undefined ? '' : `brand: ${brand}\n`}formats: [feed, story]
slots: {}
`;
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

async function resolvedFor(manifest: TemplateManifest): Promise<ResolvedBrief> {
  const registry: TemplateRegistry = {
    list: () => [manifest],
    get: () => manifest,
    formatsOf: () => manifest.formats,
    directoryOf: () => 'templates/cartao',
    failures: [],
  };
  const ast: BriefAst = {
    frontmatter: { data: { template: 'cartao' }, ranges: {}, range: sourceRange(0, 20) },
    directives: [],
    range: sourceRange(0, 20),
  };
  const result = await resolve(ast, {
    registry,
    assets: { base: '', resolve: () => Promise.resolve(undefined) },
  });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

/** Compiles a template that keeps the kit of every context it was handed. */
async function kitsHanded(
  brand: string | undefined,
  brandKits: ReadonlyMap<string, BrandKit> | undefined,
): Promise<readonly BrandKit[]> {
  const manifest = manifestOf(brand);
  const handed: BrandKit[] = [];
  const template = defineTemplate(manifest, (context) => {
    handed.push(context.brand);
    return frame({ format: context.format, size: context.size, idPrefix: context.idPrefix });
  });
  const result = compile(await resolvedFor(manifest), template, {
    formats: FORMATS,
    ...(brandKits === undefined ? {} : { brandKits }),
  });
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return handed;
}

describe("a template's context carries its own brand's kit", () => {
  it('hands a template of test-brand the logo and the signature, in every format', async () => {
    expect(await kitsHanded('test-brand', KITS)).toEqual([TEST_KIT, TEST_KIT]);
  });

  it('hands a template of another brand that brand’s kit, never test-brand’s', async () => {
    expect(await kitsHanded('other-brand', KITS)).toEqual([OTHER_KIT, OTHER_KIT]);
  });

  it('hands a brand nobody supplied a kit for an empty kit, with both fields undefined', async () => {
    const [kit] = await kitsHanded('unknown-brand', KITS);

    expect(kit).toBe(noBrandKit);
    expect(kit?.logo).toBeUndefined();
    expect(kit?.signature).toBeUndefined();
  });

  it('hands a template that names no brand the empty kit, even when kits exist', async () => {
    expect(await kitsHanded(undefined, KITS)).toEqual([noBrandKit, noBrandKit]);
  });

  it('hands the empty kit when the compile was given no kits at all', async () => {
    expect(await kitsHanded('test-brand', undefined)).toEqual([noBrandKit, noBrandKit]);
  });

  it('hands a deferred template the same kit, which is what crosses to a plugin', async () => {
    const manifest = manifestOf('test-brand');
    const handed: TemplateContext[] = [];
    const deferred: DeferredTemplate = {
      manifest,
      buildLater: (context) => {
        handed.push(context);
        const built = frame({
          format: context.format,
          size: context.size,
          idPrefix: context.idPrefix,
        });
        return Promise.resolve({ ok: true, value: built, diagnostics: [] });
      },
    };

    const result = await compileDeferred(await resolvedFor(manifest), deferred, {
      formats: FORMATS,
      brandKits: KITS,
    });

    expect(result.ok).toBe(true);
    expect(handed.map((context) => context.brand)).toEqual([TEST_KIT, TEST_KIT]);
  });
});
