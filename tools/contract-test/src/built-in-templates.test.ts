import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseBrief } from '@tyto/brief-lang';
import {
  type Diagnostic,
  type Scene,
  type SceneNode,
  compile,
  createFaceCache,
  loadFormats,
  loadTemplateRegistry,
  resolve,
} from '@tyto/core';
import { fileAssetResolver, fileTemplateAssets, nodeFileSystem } from '@tyto/io';
import { markupTemplateSource } from '@tyto/pipeline';
import { testFontSource } from '@tyto/test-fonts';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The built-in pack's own acceptance criteria, run against the folders as they ship.
 *
 * Not in `packages/templates`: that package is pure (ADR 0010) and cannot read the files it
 * contains. Not in `apps/cli` either — this is not about the command line. It is here for
 * the reason this package exists at all: to run the real thing against a real folder and
 * check what comes out, rather than to test a unit.
 *
 * ## Why the fonts are wired here and not in a job
 *
 * `compile` only measures text when it is given faces, and nothing supplies them to a
 * render job yet (E4.5 left that seam open on purpose). A test that rendered without them
 * would satisfy "no `W_TEXT_OVERFLOW`" by never being able to produce one, which is the
 * emptiest kind of green. So the faces come from `@tyto/test-fonts` and the assertion is
 * about text that was actually measured.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '../../../packages/templates/templates');

const CLI = fileURLToPath(new URL('../../../apps/cli/dist/index.js', import.meta.url));
const runBinary = promisify(execFile);

const fileSystem = nodeFileSystem();
const faces = createFaceCache(testFontSource);

interface Example {
  readonly template: string;
  readonly brief: string;
}

const EXAMPLES: readonly Example[] = [
  { template: 'promo-curso', brief: 'examples/promo.brief' },
  { template: 'carrossel-lista', brief: 'examples/lista.brief' },
];

let formats: Awaited<ReturnType<typeof loadFormats>>;

beforeAll(async () => {
  formats = await loadFormats(fileSystem, join(PACK, 'formats.yaml'));
  if (!formats.ok) throw new Error(formats.error.map((item) => item.message).join('; '));
}, 60_000);

/** Text nodes anywhere in a subtree; a group is a node and the copy usually sits in one. */
function textCount(nodes: readonly SceneNode[]): number[] {
  return nodes.map((node) => {
    if (node.kind === 'group') return textCount(node.children).reduce((a, b) => a + b, 0);
    return node.kind === 'text' ? 1 : 0;
  });
}

/** Everything the pipeline does to an example brief, short of writing bytes. */
async function build(example: Example): Promise<{ scene: Scene; warnings: readonly Diagnostic[] }> {
  if (!formats.ok) throw new Error('formats.yaml did not load.');

  const directory = join(PACK, example.template);
  const source = await readFile(join(directory, example.brief), 'utf8');

  const ast = parseBrief(source);
  if (!ast.ok) throw new Error(ast.error.map((item) => item.message).join('; '));

  const registry = await loadTemplateRegistry(fileSystem, PACK);
  if (!registry.ok) throw new Error(registry.error.map((item) => item.message).join('; '));

  const resolved = await resolve(ast.value, {
    registry: registry.value,
    assets: fileAssetResolver({ base: directory }),
  });
  if (!resolved.ok) throw new Error(resolved.error.map((item) => item.message).join('; '));

  const templates = markupTemplateSource(fileSystem, registry.value, {
    assets: (await fileTemplateAssets({ base: directory })).assets,
  });
  const template = await templates.load(example.template);
  if (!template.ok) throw new Error(template.error.map((item) => item.message).join('; '));

  const scene = compile(resolved.value, template.value, { formats: formats.value, faces });
  if (!scene.ok) throw new Error(scene.error.map((item) => item.message).join('; '));

  return { scene: scene.value, warnings: [...resolved.warnings, ...scene.warnings] };
}

describe.each(EXAMPLES.map((example) => [example.template, example] as const))(
  '%s',
  (name, example) => {
    it('compiles its example brief into every format the manifest declares', async () => {
      const { scene } = await build(example);

      expect(scene.artworks.length).toBeGreaterThan(0);
      for (const artwork of scene.artworks) {
        expect(
          artwork.frames.map((frame) => frame.format),
          `${name}: artwork '${artwork.id}' is missing a format`,
        ).toEqual(['feed', 'story']);
      }
    }, 60_000);

    it('fits: no text runs past its box in any format', async () => {
      const { warnings } = await build(example);
      const overflow = warnings.filter((item) => item.code === 'W_TEXT_OVERFLOW');

      // The messages, not the count: a failure here has to say which slot and which format
      // so that whoever changed a size knows what to move.
      expect(overflow.map((item) => item.message)).toEqual([]);
    }, 60_000);

    it('draws every slot its example sets, and declares the font it draws them in', async () => {
      const { scene } = await build(example);

      // A slot the brief left unset leaves its node out, so an empty scene would pass the
      // overflow assertion above without drawing a word. This is what stops that — and it
      // recurses, because promo-curso puts its copy inside a group.
      const texts = scene.artworks.flatMap((artwork) =>
        artwork.frames.flatMap((frame) => textCount(frame.children)),
      );
      expect(texts.reduce((total, count) => total + count, 0)).toBeGreaterThan(0);

      // Bundled, not a file beside the template: the repository ships one copy in `fonts/`.
      expect(scene.fonts.map((entry) => entry.family)).toContain('Source Sans 3');
      for (const entry of scene.fonts) expect(entry.source).toBe('bundled');
    }, 60_000);
  },
);

describe('tyto template check', () => {
  /**
   * The card's second criterion, run the way it is written: the binary, not the function
   * behind it. `check` reads the manifest and the markup and nothing else — no brief, no
   * formats.yaml — so it is the one thing that can say a template is wrong on its own.
   */
  it.each(EXAMPLES.map((example) => example.template))(
    '%s: no problems found',
    async (name) => {
      const { stderr } = await runBinary(process.execPath, [
        CLI,
        'template',
        'check',
        join(PACK, name),
      ]);

      // `check` writes its report to stderr and exits 0 when nothing is wrong; a non-zero
      // exit rejects the promise, so reaching here is already half the assertion.
      expect(stderr).toContain('no problems found');
    },
    120_000,
  );
});

describe('the pack as a whole', () => {
  it('loads as a registry with both templates and no failures', async () => {
    const registry = await loadTemplateRegistry(fileSystem, PACK);
    if (!registry.ok) throw new Error(registry.error.map((item) => item.message).join('; '));

    expect(
      registry.value
        .list()
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(['carrossel-lista', 'promo-curso']);
    // A manifest that does not parse becomes a failure rather than an exception, so an
    // empty list and a broken pack look alike unless this is checked.
    expect(registry.value.failures).toEqual([]);
  }, 60_000);
});
