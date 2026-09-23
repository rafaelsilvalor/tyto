import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
import { bundledFontOutlinePath, bundledFontSource, bundledFontsDirectory } from '@tyto/fonts';
import { fileAssetResolver, fileTemplateAssets, nodeFileSystem } from '@tyto/io';
import { bundledTemplateSource, markupTemplateSource } from '@tyto/pipeline';
import { BUILT_IN_TEMPLATE_BUILDS } from '@tyto/templates';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
 * render job yet (E4.5 left that seam open on purpose, and TYTO-87 left it open again: it
 * wired the *bytes an exporter embeds*, which is a different port). A test that rendered
 * without them would satisfy "no `W_TEXT_OVERFLOW`" by never being able to produce one,
 * which is the emptiest kind of green. So the faces come from `@tyto/fonts` and the
 * assertion is about text that was actually measured.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '../../../packages/templates/templates');

const CLI = fileURLToPath(new URL('../../../apps/cli/dist/index.js', import.meta.url));
const runBinary = promisify(execFile);

const fileSystem = nodeFileSystem();
const faces = createFaceCache(bundledFontSource);

interface Example {
  readonly template: string;
  readonly brief: string;
  /**
   * What the body is written in, stated here rather than read off the build: the check
   * below asserts `tyto template check` tells the two apart, and deriving the expectation
   * from the table the command itself consults would test the table against itself.
   */
  readonly body: 'markup' | 'code';
  /** The formats its manifest declares, written out for the same reason as `body`. */
  readonly formats: readonly string[];
}

const EXAMPLES: readonly Example[] = [
  {
    template: 'promo-curso',
    brief: 'examples/promo.brief',
    body: 'markup',
    formats: ['feed', 'story'],
  },
  {
    template: 'carrossel-lista',
    brief: 'examples/lista.brief',
    body: 'markup',
    formats: ['feed', 'story'],
  },
  // 4:5 only, since TYTO-173: the published carousel is cut to Instagram's portrait post.
  { template: 'agenda-semana', brief: 'examples/agenda.brief', body: 'code', formats: ['retrato'] },
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

/** Text runs anywhere in a subtree — the spans an exporter will emit, one per run. */
function spanCount(nodes: readonly SceneNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.kind === 'group') total += spanCount(node.children);
    else if (node.kind === 'text') total += node.runs.filter((run) => run.kind === 'text').length;
  }
  return total;
}

/** Everything the pipeline does to an example brief, short of writing bytes. */
async function build(example: Example): Promise<{ scene: Scene; warnings: readonly Diagnostic[] }> {
  if (!formats.ok) throw new Error('formats.yaml did not load.');

  const directory = join(PACK, example.template);
  const source = await readFile(join(directory, example.brief), 'utf8');

  return buildSource(source, example.template, directory);
}

/** The same path, given the brief's text instead of a file to read it from. */
async function buildSource(
  source: string,
  templateName: string,
  directory: string,
): Promise<{ scene: Scene; warnings: readonly Diagnostic[] }> {
  if (!formats.ok) throw new Error('formats.yaml did not load.');

  const ast = parseBrief(source);
  if (!ast.ok) throw new Error(ast.error.map((item) => item.message).join('; '));

  const registry = await loadTemplateRegistry(fileSystem, PACK);
  if (!registry.ok) throw new Error(registry.error.map((item) => item.message).join('; '));

  const resolved = await resolve(ast.value, {
    registry: registry.value,
    assets: fileAssetResolver({ base: directory }),
  });
  if (!resolved.ok) throw new Error(resolved.error.map((item) => item.message).join('; '));

  // Bundled in front of markup, the way `apps/cli` composes them: a code template is
  // served from the build's own module graph and every other name falls through to the
  // folder, with one wording for a name nobody declared.
  const templates = bundledTemplateSource({
    registry: registry.value,
    fileSystem,
    bundled: BUILT_IN_TEMPLATE_BUILDS,
    markup: markupTemplateSource(fileSystem, registry.value, {
      assets: (await fileTemplateAssets({ base: directory })).assets,
    }),
  });
  const template = await templates.load(templateName);
  if (!template.ok) throw new Error(template.error.map((item) => item.message).join('; '));

  const scene = compile(resolved.value, template.value, { formats: formats.value, faces });
  if (!scene.ok) throw new Error(scene.error.map((item) => item.message).join('; '));

  return { scene: scene.value, warnings: [...resolved.diagnostics, ...scene.diagnostics] };
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
        ).toEqual(example.formats);
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

/**
 * A mark the template does not declare costs nothing in the output (TYTO-72).
 *
 * `markStyleOf` looks for a class spelling the mark out — `{cor:laranja}` reads
 * `.cor-laranja` — and returns nothing when there is none. So the children of an
 * undeclared mark take the surrounding style *exactly*, and before this card that arrived
 * as three runs where one would draw the identical thing: an author who guessed a colour
 * their template never had paid for the guess in the exported file, with three `<tspan>`
 * elements an editor shows as three text boxes stacked edge to edge.
 *
 * Measured here rather than in a snapshot because the answer worth pinning is a
 * *difference*. No brief in this repository contains an undeclared mark — every one of
 * them uses a colour its template declares — so no existing fixture could show the drop,
 * and a snapshot of a new one would only show a number. Two briefs with the same words,
 * one of them split, is the shape that says what the split costs.
 */
describe('a mark the template never declared', () => {
  const PROMO = join(PACK, 'promo-curso');

  const briefWith = (titulo: string) =>
    `---\ntemplate: promo-curso\nformats: [feed]\n---\n::titulo\n  ${titulo}\n`;

  // `roxo` is not among the manifest's [azul, laranja, verde], so no `.cor-roxo` exists.
  const SPLIT = briefWith('Turma {cor:roxo}nova{/} de setembro');
  const WHOLE = briefWith('Turma nova de setembro');

  it('produces the same span count as the sentence written without it', async () => {
    const { scene: split } = await buildSource(SPLIT, 'promo-curso', PROMO);
    const { scene: whole } = await buildSource(WHOLE, 'promo-curso', PROMO);

    const spansIn = (scene: Scene) =>
      scene.artworks.flatMap((artwork) => artwork.frames.map((frame) => spanCount(frame.children)));

    expect(spansIn(split)).toEqual(spansIn(whole));
  }, 60_000);

  it('draws the same words, in the same order', async () => {
    const { scene: split } = await buildSource(SPLIT, 'promo-curso', PROMO);
    const { scene: whole } = await buildSource(WHOLE, 'promo-curso', PROMO);

    const textOf = (scene: Scene): string => {
      const parts: string[] = [];
      const walk = (nodes: readonly SceneNode[]) => {
        for (const node of nodes) {
          if (node.kind === 'group') walk(node.children);
          else if (node.kind === 'text')
            for (const run of node.runs) if (run.kind === 'text') parts.push(run.text);
        }
      };
      for (const artwork of scene.artworks)
        for (const frame of artwork.frames) walk(frame.children);
      return parts.join('‖');
    };

    // Joined on a separator rather than concatenated, so a run boundary that moved would
    // change the string even when the letters did not.
    expect(textOf(split)).toEqual(textOf(whole));
  }, 60_000);

  it('still keeps a declared mark apart, which is the case that must not regress', async () => {
    const { scene: declared } = await buildSource(
      briefWith('Turma {cor:verde}nova{/} de setembro'),
      'promo-curso',
      PROMO,
    );
    const { scene: whole } = await buildSource(WHOLE, 'promo-curso', PROMO);

    const spansIn = (scene: Scene) =>
      scene.artworks
        .flatMap((artwork) => artwork.frames.map((frame) => spanCount(frame.children)))
        .reduce((total, count) => total + count, 0);

    expect(spansIn(declared)).toBeGreaterThan(spansIn(whole));
  }, 60_000);
});

/**
 * The pill that cannot grow, and what the template does about it (TYTO-173).
 *
 * `agenda-semana` draws a session title into a pill whose height is fixed, because a
 * template cannot measure text: `build` decides every coordinate before `layoutText` runs
 * (TYTO-162). Until TYTO-173 a title too long for the pill was a `W_TEXT_OVERFLOW`. The
 * published pills are all one height and the type inside them varies, so the title now asks
 * for `shrink`, which `compile` resolves against the faces: the long title comes out smaller
 * and nothing is reported.
 *
 * Two briefs with the same shape and different title lengths is what says that. A single
 * brief could only show a number.
 */
describe('the pill that cannot grow, and shrinks its title instead', () => {
  const AGENDA = join(PACK, 'agenda-semana');

  const briefWith = (titulo: string) =>
    `---
template: agenda-semana
formats: [retrato]
---
` +
    `::titulo
  AGENDA DA SEMANA

` +
    `::slide
  SERVIÇO SOCIAL
  16/09 - 19:00 | ${titulo} | Profª. Coimbra Almeida
`;

  const titleOf = async (titulo: string) => {
    const { scene, warnings } = await buildSource(briefWith(titulo), 'agenda-semana', AGENDA);
    const [node] = scene.artworks
      .flatMap((artwork) => artwork.frames)
      .flatMap((frame) => named(frame.children, 'session-title'));
    const sizes =
      node?.kind === 'text'
        ? node.runs.flatMap((run) => (run.kind === 'text' ? [run.size] : []))
        : [];
    return { sizes, overflow: warnings.filter((item) => item.code === 'W_TEXT_OVERFLOW') };
  };

  const SHORT = 'Farmacologia Geral';
  const LONG =
    'Sistema de Garantia dos Direitos da Criança e do Adolescente no âmbito do atendimento hospitalar';

  it('says nothing about a title that fits, and draws it at its declared size', async () => {
    const { sizes, overflow } = await titleOf(SHORT);

    expect(overflow.map((item) => item.message)).toEqual([]);
    expect(new Set(sizes).size).toBe(1);
  }, 60_000);

  it('draws a title that does not fit smaller, and still says nothing', async () => {
    const short = await titleOf(SHORT);
    const long = await titleOf(LONG);

    expect(long.overflow.map((item) => item.message)).toEqual([]);
    expect(Math.max(...long.sizes)).toBeLessThan(Math.min(...short.sizes));
  }, 60_000);
});

/** Every node below `nodes` with this name, groups included. */
function named(nodes: readonly SceneNode[], name: string): SceneNode[] {
  return nodes.flatMap((node) => [
    ...(node.name === name ? [node] : []),
    ...(node.kind === 'group' ? named(node.children, name) : []),
  ]);
}

describe('tyto template check', () => {
  /**
   * The card's second criterion, run the way it is written: the binary, not the function
   * behind it. `check` reads the manifest and the markup and nothing else — no brief, no
   * formats.yaml — so it is the one thing that can say a template is wrong on its own.
   */
  it.each(EXAMPLES.map((example) => [example.template, example] as const))(
    '%s: no problems found, and says what it did not check',
    async (_name, example) => {
      const { stderr } = await runBinary(process.execPath, [
        CLI,
        'template',
        'check',
        join(PACK, example.template),
      ]);

      // `check` writes its report to stderr and exits 0 when nothing is wrong; a non-zero
      // exit rejects the promise, so reaching here is already half the assertion.
      expect(stderr).toContain('no problems found');
      // The other half, per route (TYTO-170): a code body is named as unchecked, and a
      // markup body — which was compiled against the manifest — is not.
      if (example.body === 'code') {
        expect(stderr).toContain('manifest: no problems found');
        expect(stderr).toContain('not checked: the template body');
      } else {
        expect(stderr).not.toContain('not checked');
      }
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
    ).toEqual(['agenda-semana', 'carrossel-lista', 'promo-curso']);
    // A manifest that does not parse becomes a failure rather than an exception, so an
    // empty list and a broken pack look alike unless this is checked.
    expect(registry.value.failures).toEqual([]);
  }, 60_000);
});

describe('the pack as the CLI finds it, with no --templates (ADR 0020)', () => {
  /**
   * The folder path above and the pack path here, side by side, so the two are checked to
   * agree rather than assumed to. TYTO-25 shipped the folders and TYTO-66 made them
   * findable; nothing until now compared what the two ways of reaching them answer.
   *
   * Through the binary, from a directory that has no templates of its own, because the
   * whole claim is about what happens when nobody points at anything.
   */
  let project: string;

  beforeAll(async () => {
    project = await mkdtemp(join(tmpdir(), 'tyto-pack-contract-'));
    await writeFile(join(project, 'formats.yaml'), await readFile(join(PACK, 'formats.yaml')));
  }, 60_000);

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it.each(EXAMPLES.map((example) => example.template))(
    '%s is on the search path of a project that has no templates folder',
    async (name) => {
      // A brief naming a template that does not exist, so the error lists what does. That
      // list is the registry seen from outside the process, which is the only place the
      // resolution rule can be observed without trusting the code that implements it.
      await writeFile(
        join(project, 'brief.brief'),
        '---\ntemplate: nao-existe\nformats: [feed]\n---\n',
        'utf8',
      );

      const failed = await runBinary(
        process.execPath,
        [CLI, 'render', 'brief.brief', '--out', 'out', '--types', 'svg'],
        // From the temp project, which is the whole point: a directory with a
        // `formats.yaml` and no templates of its own.
        { cwd: project },
      ).catch((cause: { stderr?: string }) => cause);

      const stderr = 'stderr' in failed ? (failed.stderr ?? '') : '';
      expect(stderr).toContain('E_UNKNOWN_TEMPLATE');
      expect(stderr).toContain(name);
      // And the folder nobody named is not complained about, even though it is absent.
      expect(stderr).not.toContain('E_TEMPLATE_READ');
    },
    120_000,
  );

  it('answers the same manifest whether reached as a folder or as the pack', async () => {
    // `--templates <the pack>` is the pre-ADR-0020 way and still has to work, and it has to
    // mean the same thing. Same names, same versions, and no self-shadowing from the folder
    // appearing on the search path twice.
    const asFolder = await loadTemplateRegistry(fileSystem, PACK);
    if (!asFolder.ok) throw new Error(asFolder.error.map((item) => item.message).join('; '));

    const asBoth = await loadTemplateRegistry(fileSystem, [PACK, PACK]);
    if (!asBoth.ok) throw new Error(asBoth.error.map((item) => item.message).join('; '));

    expect(asBoth.value.list()).toEqual(asFolder.value.list());
    expect(asBoth.diagnostics).toEqual([]);
  }, 60_000);
});

describe('the fonts the pack draws in, as a render embeds them (ADR 0021)', () => {
  /**
   * TYTO-87's criteria, run the way they are written: the binary, from a project that says
   * nothing about templates or fonts, asserting on the **bytes** and not on the family
   * name. Before this the same command produced no artifact at all — four
   * `E_EXPORT_FONT_UNRESOLVED` per run, one per face per frame — because the faces sat in a
   * folder at the repository root that nothing shippable could reach.
   *
   * A family name would pass against a document that embedded nothing: the `font-family` in
   * the CSS comes from the scene, not from a resolver. The SHA-256 of what came out against
   * the SHA-256 of what is on disk is the assertion that cannot be satisfied by a
   * near-miss.
   */
  let project: string;

  beforeAll(async () => {
    project = await mkdtemp(join(tmpdir(), 'tyto-fonts-contract-'));
    await writeFile(join(project, 'formats.yaml'), await readFile(join(PACK, 'formats.yaml')));
    await writeFile(
      join(project, 'promo.brief'),
      await readFile(join(PACK, 'promo-curso/examples/promo.brief')),
    );
  }, 60_000);

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it('renders promo-curso with no --templates and no font flag, and embeds the bundled faces', async () => {
    const { stderr } = await runBinary(
      process.execPath,
      [CLI, 'render', 'promo.brief', '--out', 'out', '--types', 'svg'],
      { cwd: project },
    );

    // A non-zero exit rejects the promise, so reaching here already says the export did not
    // refuse. This is the wording that used to be here four times.
    expect(stderr).not.toContain('E_EXPORT_FONT_UNRESOLVED');

    const svg = await readFile(join(project, 'out/artwork-1-feed.svg'), 'utf8');
    const embedded = [...svg.matchAll(/url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/g)]
      .map((match) => Buffer.from(match[1] ?? '', 'base64'))
      .map((bytes) => createHash('sha256').update(bytes).digest('hex'));

    // Both weights the template draws in, and nothing else: an `@font-face` per face the
    // scene declared.
    expect(embedded).toHaveLength(2);

    const onDisk = await Promise.all(
      ['SourceSans3-Regular.ttf.woff2', 'SourceSans3-Bold.ttf.woff2'].map(async (file) =>
        createHash('sha256')
          .update(await readFile(join(bundledFontsDirectory(), 'source-sans-3', file)))
          .digest('hex'),
      ),
    );

    expect([...embedded].sort()).toEqual([...onDisk].sort());
  }, 120_000);

  it('reads its outlines out of the same package, so measuring and drawing cannot drift', () => {
    // The other half of the port, and the reason `@tyto/fonts`'s README requires the `.ttf`
    // and the `.woff2` to come from one upstream release. `faces` above is built from this.
    const path = bundledFontOutlinePath({ family: 'Source Sans 3', weight: 400, style: 'normal' });

    expect(path?.startsWith(bundledFontsDirectory())).toBe(true);
    expect(
      bundledFontSource.outlines({ family: 'Source Sans 3', weight: 400, style: 'normal' }),
    ).toBeDefined();
  });
});
