import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * TYTO-432's acceptance: the plugin files fetched by `tyto plugin sync` and `tyto render`, and
 * a render that finds what they name (ADR 0151).
 *
 * **No network, and no fake of one**, as `plugin-install.test.ts` does it: every source is a
 * `file://` repository this file makes with `git init`, so the fetch is exactly the
 * `git fetch --depth 1` a real URL gets. The plugin is `examples/plugins/`'s pack, committed
 * with its `dist/` as a template repository commits its release.
 */

const exec = promisify(execFile);

const EXAMPLE_PACK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ...['..', '..', '..', 'examples', 'plugins', 'tyto-plugin-example-pack'],
);
const BRIEF = join(EXAMPLE_PACK, 'templates', 'aviso', 'examples', 'aviso.brief');
const FORMATS = join(EXAMPLE_PACK, 'templates', 'formats.yaml');
/** The pack's orange, which the tests repaint to tell one commit's render from another's. */
const ORANGE = '#ff5900';

const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let workspace: string;
let home: string;
let out: string[];
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: { out: (text) => out.push(text), err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    home,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  };
}

const stderr = (): string => errors.join('');

async function git(folder: string, ...args: string[]): Promise<string> {
  return (await exec('git', [...AUTHOR, '-C', folder, ...args])).stdout.trim();
}

/**
 * The example pack as a repository on `main`, tagged `v1`. `plugin` and `template` rename it,
 * so two sources can sit side by side without shadowing each other.
 */
async function repository(
  name: string,
  plugin = 'example-pack',
  template = 'aviso',
): Promise<string> {
  const folder = join(workspace, 'repositories', name);
  await cp(EXAMPLE_PACK, folder, { recursive: true });
  await edit(join(folder, 'tyto-plugin.json'), (text) =>
    text.replace('"example-pack"', `"${plugin}"`),
  );
  // The pack's id is in its code too, and two plugins may not register one id.
  await edit(join(folder, 'dist', 'index.js'), (text) =>
    text.replace("id: 'example-pack'", `id: '${plugin}'`),
  );
  if (template !== 'aviso') {
    await rename(join(folder, 'templates', 'aviso'), join(folder, 'templates', template));
    await edit(join(folder, 'templates', template, 'manifest.yaml'), (text) =>
      text.replace(/^name: aviso$/mu, `name: ${template}`),
    );
  }
  await exec('git', ['init', '--quiet', '--initial-branch=main', folder]);
  await git(folder, 'add', '.');
  await git(folder, 'commit', '--quiet', '-m', 'release');
  await git(folder, 'tag', 'v1');
  return folder;
}

async function edit(path: string, change: (text: string) => string): Promise<void> {
  await writeFile(path, change(await readFile(path, 'utf8')), 'utf8');
}

/** A new commit on `main` that paints the template `colour` instead of orange. */
async function repaint(folder: string, colour: string, template = 'aviso'): Promise<string> {
  await edit(join(folder, 'templates', template, 'template.html'), (text) =>
    text.replaceAll(ORANGE, colour),
  );
  await git(folder, 'commit', '--quiet', '-am', `paint ${colour}`);
  return git(folder, 'rev-parse', 'HEAD');
}

const urlOf = (folder: string): string => pathToFileURL(folder).href;

function pluginFile(entries: Record<string, { git: string; ref: string }>): string {
  return `version: 1\ntemplates:\n${Object.entries(entries)
    .map(
      ([name, source]) =>
        `  ${name}:\n    source: { git: '${source.git}', ref: '${source.ref}' }\n`,
    )
    .join('')}`;
}

async function machineFile(entries: Record<string, { git: string; ref: string }>): Promise<void> {
  await mkdir(join(home, 'plugin-files'), { recursive: true });
  await writeFile(join(home, 'plugin-files', 'templates.yaml'), pluginFile(entries), 'utf8');
}

interface Lock {
  readonly sources: readonly { git: string; ref: string; commit: string; plugin: string }[];
}

async function lockOf(folder: string): Promise<Lock> {
  return JSON.parse(await readFile(join(folder, 'plugin-files.lock.json'), 'utf8')) as Lock;
}

const commitOf = async (lock: Lock, git: string): Promise<string | undefined> =>
  lock.sources.find((entry) => entry.git === git)?.commit;

async function sync(...flags: string[]): Promise<number> {
  return run(['plugin', 'sync', ...flags], environment());
}

interface Rendered {
  readonly code: number;
  readonly svg: string;
  readonly codes: readonly string[];
}

/** Renders `brief` as svg and answers its first frame, and the codes `result.json` holds. */
async function render(brief = BRIEF): Promise<Rendered> {
  const code = await run(
    ['render', brief, '--out', 'out', '--formats-file', FORMATS, '--types', 'svg'],
    environment(),
  );
  const result = JSON.parse(await readFile(join(workspace, 'out', 'result.json'), 'utf8')) as {
    artifacts: { name: string }[];
    diagnostics: { code: string }[];
  };
  const [first] = result.artifacts;
  const svg = first === undefined ? '' : await readFile(join(workspace, 'out', first.name), 'utf8');
  return { code, svg, codes: result.diagnostics.map((item) => item.code) };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-plugin-files-'));
  home = join(workspace, 'home', '.tyto');
  out = [];
  errors = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// Each test runs git a dozen times and starts a plugin's process: past Vitest's 5 s default.
const SLOW = 60_000;

describe('two entries', () => {
  it(
    'syncs both, pins each commit in the lock, and a render finds the template',
    async () => {
      const first = await repository('first');
      const second = await repository('second', 'second-pack', 'aviso-b');
      await machineFile({
        aviso: { git: urlOf(first), ref: 'v1' },
        'aviso-b': { git: urlOf(second), ref: 'v1' },
      });

      expect(await sync(), stderr()).toBe(EXIT_OK);

      const lock = await lockOf(join(home, 'plugin-files'));
      expect(await commitOf(lock, urlOf(first))).toBe(await git(first, 'rev-parse', 'v1'));
      expect(await commitOf(lock, urlOf(second))).toBe(await git(second, 'rev-parse', 'v1'));
      expect(lock.sources.map((entry) => entry.plugin).sort()).toEqual([
        'example-pack',
        'second-pack',
      ]);
      // One copy per commit, without the history.
      const copies = await readdir(join(home, 'cache', 'plugin-files'));
      expect(copies).toHaveLength(2);

      const rendered = await render();
      expect(rendered.code, stderr()).toBe(EXIT_OK);
      expect(rendered.codes).toEqual([]);
      expect(rendered.svg).toContain(ORANGE);
    },
    SLOW,
  );

  it(
    'keeps a moving ref pinned until --update, and a changed ref moves only its entry',
    async () => {
      const first = await repository('first');
      const second = await repository('second', 'second-pack', 'aviso-b');
      await machineFile({
        aviso: { git: urlOf(first), ref: 'main' },
        'aviso-b': { git: urlOf(second), ref: 'main' },
      });
      await sync();
      const pinned = await lockOf(join(home, 'plugin-files'));

      const firstMoved = await repaint(first, '#0000ff');
      await repaint(second, '#00ff00', 'aviso-b');
      await git(second, 'tag', 'v2');

      // A render after a push renders what the lock pins, not what the branch holds now.
      expect((await render()).svg).toContain(ORANGE);
      expect(await lockOf(join(home, 'plugin-files'))).toEqual(pinned);

      // The second entry's ref changes in the file: that entry alone is resolved again.
      await machineFile({
        aviso: { git: urlOf(first), ref: 'main' },
        'aviso-b': { git: urlOf(second), ref: 'v2' },
      });
      expect(await sync(), stderr()).toBe(EXIT_OK);
      const changed = await lockOf(join(home, 'plugin-files'));
      expect(await commitOf(changed, urlOf(first))).toBe(await commitOf(pinned, urlOf(first)));
      expect(await commitOf(changed, urlOf(second))).toBe(await git(second, 'rev-parse', 'v2'));

      // The explicit update moves the branch.
      expect(await sync('--update'), stderr()).toBe(EXIT_OK);
      expect(await commitOf(await lockOf(join(home, 'plugin-files')), urlOf(first))).toBe(
        firstMoved,
      );
      expect((await render()).svg).toContain('#0000ff');
    },
    SLOW,
  );

  it(
    'stops loading an entry removed from the files, keeps its copy, and clean deletes it',
    async () => {
      const first = await repository('first');
      const second = await repository('second', 'second-pack', 'aviso-b');
      await machineFile({
        aviso: { git: urlOf(first), ref: 'v1' },
        'aviso-b': { git: urlOf(second), ref: 'v1' },
      });
      await sync();

      await machineFile({ 'aviso-b': { git: urlOf(second), ref: 'v1' } });
      expect(await sync(), stderr()).toBe(EXIT_OK);

      expect((await lockOf(join(home, 'plugin-files'))).sources).toHaveLength(1);
      expect((await render()).codes).toContain('E_UNKNOWN_TEMPLATE');
      expect(await readdir(join(home, 'cache', 'plugin-files'))).toHaveLength(2);

      out = [];
      expect(await run(['plugin', 'clean'], environment()), stderr()).toBe(EXIT_OK);
      expect(out).toHaveLength(1);
      expect(await readdir(join(home, 'cache', 'plugin-files'))).toHaveLength(1);
    },
    SLOW,
  );
});

describe("a project's plugin files", () => {
  /** A workspace beside the brief, with its own plugin file naming `aviso` at `ref`. */
  async function project(git: string, ref: string): Promise<string> {
    const folder = join(workspace, 'project');
    await mkdir(join(folder, '.tyto', 'plugin-files'), { recursive: true });
    await writeFile(join(folder, '.tyto', 'project.json'), '{}\n', 'utf8');
    await writeFile(
      join(folder, '.tyto', 'plugin-files', 'aviso.yaml'),
      pluginFile({ aviso: { git, ref } }),
      'utf8',
    );
    const brief = join(folder, 'aviso.brief');
    await cp(BRIEF, brief);
    return brief;
  }

  it(
    "override the machine's once the folder is trusted, and are not fetched before",
    async () => {
      const pack = await repository('pack');
      await machineFile({ aviso: { git: urlOf(pack), ref: 'v1' } });
      await repaint(pack, '#0000ff');
      const brief = await project(urlOf(pack), 'main');

      const restricted = await render(brief);
      expect(restricted.svg).toContain(ORANGE);
      expect(restricted.codes).not.toContain('W_PLUGIN_FILE_OVERRIDDEN');

      expect(await run(['trust', 'add', join(workspace, 'project')], environment()), stderr()).toBe(
        EXIT_OK,
      );
      const trusted = await render(brief);
      expect(trusted.code, stderr()).toBe(EXIT_OK);
      expect(trusted.svg).toContain('#0000ff');
      expect(trusted.codes).toEqual(['W_PLUGIN_FILE_OVERRIDDEN']);
      // The project's lock is the project's, beside its files.
      const lock = await lockOf(join(workspace, 'project', '.tyto', 'plugin-files'));
      expect(lock.sources[0]?.commit).toBe(await git(pack, 'rev-parse', 'main'));
    },
    SLOW,
  );
});

describe('a source that cannot be reached', () => {
  it(
    'keeps loading the copy fetched before, and says so',
    async () => {
      const pack = await repository('pack');
      await machineFile({ aviso: { git: urlOf(pack), ref: 'v1' } });
      await sync();
      await rename(pack, `${pack}-gone`);

      expect(await sync('--update')).toBe(EXIT_OK);
      expect(stderr()).toContain('W_PLUGIN_FILE_FETCH');
      expect(stderr()).toContain('fetched earlier loads');
      // Under the file that named the source, though the diagnostic has no range (TYTO-433).
      expect(stderr()).toContain(
        `${join('home', '.tyto', 'plugin-files', 'templates.yaml')}: warning W_PLUGIN_FILE_FETCH`,
      );

      const rendered = await render();
      expect(rendered.code, stderr()).toBe(EXIT_OK);
      expect(rendered.svg).toContain(ORANGE);
    },
    SLOW,
  );

  it(
    'loads nothing when it was never fetched, and the brief says which template is missing',
    async () => {
      await machineFile({ aviso: { git: urlOf(join(workspace, 'nowhere')), ref: 'v1' } });

      const rendered = await render();

      expect(rendered.code).toBe(EXIT_DIAGNOSTICS);
      expect(rendered.codes).toEqual(
        expect.arrayContaining(['W_PLUGIN_FILE_FETCH', 'E_UNKNOWN_TEMPLATE']),
      );
    },
    SLOW,
  );
});

describe('what a sync refuses', () => {
  it(
    'keeps the locked commit when the update lands on one that is not a plugin',
    async () => {
      const pack = await repository('pack');
      await machineFile({ aviso: { git: urlOf(pack), ref: 'main' } });
      await sync();
      const pinned = await lockOf(join(home, 'plugin-files'));
      await git(pack, 'rm', '--quiet', 'tyto-plugin.json');
      await git(pack, 'commit', '--quiet', '-m', 'not a plugin any more');

      expect(await sync('--update')).toBe(EXIT_DIAGNOSTICS);
      expect(stderr()).toContain('E_PLUGIN_FILE_SOURCE_REFUSED');
      expect(await lockOf(join(home, 'plugin-files'))).toEqual(pinned);
      expect((await render()).svg).toContain(ORANGE);
    },
    SLOW,
  );

  it(
    'loads a plugin that asks for permissions only once somebody approved them',
    async () => {
      const pack = await repository('pack');
      await edit(join(pack, 'tyto-plugin.json'), (text) =>
        text.replace('"permissions": []', '"permissions": ["net:example.invalid"]'),
      );
      await git(pack, 'commit', '--quiet', '-am', 'ask for the network');
      await machineFile({ aviso: { git: urlOf(pack), ref: 'main' } });

      const unapproved = await render();
      expect(unapproved.codes).toEqual(
        expect.arrayContaining(['W_PLUGIN_SKIPPED', 'E_UNKNOWN_TEMPLATE']),
      );

      expect(await sync('--yes'), stderr()).toBe(EXIT_OK);
      const approved = await render();
      expect(approved.code, stderr()).toBe(EXIT_OK);
      const state = JSON.parse(await readFile(join(home, 'plugins.json'), 'utf8')) as {
        plugins: Record<string, { permissions: string[] }>;
      };
      expect(state.plugins['example-pack']?.permissions).toEqual(['net:example.invalid']);
    },
    SLOW,
  );
});

/* ------------------------------------------------------- configurations and aliases -- */

describe('configurations and aliases (TYTO-439)', () => {
  const TABELA_ROXO = resolve(
    dirname(fileURLToPath(import.meta.url)),
    ...['..', '..', '..', 'packages', 'templates', 'templates', 'tabela-roxo', 'examples'],
    'tres-colunas.brief',
  );

  /** `aviso`'s brief, naming `template` instead, in the workspace. */
  async function briefNaming(template: string): Promise<string> {
    const path = join(workspace, `${template}.brief`);
    await writeFile(
      path,
      (await readFile(BRIEF, 'utf8')).replace('template: aviso', `template: ${template}`),
      'utf8',
    );
    return path;
  }

  async function machineYaml(text: string): Promise<string> {
    const path = join(home, 'plugin-files', 'templates.yaml');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
    return path;
  }

  it(
    'renders an alias as its template, and warns at a value in the file that wrote it',
    async () => {
      const pack = await repository('pack');
      await machineYaml(
        [
          'version: 1',
          'templates:',
          '  aviso:',
          `    source: { git: '${urlOf(pack)}', ref: v1 }`,
          '    configurations:',
          '      laranja:',
          '        values:',
          "          paper: '#ffffff'",
          '',
        ].join('\n'),
      );

      const rendered = await render(await briefNaming('aviso-laranja'));

      expect(rendered.code, stderr()).toBe(EXIT_OK);
      expect(rendered.svg).toContain(ORANGE);
      expect(rendered.codes).toEqual(['W_TEMPLATE_VALUE_UNKNOWN']);
      // The range is placed in the plugin file, line 8, not in the brief.
      expect(stderr()).toMatch(/templates\.yaml:8:18: warning W_TEMPLATE_VALUE_UNKNOWN/u);
    },
    SLOW,
  );

  it(
    'offers only the templates the file names from a fetched pack',
    async () => {
      const pack = await repository('pack');
      await cp(join(pack, 'templates', 'aviso'), join(pack, 'templates', 'aviso-b'), {
        recursive: true,
      });
      await edit(join(pack, 'templates', 'aviso-b', 'manifest.yaml'), (text) =>
        text.replace(/^name: aviso$/mu, 'name: aviso-b'),
      );
      await git(pack, 'add', '.');
      await git(pack, 'commit', '--quiet', '-m', 'a second template');
      await machineFile({ aviso: { git: urlOf(pack), ref: 'main' } });

      expect((await render()).code, stderr()).toBe(EXIT_OK);
      const unnamed = await render(await briefNaming('aviso-b'));

      expect(unnamed.code).toBe(EXIT_DIAGNOSTICS);
      expect(stderr()).toContain('E_UNKNOWN_TEMPLATE');
    },
    SLOW,
  );

  it(
    'refuses an alias that is a built-in template’s name, and the built-in renders the same bytes',
    async () => {
      const builtIn = async (): Promise<Rendered> => {
        const code = await run(
          ['render', TABELA_ROXO, '--out', 'out', '--types', 'svg'],
          environment(),
        );
        const result = JSON.parse(
          await readFile(join(workspace, 'out', 'result.json'), 'utf8'),
        ) as { artifacts: { name: string }[]; diagnostics: { code: string }[] };
        const [first] = result.artifacts;
        const svg =
          first === undefined ? '' : await readFile(join(workspace, 'out', first.name), 'utf8');
        return { code, svg, codes: result.diagnostics.map((item) => item.code) };
      };
      const before = await builtIn();
      expect(before.code, stderr()).toBe(EXIT_OK);
      expect(before.svg).toContain('<svg');

      const pack = await repository('pack');
      await machineYaml(
        [
          'version: 1',
          'templates:',
          '  aviso:',
          `    source: { git: '${urlOf(pack)}', ref: v1 }`,
          '    configurations:',
          '      roxo:',
          '        alias: tabela-roxo',
          '',
        ].join('\n'),
      );
      errors = [];
      const after = await builtIn();

      // An error, as every plugin-file error is (ADR 0151 decision 7), and the art is drawn.
      expect(after.code, stderr()).toBe(EXIT_DIAGNOSTICS);
      expect(after.codes).toContain('E_TEMPLATE_ALIAS_TAKEN');
      expect(stderr()).toMatch(/templates\.yaml:7:16: error E_TEMPLATE_ALIAS_TAKEN/u);
      expect(after.svg).toBe(before.svg);
    },
    SLOW,
  );
});

describe("a configuration's brief side (TYTO-440)", () => {
  it(
    'fills a slot, picks the formats, warns past its editor rule and refuses a looser one',
    async () => {
      const pack = await repository('pack');
      await mkdir(join(home, 'plugin-files'), { recursive: true });
      await writeFile(
        join(home, 'plugin-files', 'templates.yaml'),
        [
          'version: 1',
          'templates:',
          '  aviso:',
          `    source: { git: '${urlOf(pack)}', ref: v1 }`,
          '    configurations:',
          '      curto:',
          '        brief:',
          '          slots: { detalhe: Vagas limitadas }',
          '          formats: [story]',
          '          editor:',
          '            titulo: { max: 10 }',
          '            detalhe: { max: 200 }',
          '',
        ].join('\n'),
        'utf8',
      );
      const brief = join(workspace, 'curto.brief');
      await writeFile(
        brief,
        '---\ntemplate: aviso-curto\n---\n::titulo\n  Inscrições abertas hoje\n',
        'utf8',
      );

      const rendered = await render(brief);
      const result = JSON.parse(await readFile(join(workspace, 'out', 'result.json'), 'utf8')) as {
        artifacts: { name: string }[];
      };

      expect(rendered.code, stderr()).toBe(EXIT_OK);
      // The brief names no formats, so the configuration's one renders and the pack's other does not.
      expect(result.artifacts.map((artifact) => artifact.name)).toEqual([
        expect.stringContaining('story'),
      ]);
      expect(rendered.svg).toContain('Vagas limitadas');
      expect([...rendered.codes].sort()).toEqual([
        'W_EDITOR_RULE_LOOSER',
        'W_SLOT_OVER_CONFIGURED_LIMIT',
      ]);
      // The looser rule is placed in the plugin file, the limit in the brief.
      expect(stderr()).toMatch(/templates\.yaml:12:29: warning W_EDITOR_RULE_LOOSER/u);
      expect(stderr()).toMatch(/curto\.brief:4:1: warning W_SLOT_OVER_CONFIGURED_LIMIT/u);
    },
    SLOW,
  );
});

describe("a configuration's brand (ADR 0155)", () => {
  it(
    'renders with the placeholders and warns at the file’s line when no kit offers the brand',
    async () => {
      const pack = await repository('pack');
      await mkdir(join(home, 'plugin-files'), { recursive: true });
      await writeFile(
        join(home, 'plugin-files', 'templates.yaml'),
        [
          'version: 1',
          'templates:',
          '  aviso:',
          `    source: { git: '${urlOf(pack)}', ref: v1 }`,
          '    configurations:',
          '      azul:',
          '        brand: azul',
          '',
        ].join('\n'),
        'utf8',
      );
      const brief = join(workspace, 'azul.brief');
      await writeFile(
        brief,
        '---\ntemplate: aviso-azul\n---\n::titulo\n  Inscrições abertas hoje\n',
        'utf8',
      );

      const rendered = await render(brief);

      expect(rendered.code, stderr()).toBe(EXIT_OK);
      expect(rendered.svg).toContain(ORANGE);
      expect(rendered.codes).toEqual(['W_BRAND_KIT_MISSING']);
      expect(stderr()).toMatch(/templates\.yaml:7:16: warning W_BRAND_KIT_MISSING/u);
    },
    SLOW,
  );
});
