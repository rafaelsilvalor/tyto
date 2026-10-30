import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPluginHost } from '@tyto/plugin-api';
import { BUILT_IN_TEMPLATE_NAMES } from '@tyto/templates';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { builtInTemplatesDirectory, templatePackPlugin } from './plugins/templates.js';
import { run } from './program.js';
import { loadRenderContext } from './render-context.js';

/**
 * The built-in pack, as a user meets it (ADR 0020, TYTO-66).
 *
 * The card's first acceptance criterion is that `tyto render` finds `promo-curso` with no
 * `--templates` flag at all, and its second is that a project's own folder of that name
 * resolves to exactly one template by a stated rule. Both are about **discovery**, so the
 * assertions here are about which template a name means and which folder it came from —
 * not about bytes.
 *
 * They stop short of a render on purpose, and it is not a gap in the tests. A built-in
 * template draws text in `Source Sans 3`, and nothing hands a render job embeddable font
 * bytes yet — `packages/io/src/file-resources.ts` says so in its own doc comment, and the
 * CLI's other fixture is text-free for exactly that reason. A test that rendered one would
 * be a test about `E_EXPORT_FONT_UNRESOLVED`.
 */

const TYTO_VERSION = '0.0.0-test';

const FORMATS = 'feed: { w: 1080, h: 1080 }\nstory: { w: 1080, h: 1920 }\n';

const MANIFEST = (name: string, version: string) => `name: ${name}
version: ${version}
formats: [feed]
slots:
  titulo: { type: rich-text }
`;

const MARKUP = '<frame format="feed" bg="#ffffff" />\n';

let workspace: string;
let out: string[];
let errors: string[];

function environment(overrides: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    console: {
      out: (text) => out.push(text),
      err: (text) => errors.push(text),
    },
    version: TYTO_VERSION,
    cwd: workspace,
    rasterizer: () => {
      throw new Error('these tests never raster');
    },
    ...overrides,
  };
}

/** A templates folder with one template in it, written where the test asks. */
async function templateFolder(root: string, name: string, version = '1.0.0'): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'manifest.yaml'), MANIFEST(name, version), 'utf8');
  await writeFile(join(directory, 'template.html'), MARKUP, 'utf8');
  return directory;
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-pack-'));
  out = [];
  errors = [];
  await writeFile(join(workspace, 'formats.yaml'), FORMATS, 'utf8');
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('the pack reaches the registry through the extension point', () => {
  it('registers a directory, which is what the registry then searches', () => {
    // Registered and not read would be an extension point nobody could tell was broken,
    // which is the shape ADR 0007 exists to prevent.
    const host = createPluginHost();
    host.activate(templatePackPlugin());

    const [pack] = host.registry.templatePacks();
    expect(pack?.id).toBe('built-in-templates');
    expect(pack?.directory).toBe(builtInTemplatesDirectory());
  });

  it('resolves @tyto/templates by its own package.json, not by guessing at node_modules', () => {
    // The path has to be right in a pnpm workspace, in a published install and inside an
    // Electron asar. Resolving the package's own manifest is what makes all three the same
    // question.
    expect(builtInTemplatesDirectory().replace(/\\/gu, '/')).toMatch(
      /packages\/templates\/templates$/u,
    );
  });
});

describe('a project with no templates folder of its own', () => {
  it('finds the built-ins anyway', async () => {
    const context = await loadRenderContext({
      templatesDirectory: join(workspace, 'templates'),
      formatsFile: join(workspace, 'formats.yaml'),
      templatesDirectoryIsDefault: true,
    });
    if (!context.ok) throw new Error('expected a context');

    expect(context.value.registry.list().map((entry) => entry.name)).toEqual([
      ...BUILT_IN_TEMPLATE_NAMES,
    ]);
  });

  it('says nothing about the folder it never mentioned', async () => {
    // The default `templates/` not existing stopped being a mistake the moment a project
    // without one started rendering. A complaint about it would open every such run.
    const context = await loadRenderContext({
      templatesDirectory: join(workspace, 'templates'),
      formatsFile: join(workspace, 'formats.yaml'),
      templatesDirectoryIsDefault: true,
    });
    if (!context.ok) throw new Error('expected a context');

    expect(context.diagnostics).toEqual([]);
  });

  it('still reports a folder the user named and does not have', async () => {
    const context = await loadRenderContext({
      templatesDirectory: join(workspace, 'nao-existe'),
      formatsFile: join(workspace, 'formats.yaml'),
      templatesDirectoryIsDefault: false,
    });
    if (!context.ok) throw new Error('expected a context');

    expect(context.diagnostics.map((item) => item.code)).toEqual(['E_TEMPLATE_READ']);
  });
});

describe('a project that has a template of the same name', () => {
  it('resolves the name to the project folder, and warns about the one it hid', async () => {
    const packRoot = join(workspace, 'pack');
    const projectRoot = join(workspace, 'templates');
    const mine = await templateFolder(projectRoot, 'promo-curso', '9.9.9');
    const theirs = await templateFolder(packRoot, 'promo-curso', '1.0.0');
    await templateFolder(packRoot, 'so-do-pack');

    const context = await loadRenderContext({
      templatesDirectory: projectRoot,
      formatsFile: join(workspace, 'formats.yaml'),
      builtInTemplatesDirectory: packRoot,
    });
    if (!context.ok) throw new Error('expected a context');

    expect(context.value.registry.directoryOf('promo-curso')).toBe(mine);
    expect(context.value.registry.get('promo-curso')?.version).toBe('9.9.9');
    // Exactly one template answers the name, which is the acceptance criterion, and the
    // other is named rather than dropped in silence.
    expect(context.diagnostics.map((item) => item.code)).toEqual(['W_TEMPLATE_SHADOWED']);
    expect(context.diagnostics[0]?.message).toContain(theirs);
    // And the pack's other template is still there: shadowing is per name, not per pack.
    expect(context.value.registry.get('so-do-pack')).toBeDefined();
  });
});

describe('tyto render, with no --templates at all', () => {
  it('knows the built-in names without being pointed at them', async () => {
    // End to end through the command line, against the pack as it really ships. The brief
    // names a template that does not exist, so the run fails — on purpose: what is under
    // test is the list of names `E_UNKNOWN_TEMPLATE` offers, which is the registry's
    // contents seen from outside.
    await writeFile(
      join(workspace, 'brief.brief'),
      '---\ntemplate: nao-existe\nformats: [feed]\n---\n',
      'utf8',
    );

    await run(['render', 'brief.brief', '--out', 'out', '--types', 'svg'], environment());

    const reported = errors.join('');
    expect(reported).toContain('E_UNKNOWN_TEMPLATE');
    for (const name of BUILT_IN_TEMPLATE_NAMES) expect(reported).toContain(name);
    // The folder nobody named is not mentioned, even though it is not there.
    expect(reported).not.toContain('E_TEMPLATE_READ');
  });

  it('lists the built-ins in result.json, because they were on the search path', async () => {
    await templateFolder(join(workspace, 'templates'), 'meu-cartaz');
    await writeFile(
      join(workspace, 'brief.brief'),
      '---\ntemplate: meu-cartaz\nformats: [feed]\n---\n',
      'utf8',
    );

    const code = await run(
      ['render', 'brief.brief', '--out', 'out', '--types', 'svg'],
      environment(),
    );

    expect(code).toBe(EXIT_OK);
    const document = JSON.parse(await readFile(join(workspace, 'out', 'result.json'), 'utf8')) as {
      tyto: { templates: { name: string }[] };
    };

    expect(document.tyto.templates.map((entry) => entry.name).sort()).toEqual(
      [...BUILT_IN_TEMPLATE_NAMES, 'meu-cartaz'].sort(),
    );
  });
});
