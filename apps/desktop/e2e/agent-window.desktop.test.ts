import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { run } from '@tyto/command-line';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { switchingFolder } from './folder-switch.js';

/**
 * An agent's window tools on the real window (TYTO-566, ADR 0180), through `tyto mcp --window`.
 *
 * What needs the window is here: the brief in front answered with what was typed and not saved,
 * an open asked of the person in main's box — declined, then accepted — and `agentsListen`
 * switched off in `settings.json`, live. The box is main's `showMessageBox`, which no page can
 * click: it is answered by replacing it in main, as `explorer.desktop.test.ts` answers the folder
 * picker. The single-pending rule and `allow` are `agent-window.test.ts`'s; which tools a trust
 * gets is `window-tools.test.ts`'s.
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
let work: string;
let userData: string;
let app: ElectronApplication | undefined;
let page: Page;

const quiet = { out: () => {}, err: () => {} };
const records = (): string[] =>
  existsSync(join(home, 'windows'))
    ? readdirSync(join(home, 'windows')).filter((name) => name.endsWith('.json'))
    : [];

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-agent-window-'));
  home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  userData = join(scratch, 'user-data');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  writeFileSync(join(work, '.tyto', 'project.json'), '{}\n');
  writeFileSync(join(work, 'a.brief'), '---\ntemplate: cartaz\n---\n');
  mkdirSync(userData, { recursive: true });
  mkdirSync(home, { recursive: true });
  // Window actions are offered only in a trusted workspace (ADR 0180 decision 7).
  const trusted = await run(['trust', 'add', work], {
    version: '0.0.0-e2e',
    cwd: work,
    home,
    console: quiet,
    confirm: () => Promise.resolve(true),
    rasterizer: () => {
      throw new Error('no render here');
    },
  });
  expect(trusted).toBe(0);

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, work);
  await switchingFolder(page, () =>
    page.evaluate(() =>
      (
        document.querySelector('tyto-command-bar') as { run?: (id: string) => boolean } | null
      )?.run?.('workspace.openFolder'),
    ),
  );
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

/** `tyto mcp --window` over two in-memory streams, initialised: what an agent's host is to it. */
async function agent() {
  const input = new PassThrough();
  const output = new PassThrough();
  const waiting = new Map<number, (result: Record<string, unknown>) => void>();
  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
    let end: number;
    while ((end = written.indexOf('\n')) >= 0) {
      const message = JSON.parse(written.slice(0, end)) as {
        id?: number;
        result: Record<string, unknown>;
      };
      written = written.slice(end + 1);
      if (message.id !== undefined) waiting.get(message.id)?.(message.result);
    }
  });
  const exit = run(['mcp', '--window', work], {
    version: '0.0.0-e2e',
    cwd: work,
    home,
    console: quiet,
    rasterizer: () => {
      throw new Error('the relay renders nothing');
    },
    stdio: () => ({ input, output }),
  });
  let next = 1;
  const request = (method: string, params: object = {}) => {
    const id = next++;
    const answered = new Promise<Record<string, unknown>>((resolve) => waiting.set(id, resolve));
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return answered;
  };
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' },
  });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const call = async (name: string, args: object = {}) => {
    const result = await request('tools/call', { name, arguments: args });
    const [first] = result['content'] as { text: string }[];
    return { text: first?.text ?? '', isError: result['isError'] === true };
  };
  return { call, exit };
}

const tabNames = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

/** Replaces main's box with one that answers `response`, and records what it was asked. */
async function answerBox(response: number): Promise<void> {
  await app?.evaluate(({ dialog }, answer) => {
    const asked = ((globalThis as { agentBoxes?: string[] }).agentBoxes ??= []);
    dialog.showMessageBox = ((...args: unknown[]) => {
      const options = args.at(-1) as { message: string };
      asked.push(options.message);
      return Promise.resolve({ response: answer, checkboxChecked: false });
    }) as typeof dialog.showMessageBox;
  }, response);
}

const boxes = (): Promise<string[] | undefined> =>
  app!.evaluate(() => (globalThis as { agentBoxes?: string[] }).agentBoxes);

describe("an agent's window tools on the running window", () => {
  it('reads the brief in front with what was typed and not saved', async () => {
    await page.locator('#editor .cm-content').click();
    await page.keyboard.type('typed-not-saved');
    const client = await agent();
    await expect
      .poll(async () => (await client.call('brief_in_front')).text, { timeout: 10_000 })
      .toContain('typed-not-saved');
    const front = JSON.parse((await client.call('brief_in_front')).text) as {
      unsaved: boolean;
      path: string | null;
    };
    expect(front).toMatchObject({ unsaved: true, path: null });
  });

  it('asks the person before opening a file, naming its full path, and opens only on yes', async () => {
    const client = await agent();
    await answerBox(1);
    const declined = await client.call('open_file', { path: 'a.brief' });
    expect(declined).toEqual({ text: 'declined: the person chose not to', isError: true });
    expect(await tabNames()).not.toContain('a.brief');
    expect((await boxes())?.[0]).toContain(join(work, 'a.brief'));

    await answerBox(0);
    expect(await client.call('open_file', { path: 'a.brief' })).toEqual({
      text: 'done',
      isError: false,
    });
    await expect.poll(tabNames, { timeout: 10_000 }).toContain('a.brief');
  });

  it('stops listening when agentsListen is switched off, live', async () => {
    const client = await agent();
    expect(records()).toHaveLength(1);
    writeFileSync(join(userData, 'settings.json'), '{\n  "agentsListen": false\n}\n');
    // The record first, on a deadline: a window that kept listening fails here in 10 s rather
    // than at the suite's timeout waiting for a relay nobody cut.
    await expect.poll(records, { timeout: 10_000 }).toEqual([]);
    expect(await client.exit).toBe(0);
  });
});
