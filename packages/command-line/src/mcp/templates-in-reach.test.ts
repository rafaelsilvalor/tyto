import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';

import type * as Io from '@tyto/io';
import { syncPluginFiles } from '@tyto/io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliEnvironment } from '../environment.js';
import { EXIT_OK } from '../exit.js';
import { launchPluginProcess } from '../plugins/plugin-process.js';
import { run } from '../program.js';
import type { ListedTemplate } from '../template-list.js';
import manifestSource from '../__fixtures__/cartaz.manifest.yaml?raw';
import templateMarkup from '../__fixtures__/cartaz.html?raw';
import { chooseTemplatePrompt } from './prompt.js';
import { type McpSession, openSession } from './session.js';

/**
 * `tyto mcp` resolves templates through `templatesInReach`'s halves (TYTO-730), so an agent is
 * offered and refused exactly what the terminal is. The fixture is `template-list.test.ts`'s:
 * the built-in pack, the folder's own `templates/cartaz`, and the example pack fetched through
 * the project's plugin files with an alias over it, from a `file://` repository.
 *
 * The sync is wrapped, not replaced, so it still fetches; the wrapper only counts the calls. It is
 * `@tyto/io`'s, under the CLI's own `plugin-files.ts`: mocking that one loads `render.ts` and so
 * `templates-in-reach.ts` while the mock is still being made, which then keeps the real one.
 */

vi.mock('@tyto/io', async (original) => {
  const actual = await original<typeof Io>();
  return { ...actual, syncPluginFiles: vi.fn(actual.syncPluginFiles) };
});

const exec = promisify(execFile);

const EXAMPLE_PACK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ...['..', '..', '..', '..', 'examples', 'plugins', 'tyto-plugin-example-pack'],
);
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let scratch: string;
let project: string;
let home: string;
let out: string[];
let errors: string[];
let sessions: McpSession[];

function environment(): CliEnvironment {
  return {
    console: { out: (text) => out.push(text), err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: project,
    home,
    launch: launchPluginProcess,
    rasterizer: () => {
      throw new Error('these checks never raster');
    },
  };
}

const stderr = (): string => errors.join('');

async function git(folder: string, ...args: string[]): Promise<void> {
  await exec('git', [...AUTHOR, '-C', folder, ...args]);
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tyto-mcp-templates-'));
  project = join(scratch, 'project');
  home = join(scratch, 'home', '.tyto');
  out = [];
  errors = [];
  sessions = [];
  await mkdir(home, { recursive: true });

  const pack = join(scratch, 'repositories', 'pack');
  await cp(EXAMPLE_PACK, pack, { recursive: true });
  await exec('git', ['init', '--quiet', '--initial-branch=main', pack]);
  await git(pack, 'add', '.');
  await git(pack, 'commit', '--quiet', '-m', 'release');

  const cartaz = join(project, 'templates', 'cartaz');
  await mkdir(cartaz, { recursive: true });
  await writeFile(join(cartaz, 'manifest.yaml'), manifestSource);
  await writeFile(join(cartaz, 'template.html'), templateMarkup);
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
  vi.mocked(syncPluginFiles).mockClear();
});

afterEach(async () => {
  for (const session of sessions) await session.close();
  await rm(scratch, { recursive: true, force: true });
});

// Git and a plugin's process per run: past Vitest's 5 s default.
const SLOW = 120_000;

async function trust(): Promise<void> {
  const code = await run(['trust', 'add', project], environment());
  expect(code, stderr()).toBe(EXIT_OK);
}

/** What `tyto template list --json` prints in the project, trust as the home records it. */
async function listed(): Promise<readonly ListedTemplate[]> {
  out = [];
  errors = [];
  const code = await run(['template', 'list', '--json'], environment());
  expect(code, stderr()).toBe(EXIT_OK);
  return (JSON.parse(out.join('')) as { templates: ListedTemplate[] }).templates;
}

async function session(): Promise<McpSession> {
  errors = [];
  const opened = await openSession(environment());
  sessions.push(opened);
  return opened;
}

const nameOf = (row: { readonly name: string }): string => row.name;

interface Answer {
  readonly id?: number;
  readonly result?: unknown;
}

/** Runs `tyto mcp` over in-memory stdio, asks each request in turn and returns the answers. */
async function overStdio(
  requests: readonly { readonly method: string; readonly params?: object }[],
): Promise<unknown[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const waiting = new Map<number, (answer: Answer) => void>();
  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
    let end: number;
    while ((end = written.indexOf('\n')) >= 0) {
      const answer = JSON.parse(written.slice(0, end)) as Answer;
      written = written.slice(end + 1);
      if (answer.id !== undefined) waiting.get(answer.id)?.(answer);
    }
  });
  const exit = run(['mcp'], { ...environment(), stdio: () => ({ input, output }) });
  let next = 1;
  const ask = (method: string, params: object = {}): Promise<Answer> => {
    const id = next++;
    const answered = new Promise<Answer>((settle) => waiting.set(id, settle));
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return answered;
  };
  await ask('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const results: unknown[] = [];
  for (const request of requests) results.push((await ask(request.method, request.params)).result);
  input.end();
  expect(await exit, stderr()).toBe(EXIT_OK);
  return results;
}

/** The names `list_templates` answers, in the order it answers them. */
async function namesOf(opened: McpSession): Promise<string[]> {
  return (await opened.listTemplates()).map(nameOf);
}

/** Whether the session's check of a brief naming `template` found it. */
async function accepts(opened: McpSession, template: string): Promise<boolean> {
  const answer = await opened.checkBrief({ text: `---\ntemplate: ${template}\n---\n` });
  return !answer.diagnostics.some((item) => item.code === 'E_UNKNOWN_TEMPLATE');
}

/** Every listed name the session accepts, and the names it was asked about and refused. */
async function sides(
  opened: McpSession,
  rows: readonly ListedTemplate[],
  others: readonly string[],
): Promise<{ accepted: string[]; refused: string[] }> {
  const accepted: string[] = [];
  const refused: string[] = [];
  for (const name of [...rows.map((row) => row.name), ...others]) {
    ((await accepts(opened, name)) ? accepted : refused).push(name);
  }
  return { accepted: accepted.sort(), refused: refused.sort() };
}

describe('tyto mcp and tyto template list', () => {
  it(
    'accept the same templates in a trusted folder',
    async () => {
      await trust();
      const rows = await listed();
      expect(rows.map((row) => row.name)).toEqual(
        expect.arrayContaining(['cartaz', 'aviso', 'aviso-laranja']),
      );

      const opened = await session();
      expect(opened.trust).toBe('trusted');
      const { accepted, refused } = await sides(opened, rows, ['nenhum']);
      expect(accepted).toEqual(rows.map((row) => row.name).sort());
      // The control: a name nobody has is refused, so the comparison can fail.
      expect(refused).toEqual(['nenhum']);

      // The tool lists what the terminal lists, aliases included (TYTO-731).
      expect(await namesOf(opened)).toEqual(rows.map(nameOf));
    },
    SLOW,
  );

  it(
    'leave out the same templates in a restricted folder with plugin files of its own',
    async () => {
      await trust();
      const trusted = (await listed()).map((row) => row.name);
      await run(['trust', 'remove', project], environment());

      const rows = await listed();
      expect(stderr()).toMatch(/plugin-files was not listed: this folder is restricted/u);
      const names = new Set(rows.map((row) => row.name));
      const leftOut = trusted.filter((name) => !names.has(name)).sort();
      expect(leftOut).toEqual(['aviso', 'aviso-laranja']);

      const opened = await session();
      expect(opened.trust).toBe('restricted');
      const { accepted, refused } = await sides(opened, rows, leftOut);
      expect(accepted).toEqual([...names].sort());
      expect(refused).toEqual(leftOut);
      expect(stderr()).toMatch(/plugin-files was not loaded: this folder is restricted/u);

      // The tool lists the same names the terminal does, the left-out aliases absent from both.
      const offered = await namesOf(opened);
      expect(offered).toEqual(rows.map(nameOf));
      expect(offered.filter((offeredName) => leftOut.includes(offeredName))).toEqual([]);
    },
    SLOW,
  );

  it(
    'list an alias with the template it reaches, and the formats a configuration allows',
    async () => {
      // `laranja` is `aviso`'s default and allows the story only, so `aviso` itself narrows too.
      await writeFile(
        join(project, '.tyto', 'plugin-files', 'aviso.yaml'),
        [
          'version: 1',
          'templates:',
          '  aviso:',
          `    source: { git: '${pathToFileURL(join(scratch, 'repositories', 'pack')).href}', ref: main }`,
          '    default: laranja',
          '    configurations:',
          '      laranja:',
          '        formats: [story]',
          '        values:',
          "          paper: '#ffffff'",
          '',
        ].join('\n'),
        'utf8',
      );
      await trust();
      const rows = await listed();
      const opened = await session();
      const answered = await opened.listTemplates();
      const byName = new Map(answered.map((row) => [row.name, row]));

      for (const row of rows) {
        expect(byName.get(row.name), row.name).toMatchObject({
          name: row.name,
          origin: row.origin,
          formats: row.formats,
          ...(row.plugin === undefined ? {} : { plugin: row.plugin }),
          ...(row.aliasOf === undefined ? {} : { aliasOf: row.aliasOf }),
        });
      }
      // The control: the manifest offers two formats, the configuration one.
      expect(byName.get('aviso')?.formats).toEqual(['story']);
      expect(byName.get('aviso-laranja')).toMatchObject({
        aliasOf: 'aviso',
        formats: ['story'],
        version: byName.get('aviso')?.version,
      });
      expect(byName.get('cartaz')?.aliasOf).toBeUndefined();

      // The prompt that asks an agent to choose names the alias with the template it reaches.
      const prompt = chooseTemplatePrompt('copy', answered);
      expect(prompt).toMatch(/^- aviso-laranja → aviso( — .*)? \(formats: story\)$/mu);
      expect(prompt).toMatch(/^- aviso( — .*)? \(formats: story\)$/mu);

      // Through the protocol: the tool answers the alias, and its template's examples are
      // served once, under the template's name, never again under the alias's.
      const [tool, resources] = (await overStdio([
        { method: 'tools/call', params: { name: 'list_templates', arguments: {} } },
        { method: 'resources/list' },
      ])) as [{ content: { text: string }[] }, { resources: { uri: string }[] }];
      const toolRows = JSON.parse(tool.content[0]?.text ?? '[]') as { name: string }[];
      expect(toolRows.map(nameOf)).toEqual(rows.map(nameOf));
      const uris = resources.resources.map((resource) => resource.uri);
      expect(uris.some((uri) => uri.startsWith('tyto://template/aviso/'))).toBe(true);
      expect(uris.length).toBe(new Set(uris).size);
    },
    SLOW,
  );

  it(
    'syncs the plugin files once, when the session opens, and never on a call',
    async () => {
      await trust();
      vi.mocked(syncPluginFiles).mockClear();

      const opened = await session();
      expect(vi.mocked(syncPluginFiles)).toHaveBeenCalledTimes(1);
      // Never moving a pinned ref, fetching a missing copy, and with nobody to ask.
      const options = vi.mocked(syncPluginFiles).mock.calls[0]?.[0];
      expect(options).toMatchObject({ update: false, fetches: true });
      expect(options?.approve).toBeUndefined();

      await opened.listTemplates();
      expect(await accepts(opened, 'aviso')).toBe(true);
      await opened.describeTemplate('cartaz');
      expect(vi.mocked(syncPluginFiles)).toHaveBeenCalledTimes(1);
    },
    SLOW,
  );
});
