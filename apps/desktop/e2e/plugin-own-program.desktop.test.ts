import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '@tyto/command-line';
import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A plugin's own program and the terminal it opens, in the running app (TYTO-657, ADR 0184).
 *
 * `proprio` ships `bin/own.mjs` and maps `tyto-own` to it in `programs`. Nothing named
 * `tyto-own` is on `PATH`: the program can only run as the plugin's script on the bundled Node.
 * One exporter starts it and answers what it printed; another asks `host.terminal.open` for a
 * tab running it in `login` mode, which writes a file, prints a line and waits for a line typed
 * into the tab, as a login waits for the person. A third names a script that is not there.
 *
 * What each rule decides is `plugin-programs.test.ts`'s, `terminal.test.ts`'s and plugin-api's;
 * this file proves main composes them. Its own `--user-data-dir` and `TYTO_HOME`; `--lang=en`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}

const OWN = 'tyto-own';
const GONE = 'tyto-gone';

let scratch: string;
let home: string;
let work: string;
let marker: string;
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
async function exported(kind: 'own' | 'term' | 'gone'): Promise<string> {
  const out = mkdtempSync(join(scratch, 'out-'));
  const { exportId } = await call<{ exportId: string }>('export:start', {
    documentId: 'proprio',
    brief: ['---', 'template: promo-curso', 'formats: [grid-1x1]', '---', '::titulo Proprio'].join(
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

/** The plugin's own program: `echo` prints what it ran on; `login` waits for a typed line. */
const OWN_SCRIPT = `
import { writeFileSync } from 'node:fs';
const [mode, ...rest] = process.argv.slice(2);
if (mode === 'login') {
  writeFileSync(rest[0], JSON.stringify({ args: rest.slice(1), cwd: process.cwd(), tty: Boolean(process.stdout.isTTY) }));
  process.stdout.write('LOGIN TAB READY\\r\\n');
  process.stdin.once('data', () => process.exit(0));
} else {
  process.stdout.write('ARGS ' + JSON.stringify(rest) + '\\n');
  process.stdout.write('NODE ' + process.execPath + '\\n');
  process.stdout.write('SECRET ' + (process.env.ANTHROPIC_API_KEY ?? 'absent') + '\\n');
  process.stdout.write('CWD ' + process.cwd() + '\\n');
}
`;

function writeOwnPlugin(): void {
  const folder = join(home, 'plugins', 'proprio');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  mkdirSync(join(folder, 'bin'), { recursive: true });
  writeFileSync(join(folder, 'bin', 'own.mjs'), OWN_SCRIPT);
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'proprio',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions: [`process:${OWN}`, `process:${GONE}`],
      programs: { [OWN]: 'bin/own.mjs', [GONE]: 'bin/gone.mjs' },
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'proprio', type: 'module' }));
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `const refused = (cause) => 'REFUSED ' + (cause && cause.code ? cause.code : String(cause));
const answer = (value) => ({ ok: true, value, diagnostics: [] });
const exporter = (kind, run) => ({
  id: kind, mime: 'text/plain', extension: kind, kinds: [kind], rasterized: false,
  exportFrame: async () => {
    try { return answer(await run()); } catch (cause) { return answer(refused(cause)); }
  },
});
export function activate(host) {
  host.registerExporter(exporter('own', async () => {
    const program = await host.process.start(${JSON.stringify(OWN)}, ['echo', 'two words', '--acp']);
    let heard = '';
    program.onStdout((bytes) => { heard += new TextDecoder().decode(bytes); });
    const exit = await program.exited;
    return heard + 'EXIT ' + String(exit.code);
  }));
  host.registerExporter(exporter('term', async () => {
    await host.terminal.open(${JSON.stringify(OWN)}, ['login', ${JSON.stringify(join(home, '..', 'login.json'))}, '--cli', 'auth', 'login']);
    return 'OPENED';
  }));
  host.registerExporter(exporter('gone', async () => {
    await host.process.start(${JSON.stringify(GONE)}, []);
    return 'STARTED';
  }));
}
`,
  );
}

async function opening(folder: string): Promise<{ trust: string }> {
  await app!.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
  return call<{ trust: string }>('workspace:set-folder', { choose: true });
}

interface Listed {
  readonly terminalId: string;
  readonly title: string;
  readonly replay: string;
}
const listed = async (): Promise<readonly Listed[]> =>
  (await call<{ terminals: Listed[] }>('terminal:list', {})).terminals;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-plugin-own-'));
  home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  marker = join(scratch, 'login.json');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  writeFileSync(join(work, '.tyto', 'project.json'), '{}\n');
  mkdirSync(join(scratch, 'user-data'), { recursive: true });
  writeOwnPlugin();
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({
      plugins: {
        proprio: {
          enabled: true,
          permissions: [`process:${OWN}`, `process:${GONE}`],
          source: '.',
        },
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

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: {
      ...(process.env as Record<string, string>),
      ANTHROPIC_API_KEY: 'sk-ant-must-not-arrive',
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

describe("a plugin's own program (ADR 0184)", () => {
  it('runs its script on the bundled Node, in the open folder, with no secret', async () => {
    const heard = await exported('own');
    process.stdout.write(
      `[TYTO-657] the plugin's own program answered: ${JSON.stringify(heard)}\n`,
    );

    expect(heard).toContain('ARGS ["two words","--acp"]\n');
    expect(heard).toContain('SECRET absent\n');
    const node = /^NODE (.+)$/mu.exec(heard)?.[1];
    // The bundled Node in `out/node`, never Electron and never a Node on PATH.
    expect(realpathSync.native(node!)).toBe(
      realpathSync.native(
        join(here, '..', 'out', 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
      ),
    );
    const cwd = /^CWD (.+)$/mu.exec(heard)?.[1];
    expect(realpathSync.native(cwd!)).toBe(realpathSync.native(work));
    expect(heard).toMatch(/EXIT 0$/u);
  }, 30_000);

  it('refuses a script its folder does not hold, by its own code', async () => {
    expect(await exported('gone')).toBe('REFUSED E_PROCESS_SCRIPT_MISSING');
  }, 30_000);

  it('opens it in a terminal tab the window shows, one at a time', async () => {
    expect(await exported('term')).toBe('OPENED');
    // Main opened the tab; the window adopted it and put the Terminal tab in front.
    await expect
      .poll(async () => (await listed()).map((terminal) => terminal.title), { timeout: 10_000 })
      .toContain(OWN);
    await expect.poll(() => existsSync(marker), { timeout: 10_000 }).toBe(true);
    const ran = JSON.parse(readFileSync(marker, 'utf8')) as {
      args: string[];
      cwd: string;
      tty: boolean;
    };
    process.stdout.write(`[TYTO-657] the terminal ran: ${JSON.stringify(ran)}\n`);
    expect(ran.args).toEqual(['--cli', 'auth', 'login']);
    expect(ran.tty).toBe(true);
    expect(realpathSync.native(ran.cwd)).toBe(realpathSync.native(work));
    const tab = (await listed()).find((terminal) => terminal.title === OWN)!;
    await expect
      .poll(async () => (await listed()).find((t) => t.terminalId === tab.terminalId)?.replay, {
        timeout: 10_000,
      })
      .toContain('LOGIN TAB READY');
    await page.waitForSelector('.xterm', { timeout: 10_000 });

    // While that tab is open, the plugin may not open another.
    expect(await exported('term')).toBe('REFUSED E_TERMINAL_LIMIT');

    // The person finishes in the tab: the program ends, and the plugin may ask again.
    await call('terminal:input', { terminalId: tab.terminalId, data: 'done\r' });
    await expect
      .poll(async () => (await listed()).some((t) => t.terminalId === tab.terminalId), {
        timeout: 10_000,
      })
      .toBe(false);
    rmSync(marker, { force: true });
    expect(await exported('term')).toBe('OPENED');
    await expect.poll(() => existsSync(marker), { timeout: 10_000 }).toBe(true);
  }, 45_000);

  it('opens nothing while the folder is restricted', async () => {
    for (const terminal of await listed()) {
      await call('terminal:kill', { terminalId: terminal.terminalId });
    }
    const other = join(scratch, 'other');
    mkdirSync(join(other, '.tyto'), { recursive: true });
    expect((await opening(other)).trust).toBe('restricted');
    expect(await exported('term')).toBe('REFUSED E_PROCESS_RESTRICTED');
    expect(await exported('own')).toBe('REFUSED E_PROCESS_RESTRICTED');
  }, 30_000);
});
