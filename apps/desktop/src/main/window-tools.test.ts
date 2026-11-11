import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { readFile } from 'node:fs/promises';

import { type EditToPropose, type WindowPort, run, serveAgent } from '@tyto/command-line';
import { PluginCapabilityError } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type WindowToolsPortOptions, windowToolsPorts } from './window-tools.js';

/**
 * The window's tools called by a plugin in process (ADR 0190), against the real MCP server the
 * window's endpoint runs (`serveAgent`), over the in-memory session `window-tools.ts` opens. The
 * permission is plugin-api's and is tested there.
 */

let home: string;
let folder: string;
let sessions: { opened: number; closed: number };

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tyto-tools-home-'));
  folder = await mkdtemp(join(tmpdir(), 'tyto-tools-ws-'));
  sessions = { opened: 0, closed: 0 };
  window = undefined;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(folder, { recursive: true, force: true });
});

const quiet = { out: () => {}, err: () => {} };

let window: WindowPort | undefined;

function realServe(
  stdio: { readonly input: Readable; readonly output: Writable },
  signal: AbortSignal,
): Promise<void> {
  sessions.opened += 1;
  return serveAgent(
    {
      version: '0.0.0-test',
      cwd: folder,
      home,
      console: quiet,
      rasterizer: () => {
        throw new Error('no preview in this test');
      },
    },
    stdio,
    signal,
    'a plugin',
    window,
  ).finally(() => {
    sessions.closed += 1;
  });
}

function ports(overrides: Partial<WindowToolsPortOptions> = {}) {
  return windowToolsPorts({
    listening: () => true,
    workspace: () => ({ folder, trust: 'trusted' }),
    serve: realServe,
    ...overrides,
  });
}

const codeOf = (attempt: Promise<unknown>): Promise<string> =>
  attempt.then(
    () => 'answered',
    (cause: unknown) =>
      cause instanceof PluginCapabilityError ? cause.code : `thrown: ${String(cause)}`,
  );

describe('the window’s tools, in process', () => {
  it('lists the tools the window’s server registers, and closes the session', async () => {
    const tools = await ports().windowTools('agent');
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('check_brief');
    expect(names).toContain('list_templates');
    const check = tools.find((tool) => tool.name === 'check_brief');
    expect(check?.description).not.toBe('');
    expect(check?.inputSchema['type']).toBe('object');
    expect(sessions).toEqual({ opened: 1, closed: 1 });
  });

  it('calls a tool and answers what the server answered', async () => {
    await writeFile(join(folder, 'broken.brief'), 'this is not a brief {', 'utf8');
    const answer = await ports().callWindowTool('agent', 'check_brief', { path: 'broken.brief' });
    expect(answer.content.length).toBeGreaterThan(0);
    expect(answer.content.every((block) => block.type === 'text')).toBe(true);
    expect(sessions).toEqual({ opened: 1, closed: 1 });
  });

  it('answers an unknown tool as a tool’s refusal, for the model to read', async () => {
    const answer = await ports().callWindowTool('agent', 'format_disk', {});
    expect(answer.isError).toBe(true);
    expect(JSON.stringify(answer.content)).toContain('format_disk');
    expect(sessions).toEqual({ opened: 1, closed: 1 });
  });

  it('refuses a restricted folder and agentsListen off before any session opens', async () => {
    const restricted = ports({ workspace: () => ({ folder, trust: 'restricted' }) });
    const off = ports({ listening: () => false });
    expect(await codeOf(restricted.windowTools('agent'))).toBe('E_WINDOW_RESTRICTED');
    expect(await codeOf(restricted.callWindowTool('agent', 'check_brief', {}))).toBe(
      'E_WINDOW_RESTRICTED',
    );
    expect(await codeOf(off.windowTools('agent'))).toBe('E_WINDOW_AGENTS_OFF');
    expect(await codeOf(off.callWindowTool('agent', 'check_brief', {}))).toBe(
      'E_WINDOW_AGENTS_OFF',
    );
    expect(sessions.opened).toBe(0);
  });

  it('with no folder open, still answers: the window’s reads only', async () => {
    const tools = await ports({
      workspace: () => ({ folder: null, trust: 'restricted' }),
    }).windowTools('agent');
    expect(tools.length).toBeGreaterThan(0);
  });

  it('gives up on a server that never answers, at the deadline, and ends the session', async () => {
    let aborted = false;
    const silent = ports({
      listTimeoutMs: 200,
      serve: (_stdio, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        }),
    });
    expect(await codeOf(silent.windowTools('agent'))).toMatch(/did not answer within 0\.2 s/u);
    expect(aborted).toBe(true);
  });

  it('fails a question at once when the server stops before answering', async () => {
    const dying = ports({ serve: () => Promise.reject(new Error('server crashed')) });
    expect(await codeOf(dying.windowTools('agent'))).toBe('thrown: Error: server crashed');
  });

  it('hands an edit to the window as a proposal, and writes nothing', async () => {
    // A project, as `tyto mcp` finds one, so its trust decides which tools are offered.
    await mkdir(join(folder, '.tyto'), { recursive: true });
    await writeFile(join(folder, '.tyto', 'project.json'), '{}\n', 'utf8');
    const out: string[] = [];
    const code = await run(['trust', 'add', folder], {
      version: '0.0.0-test',
      cwd: folder,
      home,
      console: { out: (text) => out.push(text), err: (text) => out.push(text) },
      rasterizer: () => {
        throw new Error('no preview in this test');
      },
      confirm: () => Promise.resolve(true),
    });
    expect(code, out.join('')).toBe(0);
    const path = join(folder, 'a.brief');
    await writeFile(path, 'Hello', 'utf8');
    const proposed: (readonly EditToPropose[])[] = [];
    window = {
      briefInFront: () =>
        Promise.resolve({
          path,
          name: 'a.brief',
          text: 'Hello',
          unsaved: false,
          kind: 'brief',
          format: 'feed',
        }),
      selection: () => Promise.resolve(undefined),
      openFile: () => Promise.resolve({ done: true }),
      showFormat: () => Promise.resolve({ done: true }),
      proposeEdit: (edits) => {
        proposed.push(edits);
        return Promise.resolve({ proposed: true, id: 'proposal-1' });
      },
      proposalStatus: () => Promise.resolve('proposed'),
    };
    const tools = (await ports().windowTools('agent')).map((tool) => tool.name);
    expect(tools).toContain('propose_edit');
    const edit = {
      from: { line: 1, column: 1 },
      to: { line: 1, column: 6 },
      insert: 'Bye',
      expect: 'Hello',
    };
    const answer = await ports().callWindowTool('agent', 'propose_edit', { edits: [edit] });
    expect(answer.isError).toBe(false);
    expect(proposed).toEqual([[edit]]);
    expect(await readFile(path, 'utf8')).toBe('Hello');
  });
});
