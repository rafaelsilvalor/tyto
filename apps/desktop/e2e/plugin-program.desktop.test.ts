import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '@tyto/command-line';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { STAND_IN, writeProgramPlugin, writeStandInProgram } from './stand-in-program.js';

/**
 * A program an installed plugin starts through `process:<name>`, in the running app (TYTO-568,
 * ADR 0182): found on `PATH` as a `.cmd` under a folder with a space on Windows, given an
 * environment with no secret, run in the open folder, refused in a restricted one, and ended
 * when the trust is taken back, when another folder opens and when the window closes. The same
 * plugin hands it the window's agent server (TYTO-569, ADR 0183), and the window answers.
 *
 * What each rule decides is `plugin-programs.test.ts`'s and `process.test.ts`'s; this file proves
 * main composes them: the port reaches the plugin's process, and the workspace and the window
 * end what it started. Its own `--user-data-dir` and `TYTO_HOME`; `--lang=en`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}

let scratch: string;
let home: string;
let work: string;
let pidFile: string;
let app: ElectronApplication | undefined;
let page: Page;

const quiet = { out: () => {}, err: () => {} };

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;
const call = <T>(channel: string, request: unknown): Promise<T> =>
  page.evaluate(
    ([name, body]) => (globalThis as never as { tyto: Bridge }).tyto[name as string]!(body),
    [channel, request] as const,
  ) as Promise<T>;

/** One export of the one-frame brief to `kind`, answered with the file's text. */
async function exported(kind: 'echo' | 'hold' | 'agent'): Promise<string> {
  const out = mkdtempSync(join(scratch, 'out-'));
  const { exportId } = await call<{ exportId: string }>('export:start', {
    documentId: 'programa',
    brief: ['---', 'template: promo-curso', 'formats: [grid-1x1]', '---', '::titulo Programa'].join(
      '\n',
    ),
    directory: out,
    outputs: [{ kind }],
  });
  const started = Date.now();
  for (;;) {
    const { progress } = await call<{ progress?: { status: string; failure?: string } }>(
      'export:progress',
      { exportId },
    );
    if (progress !== undefined && progress.status !== 'running') {
      expect(progress.failure).toBeUndefined();
      break;
    }
    if (Date.now() - started > 20_000) throw new Error(`the ${kind} export never finished`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const [file] = readdirSync(out).filter((name) => name.endsWith(`.${kind}`));
  return readFileSync(join(out, file!), 'utf8');
}

/** Whether the process `pid` runs; `kill(pid, 0)` signals nothing and only asks. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The `hold` program started now: its process id, read from the file it writes. */
async function holding(): Promise<number> {
  rmSync(pidFile, { force: true });
  expect(await exported('hold')).toBe('STARTED');
  await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  expect(alive(pid)).toBe(true);
  return pid;
}

async function opening(folder: string): Promise<{ trust: string }> {
  await app!.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
  return call<{ trust: string }>('workspace:set-folder', { choose: true });
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-plugin-program-'));
  home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  pidFile = join(scratch, 'hold.pid');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  writeFileSync(join(work, '.tyto', 'project.json'), '{}\n');
  mkdirSync(join(scratch, 'user-data'), { recursive: true });
  writeProgramPlugin(home, pidFile);
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({
      plugins: {
        programa: { enabled: true, permissions: [`process:${STAND_IN}`], source: '.' },
      },
    }),
  );
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

  // The stand-in's folder first on PATH, under whichever spelling this system uses.
  const bin = writeStandInProgram(join(scratch, 'program bin'));
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: {
      ...(process.env as Record<string, string>),
      [pathKey]: `${bin}${delimiter}${process.env[pathKey] ?? ''}`,
      ANTHROPIC_API_KEY: 'sk-ant-must-not-arrive',
      GH_TOKEN: 'ghp-must-not-arrive',
      TYTO_HEADLESS: '1',
      TYTO_HOME: home,
    },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  expect((await opening(work)).trust).toBe('trusted');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a program a plugin starts (ADR 0182)', () => {
  it('talks to it both ways, in the open folder, with no secret in its environment', async () => {
    const heard = await exported('echo');
    process.stdout.write(`[TYTO-568] the plugin's program answered: ${JSON.stringify(heard)}\n`);

    expect(heard).toContain('ARGS ["two words","--acp"]\n');
    expect(heard).toContain('SECRET absent\n');
    expect(heard).toContain('TOKEN absent\n');
    expect(heard).toMatch(/WINDOW \d+\n/u);
    expect(heard).toContain(`CWD ${work}`);
    expect(heard).toContain('HELLO FROM THE PLUGIN\n');
    expect(heard).toMatch(/EXIT 0$/u);
  }, 30_000);

  it("hands it the window's agent server, through which it lists the window's tools (ADR 0183)", async () => {
    const heard = await exported('agent');
    const pid = await app!.evaluate(() => process.pid);
    process.stdout.write(`[TYTO-569] the plugin's agent heard: ${JSON.stringify(heard)}\n`);

    // The server as the plugin got it: named `tyto`, with the relay's two variables only.
    expect(heard).toContain('SERVER tyto TYTO_WINDOW,TYTO_HOME\n');
    // A window tool: the window answered through the bundled relay (ADR 0180, ADR 0181).
    expect(heard).toMatch(/TOOLS [a-z_,]*brief_in_front/u);
    expect(heard).toContain(`(pid ${String(pid)})`);
    expect(heard).toMatch(/EXIT 0$/u);
  }, 30_000);

  it('ends it when the folder trust is taken back, and when another folder opens', async () => {
    const first = await holding();
    await call('workspace:trust', { trusted: false, source: 'folder' });
    await expect.poll(() => alive(first), { timeout: 10_000 }).toBe(false);

    // Revoked, the folder stays trusted until it reopens (ADR 0111), so a program may start.
    const second = await holding();
    const other = join(scratch, 'other');
    mkdirSync(join(other, '.tyto'), { recursive: true });
    expect((await opening(other)).trust).toBe('restricted');
    await expect.poll(() => alive(second), { timeout: 10_000 }).toBe(false);

    expect(await exported('echo')).toBe('REFUSED E_PROCESS_RESTRICTED');
    expect(await exported('agent')).toBe('REFUSED E_WINDOW_RESTRICTED');
  }, 45_000);

  // Last: it closes the app, and `afterAll`'s `closeApp` then finds it already down.
  it('ends it when the window closes', async () => {
    const trusted = join(scratch, 'third');
    mkdirSync(join(trusted, '.tyto'), { recursive: true });
    await call('workspace:set-folder', { choose: false });
    await opening(trusted);
    await call('workspace:trust', { trusted: true, source: 'folder' });
    const pid = await holding();

    await closeApp(app);
    app = undefined;
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false);
  }, 45_000);
});
