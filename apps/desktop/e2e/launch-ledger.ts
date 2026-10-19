import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inject } from 'vitest';

/**
 * Every Electron an end-to-end run launches, written down so the run can end it (TYTO-292, ADR 0106).
 *
 * **Why.** A suite closes its app in `afterAll`, which runs in the vitest worker. When the worker
 * dies — `0xC0000409` under load, three times in one batch and ten processes from three worktrees
 * on 2026-10-14 — nothing closes the app, and it runs for hours. The main vitest process outlives
 * the worker and runs the global setup's teardown even after a worker crash, so the record lives
 * where that teardown can read it: a folder the global setup makes per run, one JSON line per
 * launch, appended synchronously — an app before it starts (TYTO-338), a spawned probe the
 * moment its PID exists.
 *
 * **An app is found by its data folder, not by its PID.** On Windows `_electron.launch` starts
 * Electron through `cmd.exe` (`shell: true` in Playwright 1.63), so `app.process().pid` is the
 * shell, and the shell went with the worker while Electron stayed — measured on the first run of
 * `orphan-guard.desktop.test.ts`: the recorded PID dead, four `electron.exe` alive. What every
 * process of the app does carry is the scratch `--user-data-dir` it was launched with, a folder
 * `mkdtemp` made for that one launch, so the teardown ends a live process only when its command
 * line carries a recorded folder and it was created after that launch began. Rafael's own Tyto,
 * and another worktree's run, carry other folders.
 *
 * **A Node-mode probe has no data folder**, so it is found by PID, and the PID is believed only
 * while the live process was created inside the window in which the probe spawned it. Its `spawn`
 * has no shell, so the PID is the program's own.
 */

/** One launch, as a JSON line in the run's ledger. */
export interface LaunchRecord {
  /**
   * The PID the spawn returned, or `undefined` for an app written down before it started. An app
   * is matched by its folder, so it needs no PID, and `_electron.launch` gives one only once it
   * resolves — seconds later on a loaded machine, a window a dying worker can fall into.
   */
  readonly pid: number | undefined;
  /** The scratch `--user-data-dir`, or `undefined` for a launch that runs as Node. */
  readonly userData: string | undefined;
  /**
   * Epoch milliseconds: just before the launch started, and just after the PID was known (the
   * same instant for an app written down before it started; only a probe's is ever read).
   */
  readonly notBefore: number;
  readonly notAfter: number;
}

/** What the owner of a run folder wrote, so a later run can tell whether it is still alive. */
export interface LedgerOwner {
  readonly pid: number;
  readonly startedAt: number;
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** The run's ledger folder, from `launch-ledger.global-setup.ts`. */
    launchLedger: string;
  }
}

export const LEDGER_PREFIX = 'tyto-e2e-run-';
const LAUNCHES_FILE = 'launches.jsonl';
export const OWNER_FILE = 'owner.json';
const USER_DATA_SWITCH = '--user-data-dir=';

/**
 * Slack around a creation time. Windows reports it to the millisecond, `ps -o etimes` on POSIX
 * to the second; two seconds either side covers both.
 */
const CREATION_SLACK_MS = 2_000;
const GONE_DEADLINE_MS = 10_000;

/** Append a launch to the run's ledger. Throws if the config has no ledger global setup. */
export function recordLaunch(record: LaunchRecord): void {
  const folder = inject('launchLedger') as string | undefined;
  if (typeof folder !== 'string' || folder === '') {
    throw new Error(
      'launch-ledger: no ledger was provided — add e2e/launch-ledger.global-setup.ts to the ' +
        "config's globalSetup, or an Electron this run launches outlives a crashed worker",
    );
  }
  appendFileSync(join(folder, LAUNCHES_FILE), `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Record a process `spawn` just started, before anything awaits. `pid` is undefined when the
 * spawn itself failed, and then there is nothing to end.
 */
export function recordSpawn(
  pid: number | undefined,
  userData: string | undefined,
  notBefore: number,
): void {
  if (pid === undefined) return;
  recordLaunch({ pid, userData, notBefore, notAfter: Date.now() });
}

/**
 * Write down an app that is about to start in `userData`, before anything awaits (TYTO-338). The
 * teardown finds it by that folder whether or not the launch ever resolved, so a worker that dies
 * while Playwright is still launching leaves a record too — and so can a test that hands the
 * folder to a process the ledger would not otherwise see, such as a nested run that may die
 * before its own teardown.
 */
export function recordAppBeforeItStarts(userData: string): void {
  const now = Date.now();
  recordLaunch({ pid: undefined, userData, notBefore: now, notAfter: now });
}

/** The launches a ledger folder holds; a torn last line (a crash mid-write) is skipped. */
export function readLaunches(folder: string): LaunchRecord[] {
  const file = join(folder, LAUNCHES_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line) => {
      if (line.trim() === '') return [];
      try {
        return [JSON.parse(line) as LaunchRecord];
      } catch {
        return [];
      }
    });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM: it exists and belongs to somebody else, which is alive all the same.
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What the operating system says about a live process. */
export interface ProcessFacts {
  readonly pid: number;
  readonly commandLine: string;
  /** Epoch milliseconds. */
  readonly startedAt: number;
}

const powershell = (script: string): string =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });

/** `Win32_Process` rows as JSON; the filter is WQL, written with single quotes only. */
function windowsProcesses(filter: string): ProcessFacts[] {
  const out = powershell(
    `$rows = @(Get-CimInstance Win32_Process -Filter '${filter.replaceAll("'", "''")}' | ` +
      'ForEach-Object { [pscustomobject]@{ p = $_.ProcessId; c = [string]$_.CommandLine; ' +
      't = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } }); ' +
      '[Console]::Out.Write((ConvertTo-Json -InputObject $rows -Compress))',
  );
  if (out.trim() === '') return [];
  const rows = JSON.parse(out) as { p: number; c: string; t: number }[];
  return rows.map((row) => ({ pid: row.p, commandLine: row.c, startedAt: row.t }));
}

/** When a POSIX process was created, from its elapsed seconds. */
function posixStartedAt(pid: number): number | undefined {
  try {
    const elapsedSeconds = Number(
      execFileSync('ps', ['-o', 'etimes=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
    return Number.isFinite(elapsedSeconds) ? Date.now() - elapsedSeconds * 1_000 : undefined;
  } catch {
    // `ps` exits 1 for a process that ended after `/proc` was listed. On a runner where other
    // files' apps start and end all the time this is routine, and when it threw, the whole
    // candidate list was dropped and nothing was ended (TYTO-338, measured on CI).
    return undefined;
  }
}

/** The command line and creation time of `pid`, or `undefined` if it is gone or unreadable. */
export function processFacts(pid: number): ProcessFacts | undefined {
  try {
    if (process.platform === 'win32') {
      // One query for one PID: listing every process would cost seconds on a busy machine.
      return windowsProcesses(`ProcessId=${String(pid)}`)[0];
    }
    const commandLine =
      process.platform === 'linux'
        ? readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8')
            .split('\0')
            .join(' ')
        : execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const startedAt = posixStartedAt(pid);
    return startedAt === undefined ? undefined : { pid, commandLine, startedAt };
  } catch {
    return undefined;
  }
}

/**
 * Every live process that names a data folder on its command line, in one query: one
 * `Win32_Process` filter on Windows, `/proc` on Linux, `ps` elsewhere.
 */
export function processesNamingAUserDataFolder(): ProcessFacts[] {
  try {
    if (process.platform === 'win32') {
      return windowsProcesses(`CommandLine LIKE '%${USER_DATA_SWITCH}%'`);
    }
    const candidates: { pid: number; commandLine: string }[] =
      process.platform === 'linux'
        ? readdirSync('/proc')
            .filter((entry) => /^\d+$/u.test(entry))
            .flatMap((entry) => {
              try {
                const commandLine = readFileSync(join('/proc', entry, 'cmdline'), 'utf8')
                  .split('\0')
                  .join(' ');
                return [{ pid: Number(entry), commandLine }];
              } catch {
                return [];
              }
            })
        : execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
            .split('\n')
            .flatMap((line) => {
              const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
              return match === null ? [] : [{ pid: Number(match[1]), commandLine: match[2] ?? '' }];
            });
    return candidates
      .filter((candidate) => candidate.commandLine.includes(USER_DATA_SWITCH))
      .flatMap((candidate) => {
        const startedAt = posixStartedAt(candidate.pid);
        return startedAt === undefined ? [] : [{ ...candidate, startedAt }];
      });
  } catch {
    return [];
  }
}

/**
 * Whether a live process belongs to a recorded launch. See the file comment for why an app is
 * matched by its folder and a probe by its PID and creation window.
 */
export function belongsTo(record: LaunchRecord, facts: ProcessFacts): boolean {
  if (facts.startedAt < record.notBefore - CREATION_SLACK_MS) return false;
  if (record.userData === undefined) {
    return facts.pid === record.pid && facts.startedAt <= record.notAfter + CREATION_SLACK_MS;
  }
  // Chromium's children quote the value (`--user-data-dir="C:\…"`), the main process may not.
  // The whole value, not a prefix of it: `…\userData` must not match `…\userData2`.
  const unquoted = `${facts.commandLine.replaceAll('"', '')} `;
  return unquoted.includes(`${USER_DATA_SWITCH}${record.userData} `);
}

export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Already gone between the deadline and the kill: the `close` event still resolves.
  }
}

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** What ending a ledger did, printed so a run's log says whether it ever had to. */
export interface LedgerSweep {
  readonly recorded: number;
  readonly killed: number[];
  /** Killed, and still alive at the deadline. */
  readonly survivors: number[];
}

/** The live processes that belong to one of `records`. */
function liveProcessesOf(records: readonly LaunchRecord[]): ProcessFacts[] {
  const apps = records.filter((record) => record.userData !== undefined);
  const probes = records.filter((record) => record.userData === undefined);
  const found = new Map<number, ProcessFacts>();
  if (apps.length > 0) {
    for (const facts of processesNamingAUserDataFolder()) {
      if (apps.some((record) => belongsTo(record, facts))) found.set(facts.pid, facts);
    }
  }
  for (const record of probes) {
    if (record.pid === undefined || !isAlive(record.pid)) continue;
    const facts = processFacts(record.pid);
    if (facts !== undefined && belongsTo(record, facts)) found.set(facts.pid, facts);
  }
  return [...found.values()];
}

/** End every process in `folder`'s ledger that is still running, and wait for each to go. */
export function endRecordedLaunches(folder: string): LedgerSweep {
  const records = readLaunches(folder);
  if (records.length === 0) return { recorded: 0, killed: [], survivors: [] };
  const live = liveProcessesOf(records);
  const killed = live.map((facts) => facts.pid);
  for (const pid of killed) {
    killTree(pid);
    // A process that is not a group leader on POSIX does not take the group signal.
    if (process.platform !== 'win32' && isAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Gone already.
      }
    }
  }
  const started = Date.now();
  let survivors = killed.filter(isAlive);
  while (survivors.length > 0 && Date.now() - started < GONE_DEADLINE_MS) {
    sleepSync(100);
    survivors = survivors.filter(isAlive);
  }
  return { recorded: records.length, killed, survivors };
}

/** The owner a run folder names, or `undefined` for a folder without a readable one. */
function ownerOf(folder: string): LedgerOwner | undefined {
  try {
    return JSON.parse(readFileSync(join(folder, OWNER_FILE), 'utf8')) as LedgerOwner;
  } catch {
    return undefined;
  }
}

/** Whether the vitest process that made `folder` is still running, so the folder is in use. */
function ownerIsRunning(owner: LedgerOwner): boolean {
  if (!isAlive(owner.pid)) return false;
  const facts = processFacts(owner.pid);
  // Unreadable but alive: assume it is the owner. Leaving a folder costs disk; ending a live
  // run's apps would be the bug this card exists to prevent, the other way round.
  if (facts === undefined) return true;
  return Math.abs(facts.startedAt - owner.startedAt) <= CREATION_SLACK_MS;
}

/**
 * End what earlier runs left behind: every `tyto-e2e-run-*` folder whose owner is gone — killed
 * itself, by Ctrl+C or a closed terminal — has its recorded launches ended by the same rules, and
 * is removed. A folder whose owner is alive belongs to a run in progress, in this worktree or
 * another, and is not touched.
 */
export function sweepAbandonedRuns(except: string): LedgerSweep[] {
  const root = tmpdir();
  const sweeps: LedgerSweep[] = [];
  for (const name of readdirSync(root)) {
    if (!name.startsWith(LEDGER_PREFIX)) continue;
    const folder = join(root, name);
    if (folder === except) continue;
    const owner = ownerOf(folder);
    // A folder still being made by a run that started this instant has no owner file yet.
    if (owner === undefined) continue;
    if (ownerIsRunning(owner)) continue;
    sweeps.push(endRecordedLaunches(folder));
    rmSync(folder, { recursive: true, force: true });
  }
  return sweeps;
}
