import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { writeFakeAgent } from './fake-agent.js';
import { firstWindow } from './first-window.js';

/**
 * Open an Agent Here on the real app (TYTO-567, ADR 0181): the agent program starts in a terminal
 * main owns, reads the MCP configuration Tyto wrote in `TYTO_HOME`, starts the relay it names on
 * the bundled Node, and lists this window's tools through it.
 *
 * The agent is a stand-in named `claude`, so main gives it Claude Code's arguments: a Node script
 * that does what an agent's host does with `--mcp-config` — start the server it names, initialise,
 * list the tools — and prints what it got. The folder it all lives in has a space in its name, as
 * a Windows user folder can. The launch rules themselves are `terminal-agent.test.ts`'s.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}

let scratch: string;
let home: string;
let userData: string;
let agentPath: string;
let app: ElectronApplication;
let page: Page;

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

function call<T>(channel: string, request: unknown): Promise<T> {
  return page.evaluate(
    ([name, body]) => (globalThis as never as { tyto: Bridge }).tyto[name as string]!(body),
    [channel, request] as const,
  ) as Promise<T>;
}

const output = (terminalId: string): Promise<string> =>
  page.evaluate(
    (id) => (globalThis as never as { heard: Record<string, string> }).heard[id] ?? '',
    terminalId,
  );

const settings = (values: Record<string, unknown>): void => {
  writeFileSync(join(userData, 'settings.json'), `${JSON.stringify(values, null, 2)}\n`);
};

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto agent e2e '));
  home = join(scratch, 'tyto home');
  userData = join(scratch, 'user-data');
  mkdirSync(home, { recursive: true });
  mkdirSync(userData, { recursive: true });
  agentPath = writeFakeAgent(join(scratch, 'bin'));
  settings({ agentCommand: agentPath });

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.evaluate(() => {
    const scope = globalThis as never as {
      tyto: { on: (event: string, listen: (payload: never) => void) => () => void };
      heard: Record<string, string>;
    };
    scope.heard = {};
    scope.tyto.on('terminal:output', (payload: { terminalId: string; data: string }) => {
      scope.heard[payload.terminalId] = (scope.heard[payload.terminalId] ?? '') + payload.data;
    });
  });
});

afterAll(async () => {
  // Every terminal ended first: on macOS and Linux a program still running in one makes the quit
  // ask in a box no test answers (ADR 0164), and the polls below may have started agents.
  const { terminals } = await call<{ terminals: { terminalId: string }[] }>('terminal:list', {});
  for (const { terminalId } of terminals) await call('terminal:kill', { terminalId });
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the relay bundle', () => {
  it("imports nothing but Node's own modules: the bundled Node has no node_modules beside it", () => {
    const bundle = readFileSync(join(here, '..', 'out', 'relay', 'agent-relay.js'), 'utf8');
    const imports = ts
      .preProcessFile(bundle, true, true)
      .importedFiles.map((file) => file.fileName);
    const builtin = new Set(builtinModules);

    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((name) => !builtin.has(name.replace(/^node:/u, '')))).toEqual([]);
  });
});

describe('Open an Agent Here', () => {
  it("starts the agent, which reaches this window's tools through the bundled relay", async () => {
    const opened = await call<{ terminalId?: string; refused?: string; message?: string }>(
      'terminal:open',
      { cols: 200, rows: 30, agent: true },
    );
    expect(opened.message).toBeUndefined();
    const terminalId = opened.terminalId!;
    const pid = await app.evaluate(() => process.pid);

    await expect.poll(() => output(terminalId), { timeout: 30_000 }).toContain('AGENT_WINDOW');
    const text = (await output(terminalId)).replace(/\r?\n/gu, '\n');
    process.stdout.write(`[TYTO-567] agent terminal:\n${text}\n`);
    // A window tool: the window answered, not `tyto mcp` serving the files (ADR 0180).
    expect(text).toMatch(/AGENT_TOOLS [a-z_,]*brief_in_front/u);
    expect(text).toContain('relaying to the window that started this terminal');
    expect(text).toContain(`(pid ${String(pid)})`);
    expect(text).toContain(`AGENT_WINDOW ${String(pid)}`);
    // The configuration is in TYTO_HOME, named by this window, and nowhere in a workspace.
    expect(existsSync(join(home, 'agents', `window-${String(pid)}.json`))).toBe(true);
  });

  it('says so when the agent program is not installed, and starts nothing', async () => {
    settings({ agentCommand: 'tyto-e2e-no-such-agent' });

    await expect
      .poll(
        async () =>
          (
            await call<{ refused?: string; message?: string }>('terminal:open', {
              cols: 80,
              rows: 24,
              agent: true,
            })
          ).message ?? '',
        { timeout: 15_000 },
      )
      .toContain('"tyto-e2e-no-such-agent" was not found on PATH');
  });
});
