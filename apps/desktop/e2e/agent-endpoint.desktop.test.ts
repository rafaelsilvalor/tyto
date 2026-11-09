import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { run } from '@tyto/command-line';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * An agent reaching the real window through `tyto mcp --window` (TYTO-566, ADR 0180).
 *
 * What needs the window is here: that the app listens and writes its record into its own
 * `TYTO_HOME`, that the relay — `run` from `@tyto/command-line`, the code `tyto` runs — finds it
 * and gets `tools/list` answered by the SDK chunk main loads, that the status bar shows the
 * agent and its click cuts the connection, and that quitting removes the record. The handshake,
 * the token and the pick are unit-tested in `agent-endpoint.test.ts` and `window.test.ts`; the
 * badge's words in both languages in `status-bar.test.ts`.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139). `--lang=en`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}

let scratch: string;
let home: string;
let app: ElectronApplication | undefined;
let page: Page;

const records = (): string[] =>
  existsSync(join(home, 'windows'))
    ? readdirSync(join(home, 'windows')).filter((name) => name.endsWith('.json'))
    : [];

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-agent-e2e-'));
  home = join(scratch, 'tyto-home');
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('an agent on the running window', () => {
  it('relays tools/list, shows the agent on the status bar, and is cut from there', async () => {
    await expect.poll(records, { timeout: 15_000 }).toHaveLength(1);
    expect(await page.locator('.status-bar__agents').count()).toBe(0);

    const input = new PassThrough();
    const output = new PassThrough();
    const errors: string[] = [];
    const lines: string[] = [];
    let written = '';
    output.on('data', (chunk: Buffer) => {
      written += chunk.toString('utf8');
      let end: number;
      while ((end = written.indexOf('\n')) >= 0) {
        lines.push(written.slice(0, end));
        written = written.slice(end + 1);
      }
    });
    const exit = run(['mcp', '--window'], {
      version: '0.0.0-e2e',
      cwd: scratch,
      home,
      console: { out: (text) => errors.push(text), err: (text) => errors.push(text) },
      rasterizer: () => {
        throw new Error('the relay renders nothing');
      },
      stdio: () => ({ input, output }),
    });
    const frame = (value: object): void => {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
    };
    frame({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1' },
      },
    });
    frame({ method: 'notifications/initialized' });
    frame({ id: 2, method: 'tools/list' });
    await expect.poll(() => lines.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    const tools = (JSON.parse(lines[1] ?? '') as { result: { tools: { name: string }[] } }).result
      .tools;
    expect(tools.map((tool) => tool.name)).toContain('list_templates');
    expect(errors.join('')).toContain('relaying to the');

    // The badge, in the real window, while the agent is connected.
    const badge = page.locator('.status-bar__agents');
    await badge.waitFor({ state: 'attached', timeout: 10_000 });
    expect((await badge.innerText()).trim()).toBe('Agent connected');

    // Its click cuts the connection: the relay ends, and the badge goes.
    await badge.click();
    expect(await exit).toBe(0);
    await page.waitForSelector('.status-bar__agents', { state: 'detached', timeout: 10_000 });
    input.end();
  });

  it('removes its record when it quits', async () => {
    expect(records()).toHaveLength(1);
    await closeApp(app);
    app = undefined;
    expect(records()).toEqual([]);
  });
});
