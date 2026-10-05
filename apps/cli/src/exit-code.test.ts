import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

/**
 * The exit code of `tyto` as a shell sees it (TYTO-232): the bundled CLI started as a process,
 * not `run()` called in this one.
 *
 * In process, the test runner holds the event loop open, so a promise nothing else keeps
 * alive still settles. In a real process the loop empties first, Node reports an unsettled
 * top-level await and exits 13 — with the artifacts already written, so only the code says
 * anything went wrong. That is what installing a plugin used to do to every command that
 * started it.
 */

const FORMATS = fileURLToPath(
  new URL('../../../packages/templates/templates/formats.yaml', import.meta.url),
);

let workspace: string;
let home: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-exit-'));
  home = join(workspace, 'home', '.tyto');
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

interface Ended {
  readonly code: number | null;
  readonly stderr: string;
}

/** `tyto <args>` in its own process, with this test's `TYTO_HOME`. */
function tyto(args: readonly string[]): Promise<Ended> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [inject('builtCli'), ...args], {
      cwd: workspace,
      env: { ...process.env, TYTO_HOME: home },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

/**
 * The scaffold `tyto plugin new` writes: a plugin with nothing to do with brands, whose markup
 * template draws in a bundled face, so no machine reports a substituted font for it.
 */
async function scaffold(): Promise<{ readonly folder: string; readonly brief: string }> {
  const created = await tyto(['plugin', 'new', 'scaffold', '--out', workspace]);
  expect(created, created.stderr).toMatchObject({ code: 0 });
  const folder = join(workspace, 'scaffold');
  return { folder, brief: join(folder, 'templates', 'scaffold', 'examples', 'scaffold.brief') };
}

/** The scaffold, installed; its example brief. */
async function installScaffold(): Promise<string> {
  const { folder, brief } = await scaffold();
  const installed = await tyto(['plugin', 'install', folder, '--yes']);
  expect(installed, installed.stderr).toMatchObject({ code: 0 });
  return brief;
}

const RENDER_OPTIONS = ['--types', 'svg', '--formats-file', FORMATS];

describe('tyto, started as a process', () => {
  it('renders with no plugin installed and exits 0', async () => {
    // The same template, read as a project folder rather than installed.
    const { folder, brief } = await scaffold();
    const out = join(workspace, 'out');

    const ended = await tyto([
      'render',
      brief,
      '--out',
      out,
      '--templates',
      join(folder, 'templates'),
      ...RENDER_OPTIONS,
    ]);

    expect(ended).toEqual({ code: 0, stderr: '' });
  }, 120_000);

  it('renders with a plugin installed and exits 0, with the artifacts written', async () => {
    const brief = await installScaffold();
    const out = join(workspace, 'out');

    const ended = await tyto(['render', brief, '--out', out, ...RENDER_OPTIONS]);

    expect(ended).toEqual({ code: 0, stderr: '' });
    expect((await readdir(out)).filter((name) => name.endsWith('.svg')).length).toBeGreaterThan(0);
  }, 120_000);

  it('lists the plugins with one installed and exits 0', async () => {
    await installScaffold();

    expect(await tyto(['plugin', 'list'])).toEqual({ code: 0, stderr: '' });
  }, 120_000);

  it('handles a watched inbox once with a plugin installed and exits 0', async () => {
    const brief = await installScaffold();
    const task = join(workspace, 'queue', 'inbox', 'task-1');
    await mkdir(task, { recursive: true });
    await writeFile(join(task, 'brief.brief'), await readFile(brief));

    const ended = await tyto(['watch', join(workspace, 'queue'), '--once', ...RENDER_OPTIONS]);

    // The watcher reports each task on stderr; that line is the whole of it.
    expect(ended).toEqual({ code: 0, stderr: 'task-1: ok — 1 of 1 artifact(s)\n' });
    expect(await readdir(join(workspace, 'queue', 'outbox'))).toEqual(['task-1']);
  }, 120_000);
});
