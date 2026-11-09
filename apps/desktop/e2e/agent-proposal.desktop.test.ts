import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
 * An agent's proposed edit in the real window (TYTO-566, ADR 0180 decision 5), through `tyto mcp
 * --window`: shown in the editor and not written, accepted from its bar as one undo step that
 * leaves the file on disk as it was, and made stale by the person typing in it.
 *
 * The proposal's mapping, its refusals and its decorations are `packages/editor`'s
 * `proposals.test.ts`; the lines and columns and the ledger are `agent-proposals.test.ts`.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139). `--lang=en`. `agentsWindowActions` is
 * `allow` here only so the brief opens without a box; the edit is a proposal regardless.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}

const BRIEF = 'titulo: Hello\nsubtitulo: World\n';

let scratch: string;
let home: string;
let work: string;
let app: ElectronApplication | undefined;
let page: Page;

const quiet = { out: () => {}, err: () => {} };

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-agent-proposal-'));
  home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  const userData = join(scratch, 'user-data');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  writeFileSync(join(work, '.tyto', 'project.json'), '{}\n');
  writeFileSync(join(work, 'a.brief'), BRIEF);
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), '{\n  "agentsWindowActions": "allow"\n}\n');
  mkdirSync(home, { recursive: true });
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

/** `tyto mcp --window` over two in-memory streams, initialised. */
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
  void run(['mcp', '--window', work], {
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
  return { call, close: () => input.end() };
}

/** The editor's text, line by line as drawn; the brief is short enough to be all on screen. */
const editorText = (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-line')].map((line) => line.textContent).join('\n'),
  );

const statusOf = async (client: Awaited<ReturnType<typeof agent>>, id: string) =>
  (JSON.parse((await client.call('proposal_status', { id })).text) as { status: string }).status;

const hello = {
  from: { line: 1, column: 9 },
  to: { line: 1, column: 14 },
  insert: 'Olá',
  expect: 'Hello',
};

describe("an agent's proposed edit in the real window", () => {
  it('is shown and not written, applies on accept as one undo step, and leaves the file alone', async () => {
    const client = await agent();
    expect(await client.call('open_file', { path: 'a.brief' })).toEqual({
      text: 'done',
      isError: false,
    });
    await expect.poll(editorText, { timeout: 10_000 }).toBe(BRIEF);
    const before = await editorText();

    const proposed = await client.call('propose_edit', { edits: [hello] });
    expect(proposed.isError).toBe(false);
    const { id } = JSON.parse(proposed.text) as { id: string };
    await page.waitForSelector('.cm-proposal-bar', { timeout: 10_000 });
    expect(await page.locator('.cm-proposal-accept').innerText()).toBe('Accept');
    expect(await statusOf(client, id)).toBe('proposed');
    // A second proposal while this one waits is declined.
    expect((await client.call('propose_edit', { edits: [hello] })).text).toBe(
      'declined: a proposal is pending in this document',
    );

    await page.locator('.cm-proposal-accept').click();
    await expect.poll(editorText, { timeout: 10_000 }).toBe('titulo: Olá\nsubtitulo: World\n');
    expect(await statusOf(client, id)).toBe('accepted');
    // Accepting writes no file: the disk still holds the brief as it was.
    expect(readFileSync(join(work, 'a.brief'), 'utf8')).toBe(BRIEF);

    // One Ctrl+Z gives back exactly the text from before.
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+z');
    await expect.poll(editorText, { timeout: 10_000 }).toBe(before);
    client.close();
  });

  it('becomes stale when the person types in the proposed text, and refuses what it did not expect', async () => {
    const client = await agent();
    const proposed = await client.call('propose_edit', { edits: [hello] });
    const { id } = JSON.parse(proposed.text) as { id: string };
    await page.waitForSelector('.cm-proposal-bar', { timeout: 10_000 });

    // A click in the struck-through "Hello" puts the caret in it; a letter typed there.
    await page.locator('.cm-proposal-removed').first().click();
    await page.keyboard.type('X');
    expect(await editorText()).toMatch(/^titulo: H\w*X\w*/u);
    await expect.poll(() => statusOf(client, id), { timeout: 10_000 }).toBe('stale');
    expect(await page.locator('.cm-proposal-bar').count()).toBe(0);

    const refused = await client.call('propose_edit', {
      edits: [{ ...hello, expect: 'Goodbye' }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/^stale:/u);
    client.close();
  });
});
