import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { type CliEnvironment, launchPluginProcess, run as runCommand } from '@tyto/command-line';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCliRunner } from './cli-runner.js';
import { commandTemplates } from './command-templates.js';

/**
 * TYTO-729: the panel's `--template` completion is `tyto template list --json` in the session's
 * working folder, through the runner `cli:run` uses, so it offers exactly what a render there
 * finds. One neutral fixture holds both of the card's cases — a working folder with its own
 * `templates/cartaz`, and the same template in a folder only the window's picker could point at
 * — and a project plugin file that only a trusted folder fetches. No network: the pack is a
 * `file://` repository, as in `@tyto/command-line`'s `template-list.test.ts`.
 */

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(HERE, '..', '..', '..', '..');
const EXAMPLE_PACK = join(REPOSITORY, 'examples', 'plugins', 'tyto-plugin-example-pack');
const FIXTURES = join(REPOSITORY, 'packages', 'command-line', 'src', '__fixtures__');
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

// Git and a plugin's process per run: past Vitest's 5 s default.
const SLOW = 180_000;

let scratch: string;
let project: string;
let home: string;

async function template(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await cp(join(FIXTURES, 'cartaz.manifest.yaml'), join(folder, 'manifest.yaml'));
  await cp(join(FIXTURES, 'cartaz.html'), join(folder, 'template.html'));
}

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-panel-templates-')));
  project = join(scratch, 'project');
  home = join(scratch, 'home', '.tyto');
  await mkdir(home, { recursive: true });

  const pack = join(scratch, 'repositories', 'pack');
  await cp(EXAMPLE_PACK, pack, { recursive: true });
  await exec('git', ['init', '--quiet', '--initial-branch=main', pack]);
  await exec('git', [...AUTHOR, '-C', pack, 'add', '.']);
  await exec('git', [...AUTHOR, '-C', pack, 'commit', '--quiet', '-m', 'release']);

  // Case 1: the working folder's own templates/, which the window's picker never reads.
  await template(join(project, 'entregas', 'templates', 'cartaz'));
  // Case 2: a folder of templates the window could be pointed at, which no render reaches.
  await template(join(project, 'modelos', 'cartaz'));
  await mkdir(join(project, '.tyto', 'plugin-files'), { recursive: true });
  await writeFile(join(project, '.tyto', 'project.json'), '{}\n', 'utf8');
  await writeFile(
    join(project, '.tyto', 'plugin-files', 'aviso.yaml'),
    [
      'version: 1',
      'templates:',
      '  aviso:',
      `    source: { git: '${pathToFileURL(pack).href}', ref: main }`,
      '    configurations:',
      '      laranja:',
      '        values:',
      "          paper: '#ffffff'",
      '',
    ].join('\n'),
    'utf8',
  );
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function runner() {
  return createCliRunner({
    environment: (): Omit<CliEnvironment, 'console' | 'confirm' | 'refuse'> => ({
      version: '0.0.0-test',
      cwd: project,
      home,
      variables: {},
      launch: launchPluginProcess,
      rasterizer: () => {
        throw new Error('these renders are svg and never raster');
      },
    }),
    refuse: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
    output: () => undefined,
    state: () => undefined,
    run: runCommand,
  });
}

async function offered(cwd: string): Promise<string[]> {
  const cli = runner();
  const answer = await commandTemplates((argv, folder) => cli.capture(argv, folder), cwd);
  expect(answer.note).toBeUndefined();
  return answer.templates.map((row) => row.name);
}

/** Whether a render in `cwd` of a brief naming `name` found it: its stage may fail, its lookup not. */
async function renderFinds(name: string, cwd: string): Promise<boolean> {
  const brief = join(cwd, `${name}.brief`);
  await writeFile(brief, `---\ntemplate: ${name}\n---\n`, 'utf8');
  const done = await runner().capture(['render', brief, '--out', 'out', '--types', 'svg'], cwd);
  await rm(brief, { force: true });
  return !done.err.includes('E_UNKNOWN_TEMPLATE');
}

async function everyOfferedRenders(names: readonly string[], cwd: string): Promise<void> {
  for (const name of names) expect(await renderFinds(name, cwd), `${name} in ${cwd}`).toBe(true);
}

describe("the panel's --template completion", () => {
  it(
    'offers in a restricted folder exactly what a restricted render there finds',
    async () => {
      const entregas = join(project, 'entregas');
      const inEntregas = await offered(entregas);
      const atRoot = await offered(project);

      // Case 1: the working folder's own template is offered there, and renders there.
      expect(inEntregas).toContain('cartaz');
      // Case 2: from the root, neither entregas/templates nor modelos/ is in reach.
      expect(atRoot).not.toContain('cartaz');
      expect(await renderFinds('cartaz', project)).toBe(false);
      // Restricted: the project's plugin file is neither fetched nor offered, nor rendered.
      expect(inEntregas).not.toContain('aviso');
      expect(await renderFinds('aviso', entregas)).toBe(false);

      await everyOfferedRenders(inEntregas, entregas);
      await everyOfferedRenders(atRoot, project);
    },
    SLOW,
  );

  it(
    'offers the plugin file templates once the folder is trusted, each one a render finds',
    async () => {
      const trusted = await runner().capture(['trust', 'add', project], project);
      expect(trusted.code, trusted.err).toBe(0);
      const entregas = join(project, 'entregas');
      const inEntregas = await offered(entregas);

      expect(inEntregas).toEqual(expect.arrayContaining(['cartaz', 'aviso', 'aviso-laranja']));
      await everyOfferedRenders(inEntregas, entregas);
      // The control: a name nobody has is not offered and not found, so the check can fail.
      expect(inEntregas).not.toContain('nenhum');
      expect(await renderFinds('nenhum', entregas)).toBe(false);
    },
    SLOW,
  );
});
