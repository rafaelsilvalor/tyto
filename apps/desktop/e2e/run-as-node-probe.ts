import { type ChildProcess, spawn } from 'node:child_process';

import { DEBUGGING_PORT_SWITCH, waitForBoot } from './boot-signal.js';
import { killTree, recordSpawn } from './launch-ledger.js';

// Where it always was for its callers; it lives beside the ledger, whose teardown needs it too.
export { killTree } from './launch-ledger.js';

/** What one `ELECTRON_RUN_AS_NODE=1 <executable> -e "console.log(1)"` produced. */
export interface RunAsNodeProbe {
  /** Whether a line of stdout was exactly `1`, which only a Node evaluating `-e` prints. */
  readonly printedOne: boolean;
  /** How it ended: see {@link ProbeEnding}. */
  readonly ended: ProbeEnding;
  readonly code: number | null;
  readonly stdoutBytes: number;
}

export interface RunAsNodeProbeOptions {
  readonly home: string;
  readonly deadlineMs: number;
  /**
   * Where the app keeps its data **if it boots as the app**, or `undefined` when the caller
   * expects a Node. See `appSwitches` for why this cannot simply always be passed.
   */
  readonly userData: string | undefined;
}

/**
 * The switches an executable that ignores `ELECTRON_RUN_AS_NODE` needs to boot isolated.
 *
 * **They cannot be passed to a Node, and they cannot be hidden from one.** Node reads options
 * after `-e <code>` too, so `--user-data-dir` makes it exit 9 (`bad option`) before it prints
 * anything — measured, and a probe that does that can never see a Node. Putting them behind
 * `--` satisfies Node and loses Chromium, which stops reading switches there: measured, the
 * packaged app booted into the real `%APPDATA%\Tyto\<version>`. So the caller decides from
 * the fuse wire which program it is about to start, and only an app gets the switches.
 */
export function appSwitches(userData: string): string[] {
  const switches = [`--user-data-dir=${userData}`];
  // The same switch Playwright adds on Linux: the unpacked folder's `chrome-sandbox` is not
  // setuid on a runner, and without it a booted app aborts instead of booting.
  if (process.platform === 'linux') switches.push('--no-sandbox');
  return switches;
}

/**
 * Ask an Electron executable to behave as Node, and say whether it did (TYTO-193, ADR 0067).
 *
 * **One function for both arms of the measurement**, the positive control and the packaged
 * app, so a capture that never saw stdout cannot pass for a fuse that held: the control has to
 * print `1` through this same code before the packaged answer means anything.
 *
 * With the RunAsNode fuse off the variable is ignored and the executable boots as the app, so
 * the probe isolates it like any e2e launch — its own `--user-data-dir` and `TYTO_HOME`, hidden
 * — and ends as soon as it has booted (see {@link watchLaunch}).
 */
export function probeRunAsNode(
  executable: string,
  options: RunAsNodeProbeOptions,
): Promise<RunAsNodeProbe> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    TYTO_HEADLESS: '1',
    TYTO_HOME: options.home,
  };
  // Removed for the reason Playwright removes it: whatever the test runner put there is not
  // part of the question, and in the control it would be read by the Node being asked.
  delete environment['NODE_OPTIONS'];

  // The debugging port only beside the isolating switches, for the same reason: a Node exits 9
  // on it, and an app needs it to say it booted.
  const args = ['-e', 'console.log(1)'];
  if (options.userData !== undefined) {
    args.push(...appSwitches(options.userData), DEBUGGING_PORT_SWITCH);
  }

  const notBefore = Date.now();
  const child = spawn(executable, args, {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group on POSIX, so one signal reaches every child it started.
    detached: process.platform !== 'win32',
  });

  recordSpawn(child.pid, options.userData, notBefore);
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  // Drained so a chatty boot cannot fill the pipe and stall the process it is measuring.
  child.stderr.resume();

  return watchLaunch(child, {
    userData: options.userData,
    deadlineMs: options.deadlineMs,
    stderrTail: () => '',
  }).then(({ ended, code }) => ({
    printedOne: stdout.split(/\r?\n/u).some((line) => line.trim() === '1'),
    ended,
    code,
    stdoutBytes: Buffer.byteLength(stdout),
  }));
}

/**
 * How a probe ended (TYTO-308, ADR 0103).
 *
 * - `exited`: on its own, before the deadline. A Node does, at once; so does an app that
 *   refuses to start.
 * - `booted`: a window with the editor was reached over CDP, and the probe then ended it.
 * - `killed`: neither, by the deadline. Not a boot: something that sat there without a window.
 */
export type ProbeEnding = 'exited' | 'booted' | 'killed';

export interface LaunchWatch {
  /** The app's data folder, or `undefined` for a launch that cannot boot as the app. */
  readonly userData: string | undefined;
  readonly deadlineMs: number;
  readonly stderrTail: () => string;
}

/**
 * Wait for a launched executable to exit, boot or reach the deadline, and end it in the last
 * two cases (TYTO-308).
 *
 * **It used to wait out the deadline for an app that boots**, and read "still running" as the
 * boot: 4 probes of 6 in the packaged suite spent 15 s each that way. Now the boot is seen, over
 * CDP, the moment the editor is up, and the deadline is only the upper bound for what never
 * boots — set long, so a slow runner cannot pass for a refusal.
 *
 * The **whole process tree** is killed, and `close` awaited, so whatever the caller reads off
 * stdout or stderr is complete: a GPU or utility child left behind would also hold the CI job
 * open long after the test said it was done.
 */
export function watchLaunch(
  child: ChildProcess,
  watch: LaunchWatch,
): Promise<{ ended: ProbeEnding; code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    let ending: 'booted' | 'killed' | undefined;
    let gone = false;
    // Where the time goes, printed per probe: the boot is the app's cost, and anything between it
    // and the close is the probe's.
    const started = Date.now();
    const at: { booted?: number } = {};
    const deadline = setTimeout(() => {
      ending ??= 'killed';
      killTree(child.pid);
    }, watch.deadlineMs);

    child.once('error', (cause) => {
      clearTimeout(deadline);
      reject(cause);
    });
    child.once('close', (code, signal) => {
      gone = true;
      clearTimeout(deadline);
      const ended = ending ?? 'exited';
      process.stdout.write(
        `[TYTO-308] probe ${ended}: booted at ${String(at.booted ?? '-')} ms, ` +
          `process closed at ${String(Date.now() - started)} ms\n`,
      );
      resolve({ ended, code, signal });
    });

    const userData = watch.userData;
    if (userData === undefined) return;
    waitForBoot({
      userData,
      gone: () => gone,
      stderrTail: watch.stderrTail,
      deadlineMs: watch.deadlineMs,
    }).then(
      async ({ browser }) => {
        ending ??= 'booted';
        at.booted = Date.now() - started;
        // **Killed first, then disconnected**, as the quit-guard test does. The other order was
        // measured on Linux CI: `browser.close()` on the live app took 30 s every time (booted at
        // ~0.6 s, disconnected at ~30.6 s, in all 5 probes of run 39174295738), and with the
        // process gone it returns at once.
        killTree(child.pid);
        await browser.close().catch(() => {});
      },
      () => {
        // It exited, or the deadline is about to end it: `close` says which.
      },
    );
  });
}
