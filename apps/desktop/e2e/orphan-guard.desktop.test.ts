import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { isAlive } from './launch-ledger.js';

/**
 * A worker that dies with its app open leaves no app behind, and nobody else's app is touched
 * (TYTO-292, ADR 0106).
 *
 * **The crash is real, not simulated in-process.** A nested vitest run (`__fixtures__/orphan-run`)
 * launches the app through the same wrapper every suite uses, writes down which process it got,
 * and kills its own worker — the way `0xC0000409` did, with no `afterAll` left to run. What this
 * file asserts is what the machine looks like once that run has ended: the orphan's PID gone and
 * no process anywhere still carrying its data folder, while an app this file launched on its own
 * — standing for Rafael's Tyto, or another worktree's run — is still alive.
 */

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const fixtureConfig = join(here, '__fixtures__', 'orphan-run', 'vitest.config.ts');
const vitestEntry = join(desktop, 'node_modules', 'vitest', 'vitest.mjs');

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Every live process whose command line contains `needle`, read from the operating system. */
function processesMentioning(needle: string): number[] {
  if (process.platform === 'win32') {
    // The needle travels in the environment, so no quoting of a Windows path can go wrong.
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ' +
          '$_.CommandLine.Contains($env:TYTO_ORPHAN_NEEDLE) } | ForEach-Object { $_.ProcessId }',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, TYTO_ORPHAN_NEEDLE: needle },
        windowsHide: true,
      },
    );
    return out
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== '')
      .map(Number);
  }
  return readdirSync('/proc')
    .filter((entry) => /^\d+$/u.test(entry))
    .filter((entry) => {
      try {
        return readFileSync(join('/proc', entry, 'cmdline'), 'utf8').includes(needle);
      } catch {
        return false;
      }
    })
    .map(Number);
}

interface Run {
  readonly code: number | null;
  readonly output: string;
}

/** The nested run, to its end. Asynchronous so the bystander's connection keeps being served. */
function runFixture(scratch: string, marker: string): Promise<Run> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TYTO_ORPHAN_SCRATCH: scratch,
    TYTO_ORPHAN_MARKER: marker,
  };
  // This worker's own identity is not the nested run's.
  for (const name of Object.keys(environment)) {
    if (name.startsWith('VITEST')) delete environment[name];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vitestEntry, 'run', '--config', fixtureConfig], {
      cwd: desktop,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (output += chunk));
    child.stderr.on('data', (chunk: string) => (output += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code, output });
    });
  });
}

let scratch: string;
let bystander: ElectronApplication | undefined;
let bystanderUserData: string;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-orphan-e2e-'));
  bystanderUserData = join(scratch, 'bystander-userData');
  bystander = await _electron.launch({
    args: ['.', `--user-data-dir=${bystanderUserData}`],
    cwd: desktop,
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'bystander-home') },
  });
  await firstWindow(bystander);
}, 180_000);

afterAll(async () => {
  // Closed only if it is still there: a guard that ended it too has already failed the test.
  if (bystander !== undefined && processesMentioning(bystanderUserData).length > 0) {
    await closeApp(bystander);
  }
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
});

describe('a worker that dies with its app open', () => {
  it('leaves no app of its run alive, and the app outside the run untouched', async () => {
    const marker = join(scratch, 'orphan.json');
    const run = await runFixture(join(scratch, 'orphan'), marker);

    expect(run.code, run.output).not.toBe(0);
    expect(run.output).toContain('Worker exited unexpectedly');
    expect(existsSync(marker), `the fixture never launched its app:\n${run.output}`).toBe(true);
    const orphan = JSON.parse(readFileSync(marker, 'utf8')) as { pid: number; userData: string };
    // The nested teardown's own line, so this log says what it ended.
    const teardown = run.output.split(/\r?\n/u).find((line) => line.includes('[TYTO-292]'));
    process.stdout.write(
      `[TYTO-292] nested run exited ${String(run.code)}; launch pid ${String(orphan.pid)}; ` +
        `its teardown: ${teardown ?? 'printed nothing'}\n`,
    );

    // A kill is delivered, not obeyed, at the moment it is sent: up to ten seconds to be gone.
    const started = Date.now();
    let left = processesMentioning(orphan.userData);
    while ((isAlive(orphan.pid) || left.length > 0) && Date.now() - started < 10_000) {
      await sleep(250);
      left = processesMentioning(orphan.userData);
    }
    expect({ alive: isAlive(orphan.pid), carryingItsFolder: left }).toEqual({
      alive: false,
      carryingItsFolder: [],
    });

    // By its folder, not `bystander.process()`: on Windows that is the shell Playwright started
    // Electron in, and Playwright's own handle is gone once the app is.
    expect(processesMentioning(bystanderUserData).length).toBeGreaterThan(0);
    expect(await bystander?.evaluate(({ app }) => app.isReady())).toBe(true);
  });
});
