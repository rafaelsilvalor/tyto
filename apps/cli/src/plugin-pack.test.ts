import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * An installed template pack, from `tyto plugin install` to `tyto render` (TYTO-50,
 * ADR 0046) — against a real temp disk and the real worker thread.
 *
 * The example pack is the one in `examples/plugins/`, installed from that folder exactly as
 * `docs/plugin-authoring.md` tells an author to install theirs. The scaffold is installed
 * the moment `tyto plugin new` has written it, with nothing edited in between: that it
 * renders on the first try is the claim.
 */

const EXAMPLE_PACK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'examples',
  'plugins',
  'tyto-plugin-example-pack',
);

let workspace: string;
let home: string;
let out: string[];
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: {
      out: (text) => out.push(text),
      err: (text) => errors.push(text),
    },
    version: '0.0.0-test',
    cwd: workspace,
    home,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  };
}

const stderr = (): string => errors.join('');

interface Rendered {
  readonly code: number;
  readonly artifacts: readonly string[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

async function render(brief: string, formatsFile: string, types = 'svg'): Promise<Rendered> {
  const code = await run(
    ['render', brief, '--out', 'out', '--formats-file', formatsFile, '--types', types],
    environment(),
  );
  const result = JSON.parse(await readFile(join(workspace, 'out', 'result.json'), 'utf8')) as {
    artifacts: { name: string }[];
    diagnostics: { code: string; message: string }[];
  };
  return {
    code,
    artifacts: result.artifacts.map((artifact) => artifact.name),
    diagnostics: result.diagnostics,
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-pack-plugin-'));
  home = join(workspace, 'home', '.tyto');
  out = [];
  errors = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('the example pack', () => {
  const brief = join(EXAMPLE_PACK, 'templates', 'aviso', 'examples', 'aviso.brief');
  const formats = join(EXAMPLE_PACK, 'templates', 'formats.yaml');

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('installs from its folder and renders its template', async () => {
    expect(await run(['plugin', 'install', EXAMPLE_PACK, '--yes'], environment()), stderr()).toBe(
      EXIT_OK,
    );

    const rendered = await render(brief, formats);

    expect(rendered.code, stderr()).toBe(EXIT_OK);
    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.artifacts).toEqual(['artwork-1-feed.svg', 'artwork-1-story.svg']);
    const svg = await readFile(join(workspace, 'out', 'artwork-1-feed.svg'), 'utf8');
    // The brief's text, drawn by the pack's template: `cor: laranja` is its orange.
    expect(svg).toMatch(/^<svg/u);
    expect(svg).toContain('#ff5900');
  }, 60_000);

  it('is not a template Tyto knows until it is installed', async () => {
    const rendered = await render(brief, formats);

    expect(rendered.code).toBe(EXIT_DIAGNOSTICS);
    expect(rendered.diagnostics.map((item) => item.code)).toContain('E_UNKNOWN_TEMPLATE');
  });

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('stops being one once disabled', async () => {
    await run(['plugin', 'install', EXAMPLE_PACK, '--yes'], environment());
    await run(['plugin', 'disable', 'example-pack'], environment());

    const rendered = await render(brief, formats);

    expect(rendered.diagnostics.map((item) => item.code)).toContain('E_UNKNOWN_TEMPLATE');
  }, 60_000);
});

describe('the example pack in tyto watch', () => {
  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('renders a task that names its template', async () => {
    await run(['plugin', 'install', EXAMPLE_PACK, '--yes'], environment());
    const task = join(workspace, 'queue', 'inbox', 'aviso-1');
    await mkdir(task, { recursive: true });
    await cp(
      join(EXAMPLE_PACK, 'templates', 'aviso', 'examples', 'aviso.brief'),
      join(task, 'brief.brief'),
    );

    const code = await run(
      [
        'watch',
        'queue',
        '--once',
        '--types',
        'svg',
        '--formats-file',
        join(EXAMPLE_PACK, 'templates', 'formats.yaml'),
      ],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    expect((await readdir(join(workspace, 'queue', 'outbox', 'aviso-1', 'out'))).sort()).toEqual([
      'artwork-1-feed.svg',
      'artwork-1-story.svg',
      'result.json',
    ]);
  }, 60_000);
});

describe('tyto plugin new', () => {
  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('scaffolds a pack that installs, checks and renders with nothing edited', async () => {
    expect(await run(['plugin', 'new', 'meu-pack', '--out', 'sources'], environment())).toBe(
      EXIT_OK,
    );
    const folder = join(workspace, 'sources', 'meu-pack');
    const template = join(folder, 'templates', 'meu-pack');

    expect(await run(['template', 'check', template], environment()), stderr()).toBe(EXIT_OK);
    expect(await run(['plugin', 'install', folder, '--yes'], environment()), stderr()).toBe(
      EXIT_OK,
    );
    const rendered = await render(
      join(template, 'examples', 'meu-pack.brief'),
      join(folder, 'templates', 'formats.yaml'),
    );

    expect(rendered.code, stderr()).toBe(EXIT_OK);
    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.artifacts).toEqual(['artwork-1-feed.svg']);
  }, 60_000);

  it('writes the layout the example pack has', async () => {
    await run(['plugin', 'new', 'meu-pack', '--out', 'sources'], environment());

    const files = async (root: string): Promise<string[]> =>
      (await readdir(root, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
        .map((path) => path.replaceAll('\\', '/'))
        .sort();

    const scaffolded = await files(join(workspace, 'sources', 'meu-pack'));
    const example = await files(EXAMPLE_PACK);
    const shape = (paths: string[], template: string): string[] =>
      paths.map((path) => path.replaceAll(template, '<template>')).sort();

    expect(shape(scaffolded, 'meu-pack')).toEqual(shape(example, 'aviso'));
  });

  it("declares the engine this CLI's plugin API satisfies", async () => {
    await run(['plugin', 'new', 'meu-pack', '--out', 'sources'], environment());

    const manifest = JSON.parse(
      await readFile(join(workspace, 'sources', 'meu-pack', 'tyto-plugin.json'), 'utf8'),
    ) as { engine: string };
    expect(manifest.engine).toBe(`>=${PLUGIN_API_VERSION}`);
  });

  it('refuses a name install would refuse, and writes nothing', async () => {
    expect(await run(['plugin', 'new', 'Meu_Pack', '--out', 'sources'], environment())).toBe(
      EXIT_DIAGNOSTICS,
    );
    expect(stderr()).toContain("Plugin manifest is invalid at 'name'");
    await expect(readdir(join(workspace, 'sources'))).rejects.toThrow();
  });

  it('refuses a plugin name that is not a template name', async () => {
    expect(await run(['plugin', 'new', '2d', '--out', 'sources'], environment())).toBe(
      EXIT_DIAGNOSTICS,
    );
    expect(stderr()).toContain("'2d' is a plugin name but not a template name");
  });

  it('never overwrites a plugin folder that is already there', async () => {
    await run(['plugin', 'new', 'meu-pack', '--out', 'sources'], environment());
    errors = [];

    expect(await run(['plugin', 'new', 'meu-pack', '--out', 'sources'], environment())).toBe(
      EXIT_DIAGNOSTICS,
    );
    expect(stderr()).toContain('Could not create');
  });
});

describe('docs/plugin-authoring.md', () => {
  const guide = (): Promise<string> =>
    readFile(resolve(EXAMPLE_PACK, '..', '..', '..', 'docs', 'plugin-authoring.md'), 'utf8');

  it('prints what tyto plugin new prints', async () => {
    await run(['plugin', 'new', 'meu-pack'], environment());
    const printed = `${out.join('')}${stderr()}`.replaceAll('\\', '/');

    expect(await guide()).toContain(`$ tyto plugin new meu-pack\n${printed}\`\`\``);
  });

  it('prints the manifest and the activate function the scaffold writes', async () => {
    await run(['plugin', 'new', 'meu-pack'], environment());
    const folder = join(workspace, 'meu-pack');
    const manifest = await readFile(join(folder, 'tyto-plugin.json'), 'utf8');
    const entry = await readFile(join(folder, 'dist', 'index.js'), 'utf8');
    const activate = entry.slice(entry.indexOf('export function activate'));

    const text = await guide();
    expect(text).toContain(`\`\`\`json\n${manifest}\`\`\``);
    expect(text).toContain(`\`\`\`js\n${activate}\`\`\``);
  });
});

/* ------------------------------------------------------------- what is refused (0046) -- */

/**
 * A pack plugin whose `activate` registers `directory` verbatim. `exporter: true` adds a
 * `txt` exporter beside it, to see that a refused pack refuses the whole plugin.
 */
async function packPlugin(
  directory: string,
  options: { readonly name?: string; readonly exporter?: boolean } = {},
): Promise<string> {
  const name = options.name ?? 'pacote';
  const folder = join(workspace, 'sources', name);
  await cp(join(EXAMPLE_PACK, 'templates'), join(folder, 'templates'), { recursive: true });
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: options.exporter === true ? ['template-pack', 'exporter'] : ['template-pack'],
      permissions: [],
    }),
  );
  const exporter =
    options.exporter === true
      ? `  host.registerExporter({ id: 'texto', mime: 'text/plain', extension: 'txt', kinds: ['txt'], rasterized: false, exportFrame: () => ({ ok: true, value: 'x', diagnostics: [] }) });\n`
      : '';
  await writeFile(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {\n  host.registerTemplatePack({ id: ${JSON.stringify(name)}, templates: [], directory: ${JSON.stringify(directory)} });\n${exporter}}\n`,
  );
  return folder;
}

/** Renders the example brief through a pack installed from `folder`. */
async function renderThrough(folder: string): Promise<Rendered> {
  expect(await run(['plugin', 'install', folder, '--yes'], environment()), stderr()).toBe(EXIT_OK);
  return render(
    join(EXAMPLE_PACK, 'templates', 'aviso', 'examples', 'aviso.brief'),
    join(EXAMPLE_PACK, 'templates', 'formats.yaml'),
  );
}

function skipped(rendered: Rendered): string[] {
  return rendered.diagnostics
    .filter((item) => item.code === 'W_PLUGIN_SKIPPED')
    .map((item) => item.message);
}

describe('a pack folder outside its plugin', () => {
  it.each([
    ['a climb out', '../outside', 'it leads out of the plugin folder'],
    [
      'an absolute path',
      join(tmpdir(), 'elsewhere'),
      'it is an absolute path rather than one relative to the plugin folder',
    ],
    [
      'a drive letter, on any platform',
      'C:\\templates',
      'it is an absolute path rather than one relative to the plugin folder',
    ],
    [
      'a root, on any platform',
      '/templates',
      'it is an absolute path rather than one relative to the plugin folder',
    ],
    ['an encoded climb, which is only a name', '%2e%2e', 'there is no such folder in the plugin'],
  ])(
    'refuses %s by name, and renders without it',
    async (_case, directory, problem) => {
      const rendered = await renderThrough(await packPlugin(directory));

      expect(skipped(rendered)).toEqual([
        `Plugin 'pacote' was skipped: Plugin 'pacote' contributes template pack folder '${directory}', and ${problem}.`,
      ]);
      expect(rendered.diagnostics.map((item) => item.code)).toContain('E_UNKNOWN_TEMPLATE');
    },
    60_000,
  );

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('refuses a link that leads out, which only the real path shows', async () => {
    const outside = join(workspace, 'outside');
    await cp(join(EXAMPLE_PACK, 'templates'), outside, { recursive: true });
    expect(
      await run(['plugin', 'install', await packPlugin('linked'), '--yes'], environment()),
    ).toBe(EXIT_OK);
    // Made in the installed folder, after install: `install` cannot copy a link on Windows
    // without an administrator. A junction there, which needs none; a symbolic link elsewhere.
    await symlink(outside, join(home, 'plugins', 'pacote', 'linked'), 'junction');

    const rendered = await render(
      join(EXAMPLE_PACK, 'templates', 'aviso', 'examples', 'aviso.brief'),
      join(EXAMPLE_PACK, 'templates', 'formats.yaml'),
    );

    expect(skipped(rendered)).toEqual([
      "Plugin 'pacote' was skipped: Plugin 'pacote' contributes template pack folder 'linked', and a link in it leads out of the plugin folder.",
    ]);
  }, 60_000);

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('refuses the whole plugin, so its exporter is not offered either', async () => {
    await run(
      ['plugin', 'install', await packPlugin('../outside', { exporter: true }), '--yes'],
      environment(),
    );

    const code = await run(
      [
        'render',
        join(EXAMPLE_PACK, 'templates', 'aviso', 'examples', 'aviso.brief'),
        '--out',
        'out',
        '--formats-file',
        join(EXAMPLE_PACK, 'templates', 'formats.yaml'),
        '--types',
        'txt',
      ],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain("'txt' is not an output type any installed exporter produces.");
  }, 60_000);
});

describe('a code template in an installed pack', () => {
  it.each([
    ['a template.ts beside the markup', 'template.ts'],
    ['no template.html at all', undefined],
  ])(
    'refuses %s, naming the plugin and the template',
    async (_case, extra) => {
      const folder = await packPlugin('templates');
      const template = join(folder, 'templates', 'aviso');
      if (extra === undefined) {
        await rm(join(template, 'template.html'));
      } else {
        await writeFile(join(template, extra), 'export default () => undefined;\n');
      }

      const rendered = await renderThrough(folder);

      expect(skipped(rendered)).toEqual([
        "Plugin 'pacote' was skipped: Plugin 'pacote' contributes template 'aviso', which is not a markup template: an installed pack may hold only folders with a template.html and no template.ts.",
      ]);
      expect(rendered.diagnostics.map((item) => item.code)).toContain('E_UNKNOWN_TEMPLATE');
    },
    60_000,
  );
});

describe('an installed template with a built-in name', () => {
  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is shadowed by the built-in, and the run says so', async () => {
    const folder = await packPlugin('templates');
    const manifest = join(folder, 'templates', 'aviso', 'manifest.yaml');
    await writeFile(
      manifest,
      (await readFile(manifest, 'utf8')).replace('name: aviso', 'name: promo-curso'),
    );

    const rendered = await renderThrough(folder);

    const shadowed = rendered.diagnostics.filter((item) => item.code === 'W_TEMPLATE_SHADOWED');
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0]?.message).toMatch(
      /^Template 'promo-curso' in '.*pacote.templates.aviso' is shadowed by the one in '.*promo-curso', which is searched first\.$/u,
    );
  }, 60_000);
});
